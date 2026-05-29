/**
 * **Structured log storage facet** — durable sink for the
 * `@nikscripts/effect-pm/Logs` capture/relay pipeline.
 *
 * @remarks
 * Used by the process-manager log relay; rarely composed directly by
 * apps. The `groupId` parameter is an opaque log-bucket partition key
 * supplied by the relay (today it carries the PM log-bucket
 * annotation from {@link LogContext}). It is **not** tied to a
 * {@link ProcessGroup.Service} id — the facet persists and queries
 * {@link ProcessManagerLogEntry} rows regardless of how they were
 * scoped.
 *
 * ## At-a-glance
 *
 * | Concern | Where |
 * |--------|-------|
 * | Wire type | `log.entry` |
 * | Static emit | `record(groupId, entryId, entry)`, `recordBatch(groupId, rows)` |
 * | Reads (instance) | `load(query)` (returns entries), `query(logQuery)` (replays through {@link replayLogQueryResults}) |
 *
 * ## Storage shape
 *
 * Each line writes one {@link RuntimeRecord} with:
 *
 * - `type` = `log.entry`
 * - `processType` = `log`
 * - `processId` = the supplied `groupId` (log bucket)
 * - `payload` = `{ entryId, entry: { date, level, message, cause?,
 *   annotations, spans } }`
 *
 * Process / queue annotations stay inside `entry.annotations` so the
 * existing operator query semantics (substring filters on `processId`,
 * `queueId`) continue to work unchanged.
 *
 * @module store/Log
 */

import { DateTime, Effect } from "effect";
import type { LogLevel } from "effect/LogLevel";
import { ProcessManagerLogAnnotationKeys } from "../LogContext";
import type { ProcessManagerLogEntry } from "../LogEntry";
import type { ProcessManagerLogQuery } from "../internal/manager/logQuery";
import {
  ProcessManagerLogQueryError,
  replayLogQueryResults,
} from "../internal/manager/logQuery";
import {
  isRecord,
  isString,
  runtimeRecordQuery,
} from "../internal/store/helpers";
import { ProcessStore } from "../ProcessStore";
import type {
  AnalyticsEventBase,
  ProcessStoreWriteError,
  QueryOpts,
} from "../ProcessStoreEvent";
import { ProcessId, Type } from "../Query";
import type { RuntimeRecord, RuntimeStorageOperationalError } from "../RuntimeStorage";

/**
 * Structured log line persisted by {@link LogStore} for operator
 * `pm logs` / `pm watch` history. `entityId` is an opaque log-bucket id
 * supplied by the relay (today: the PM log annotation).
 *
 * @public
 */
export interface LogEntryRecordedEvent extends AnalyticsEventBase {
  type: "log.entry";
  entityType: "log";
  log: {
    readonly entryId: string;
    readonly entry: {
      readonly date: string;
      readonly level: LogLevel;
      readonly message: string;
      readonly cause?: string;
      readonly annotations: Readonly<Record<string, string>>;
      readonly spans: ReadonlyArray<string>;
    };
  };
}

/**
 * Narrows a structurally-shaped `{ type, entityType }` value to
 * {@link LogEntryRecordedEvent}.
 *
 * @public
 */
export const isLogEntryRecorded = (
  event: { readonly type: string; readonly entityType: string },
): event is LogEntryRecordedEvent =>
  event.type === "log.entry" && event.entityType === "log";

/**
 * Service shape for {@link LogStore}.
 *
 * @public
 */
export interface LogStoreApi {
  readonly record: (
    groupId: string,
    entryId: string,
    entry: ProcessManagerLogEntry,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly recordBatch: (
    groupId: string,
    rows: ReadonlyArray<{
      readonly entryId: string;
      readonly entry: ProcessManagerLogEntry;
    }>,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly load: (
    query: ProcessManagerLogQuery,
  ) => Effect.Effect<
    ReadonlyArray<ProcessManagerLogEntry>,
    ProcessManagerLogQueryError
  >;
  readonly query: (
    logQuery: ProcessManagerLogQuery,
  ) => Effect.Effect<void, ProcessManagerLogQueryError>;
}

const LOG_TYPE = "log";
const LOG_ENTRY_TYPE = "log.entry";

const LOG_LEVELS: ReadonlyArray<LogEntryRecordedEvent["log"]["entry"]["level"]> =
  [
    "All",
    "Fatal",
    "Error",
    "Warn",
    "Info",
    "Debug",
    "Trace",
    "None",
  ];

const isLogLevel = (
  value: unknown,
): value is LogEntryRecordedEvent["log"]["entry"]["level"] =>
  isString(value) && LOG_LEVELS.some((level) => level === value);

// ============================================================================
// Wire codec
// ============================================================================

/**
 * Build a `log.entry` runtime record ready for spine create.
 *
 * @public
 */
export const makeLogRecord = (
  groupId: string,
  entryId: string,
  entry: ProcessManagerLogEntry,
): Omit<RuntimeRecord, "runId" | "createdAt"> => {
  const occurredAt = Date.parse(entry.date);
  const occurredAtMs = Number.isNaN(occurredAt) ? 0 : occurredAt;
  return {
    id: `${groupId}-log-${entryId}`,
    type: LOG_ENTRY_TYPE,
    occurredAt: DateTime.makeUnsafe(occurredAtMs),
    processType: LOG_TYPE,
    processId: groupId,
    payload: {
      entryId,
      entry: {
        date: entry.date,
        level: entry.level,
        message: entry.message,
        ...(entry.cause === undefined ? {} : { cause: entry.cause }),
        annotations: { ...entry.annotations },
        spans: [...entry.spans],
      },
    },
  };
};

const decodeLogEntryPayload = (
  value: unknown,
): ProcessManagerLogEntry | null => {
  if (!isRecord(value)) return null;
  const date = value["date"];
  const level = value["level"];
  const message = value["message"];
  const cause = value["cause"];
  const annotations = value["annotations"];
  const spans = value["spans"];
  if (!isString(date) || !isLogLevel(level) || !isString(message)) {
    return null;
  }
  if (!isRecord(annotations)) return null;
  const annotationOut: Record<string, string> = {};
  for (const [key, item] of Object.entries(annotations)) {
    if (!isString(item)) return null;
    annotationOut[key] = item;
  }
  if (!Array.isArray(spans)) return null;
  const spanOut: string[] = [];
  for (const span of spans) {
    if (!isString(span)) return null;
    spanOut.push(span);
  }
  return {
    date,
    level,
    message,
    ...(isString(cause) ? { cause } : {}),
    annotations: annotationOut,
    spans: spanOut,
  };
};

interface LogRecordView {
  readonly entryId: string;
  readonly entry: ProcessManagerLogEntry;
}

const recordToLogView = (record: RuntimeRecord): LogRecordView | null => {
  if (record.type !== LOG_ENTRY_TYPE) return null;
  if (record.processType !== LOG_TYPE) return null;
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  const entryId = payload["entryId"];
  const entry = decodeLogEntryPayload(payload["entry"]);
  if (!isString(entryId) || entry === null) return null;
  return { entryId, entry };
};

// ============================================================================
// Query translation + filtering
// ============================================================================

const parseCursorMillis = (cursor: string | undefined): number | undefined => {
  if (cursor === undefined) return undefined;
  const asNumber = Number(cursor);
  if (Number.isFinite(asNumber)) return asNumber;
  const parsed = Date.parse(cursor);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const queryOptsFromLogQuery = (
  query: ProcessManagerLogQuery,
): QueryOpts => {
  const afterMs =
    parseCursorMillis(query.after) ??
    (query.from === undefined ? undefined : query.from.getTime());
  const beforeMs =
    parseCursorMillis(query.before) ??
    (query.to === undefined ? undefined : query.to.getTime());
  const prefetch =
    query.processId !== undefined || query.queueId !== undefined
      ? Math.min(query.limit * 8, 10_000)
      : query.limit;
  const opts: { -readonly [K in keyof QueryOpts]: QueryOpts[K] } = {
    limit: prefetch,
  };
  if (afterMs !== undefined) opts.after = afterMs;
  if (beforeMs !== undefined) opts.before = beforeMs;
  return opts;
};

const entryMatchesQuery = (
  entry: ProcessManagerLogEntry,
  query: ProcessManagerLogQuery,
): boolean => {
  if (query.processId !== undefined) {
    const processId =
      entry.annotations[ProcessManagerLogAnnotationKeys.processId];
    if (processId !== query.processId) return false;
  }
  if (query.queueId !== undefined) {
    const queueId = entry.annotations[ProcessManagerLogAnnotationKeys.queueId];
    if (queueId !== query.queueId) return false;
  }
  if (query.groupId !== undefined) {
    const groupId = entry.annotations[ProcessManagerLogAnnotationKeys.groupId];
    if (groupId !== undefined && groupId !== query.groupId) return false;
  }
  return true;
};

const sortEntries = (
  entries: ReadonlyArray<ProcessManagerLogEntry>,
  sort: ProcessManagerLogQuery["sort"],
): ReadonlyArray<ProcessManagerLogEntry> => {
  const rows = [...entries];
  rows.sort((left, right) => {
    const leftMs = Date.parse(left.date);
    const rightMs = Date.parse(right.date);
    return sort === "asc" ? leftMs - rightMs : rightMs - leftMs;
  });
  return rows;
};

const entriesFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  query: ProcessManagerLogQuery,
): ReadonlyArray<ProcessManagerLogEntry> => {
  const rows: ProcessManagerLogEntry[] = [];
  for (const record of records) {
    const view = recordToLogView(record);
    if (view === null) continue;
    if (!entryMatchesQuery(view.entry, query)) continue;
    if (query.after !== undefined && view.entryId <= query.after) continue;
    if (query.before !== undefined && view.entryId >= query.before) continue;
    rows.push(view.entry);
  }
  return sortEntries(rows, query.sort).slice(0, query.limit);
};

const loadEntries = (
  read: (query?: import("../Query").RuntimeRecordQuery) => Effect.Effect<
    RuntimeRecord[],
    RuntimeStorageOperationalError
  >,
  query: ProcessManagerLogQuery,
): Effect.Effect<
  ReadonlyArray<ProcessManagerLogEntry>,
  ProcessManagerLogQueryError | RuntimeStorageOperationalError
> =>
  Effect.gen(function* () {
    const opts = queryOptsFromLogQuery(query);
    const predicates = [Type.equals(LOG_ENTRY_TYPE)];
    if (query.groupId !== undefined) {
      predicates.push(ProcessId.equals(query.groupId));
    }
    const records = yield* read(runtimeRecordQuery(predicates, opts));
    const entries = entriesFromRecords(records, query);
    if (entries.length === 0) {
      return yield* new ProcessManagerLogQueryError({
        reason: "No log entries matched the query",
      });
    }
    return entries;
  });

const queryEntries = (
  read: (query?: import("../Query").RuntimeRecordQuery) => Effect.Effect<
    RuntimeRecord[],
    RuntimeStorageOperationalError
  >,
  logQuery: ProcessManagerLogQuery,
): Effect.Effect<void, ProcessManagerLogQueryError | RuntimeStorageOperationalError> =>
  Effect.gen(function* () {
    const entries = yield* loadEntries(read, logQuery);
    yield* replayLogQueryResults(entries, logQuery.sort);
  });

// ============================================================================
// Facet
// ============================================================================

/**
 * Context tag for {@link LogStoreApi}.
 *
 * @public
 */
export class LogStore extends ProcessStore.Service<LogStore>()(
  "@nikscripts/effect-pm/store/log/LogStore",
  ProcessStore.record({
    record:
      (s) =>
      (
        groupId: string,
        entryId: string,
        entry: ProcessManagerLogEntry,
      ) =>
        s.create(makeLogRecord(groupId, entryId, entry)),
    recordBatch:
      (s) =>
      (
        groupId: string,
        rows: ReadonlyArray<{
          readonly entryId: string;
          readonly entry: ProcessManagerLogEntry;
        }>,
      ) =>
        s.createBatch(
          rows.map((row) => makeLogRecord(groupId, row.entryId, row.entry)),
        ),
  }),
  ProcessStore.read((s) => ({
    load: (query: ProcessManagerLogQuery) => loadEntries(s.read, query),
    query: (logQuery: ProcessManagerLogQuery) =>
      queryEntries(s.read, logQuery),
  })),
) {}

/**
 * Type accessors for {@link LogStore}.
 *
 * @public
 */
export declare namespace LogStore {
  export type Type = ProcessStore.Service.Type<typeof LogStore>;
  export type EmitType = ProcessStore.Service.EmitType<typeof LogStore>;
}
