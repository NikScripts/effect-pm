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
 * | Wire type | `Log.Entry.Recorded` |
 * | Static emit | `LogStore.Entry.Recorded({ entryId, entry })` inside `LogScope.run({ groupId }, ...)` |
 * | Batch emit | `LogStore.Entry.Recorded.batch(rows)` inside `LogScope.run({ groupId }, ...)` |
 * | Reads (instance) | `load(query)` (returns entries), `query(logQuery)` (replays through {@link replayLogQueryResults}) |
 *
 * ## Storage shape
 *
 * Each line writes one {@link RuntimeRecord} with:
 *
 * - `type` = `Log.Entry.Recorded`
 * - `processType` = `Log`
 * - `processId` = the scope-supplied `groupId` (log bucket)
 * - `payload` = `{ groupId, entryId, entry: ProcessManagerLogEntry }`
 *
 * Process / queue annotations stay inside `entry.annotations` so the
 * existing operator query semantics (substring filters on `processId`,
 * `queueId`) continue to work unchanged.
 *
 * @module store/Log
 */

import { Effect, Schema } from "effect";
import { ProcessManagerLogAnnotationKeys } from "../LogContext";
import type { ProcessManagerLogEntry } from "../LogEntry";
import { LogScope } from "../LogScope";
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
import { ProcessStore, Telemetry } from "../ProcessStore";
import type { QueryOpts } from "../ProcessStoreEvent";
import { ProcessId, Type } from "../Query";
import type { RuntimeRecord, RuntimeStorageOperationalError } from "../RuntimeStorage";

/** Input shape for {@link LogStore.Entry.Recorded}. @public */
export interface LogEntryRecordedInput {
  readonly entryId: string;
  readonly entry: ProcessManagerLogEntry;
}

const LOG_ENTRY_WIRE = "Log.Entry.Recorded";

const LOG_LEVELS = [
  "All",
  "Fatal",
  "Error",
  "Warn",
  "Info",
  "Debug",
  "Trace",
  "None",
] as const;

type LogLevel = (typeof LOG_LEVELS)[number];

const isLogLevel = (value: unknown): value is LogLevel =>
  isString(value) && LOG_LEVELS.some((level) => level === value);

// ============================================================================
// Telemetry schema
// ============================================================================

class LogEntryRecordedSchema extends Telemetry.Schema<LogEntryRecordedSchema>()(
  LogScope,
)({
  groupId: LogScope.Schema.State.groupId,
  entryId: Schema.String,
  entry: Schema.Unknown,
}) {}

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
  if (record.type !== LOG_ENTRY_WIRE) return null;
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
    const predicates = [Type.equals(LOG_ENTRY_WIRE)];
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
 * Durable log-entry storage facet.
 *
 * @public
 */
export const LogStore = ProcessStore.Service(
  "@nikscripts/effect-pm/store/log/LogStore",
  ProcessStore.telemetry(LogScope)(
    Telemetry.namespace("Log"),
    Telemetry.tag("Entry")(
      Telemetry.event("Recorded", LogEntryRecordedSchema).pipe(
        Telemetry.logWarning("LogStore write failed for log entry"),
      ),
    ),
  ),
  ProcessStore.query((s) => ({
    load: (query: ProcessManagerLogQuery) => loadEntries(s.read, query),
    query: (logQuery: ProcessManagerLogQuery) =>
      queryEntries(s.read, logQuery),
  })),
);

export type LogStore = typeof LogStore.Identifier;
