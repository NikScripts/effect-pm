/**
 * Structured log persistence facet — the durable sink for the
 * `@nikscripts/effect-pm/Logs` capture/relay pipeline.
 *
 * @remarks
 * The `groupId` parameter is an opaque partition key supplied by the
 * process-manager log relay (today it carries the PM log-bucket annotation
 * from {@link LogContext}). It is not tied to a {@link ProcessGroup.Service}
 * id; the facet itself is about persisting and querying
 * {@link ProcessManagerLogEntry} rows, regardless of which kind of "group"
 * happens to scope them.
 *
 * @module store/Log
 */

import { Effect } from "effect";
import { ProcessManagerLogAnnotationKeys } from "../LogContext";
import type { ProcessManagerLogEntry } from "../LogEntry";
import type { ProcessManagerLogQuery } from "../internal/manager/logQuery";
import { ProcessManagerLogQueryError, replayLogQueryResults } from "../internal/manager/logQuery";
import { ProcessStore } from "../ProcessStore";
import type {
  AnalyticsEvent,
  LogEntryRecordedEvent,
  ProcessStoreWriteError,
  StoreEventQuery,
} from "../ProcessStoreEvent";
import { isLogEntryRecorded } from "../ProcessStoreEvent";

/**
 * Service shape for {@link ProcessStoreLog}.
 *
 * @public
 */
export interface ProcessStoreLogApi {
  readonly record: (
    groupId: string,
    entryId: string,
    entry: ProcessManagerLogEntry,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly recordBatch: (
    groupId: string,
    rows: ReadonlyArray<{ readonly entryId: string; readonly entry: ProcessManagerLogEntry }>,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly load: (
    query: ProcessManagerLogQuery,
  ) => Effect.Effect<ReadonlyArray<ProcessManagerLogEntry>, ProcessManagerLogQueryError>;
  readonly query: (logQuery: ProcessManagerLogQuery) => Effect.Effect<void, ProcessManagerLogQueryError>;
}

const logEntryFromStored = (
  stored: LogEntryRecordedEvent["log"]["entry"],
): ProcessManagerLogEntry => ({
  date: stored.date,
  level: stored.level,
  message: stored.message,
  ...(stored.cause === undefined ? {} : { cause: stored.cause }),
  annotations: stored.annotations,
  spans: stored.spans,
});

const entryMatchesQuery = (
  entry: ProcessManagerLogEntry,
  query: ProcessManagerLogQuery,
): boolean => {
  if (query.processId !== undefined) {
    const processId = entry.annotations[ProcessManagerLogAnnotationKeys.processId];
    if (processId !== query.processId) {
      return false;
    }
  }
  if (query.queueId !== undefined) {
    const queueId = entry.annotations[ProcessManagerLogAnnotationKeys.queueId];
    if (queueId !== query.queueId) {
      return false;
    }
  }
  if (query.groupId !== undefined) {
    const groupId = entry.annotations[ProcessManagerLogAnnotationKeys.groupId];
    if (groupId !== undefined && groupId !== query.groupId) {
      return false;
    }
  }
  return true;
};

const parseCursorMillis = (cursor: string | undefined): number | undefined => {
  if (cursor === undefined) {
    return undefined;
  }
  const asNumber = Number(cursor);
  if (Number.isFinite(asNumber)) {
    return asNumber;
  }
  const parsed = Date.parse(cursor);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * Map {@link ProcessManagerLogQuery} to {@link StoreEventQuery}.
 *
 * @public
 */
export const storeEventQueryFromLogQuery = (
  query: ProcessManagerLogQuery,
): StoreEventQuery => {
  const afterMs =
    parseCursorMillis(query.after) ?? (query.from === undefined ? undefined : query.from.getTime());
  const beforeMs =
    parseCursorMillis(query.before) ?? (query.to === undefined ? undefined : query.to.getTime());
  const prefetch =
    query.processId !== undefined || query.queueId !== undefined
      ? Math.min(query.limit * 8, 10_000)
      : query.limit;
  return {
    entityType: query.groupId === undefined ? undefined : "log",
    entityId: query.groupId,
    types: ["log.entry"],
    opts: {
      limit: prefetch,
      after: afterMs,
      before: beforeMs,
    },
  };
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

/**
 * Build a `log.entry` analytics event ready for spine append.
 *
 * @public
 */
export const makeRecordedEvent = (
  groupId: string,
  entryId: string,
  entry: ProcessManagerLogEntry,
): LogEntryRecordedEvent => {
  const occurredAt = Date.parse(entry.date);
  return {
    id: `${groupId}-log-${entryId}`,
    type: "log.entry",
    occurredAt: Number.isNaN(occurredAt) ? 0 : occurredAt,
    entityType: "log",
    entityId: groupId,
    log: {
      entryId,
      entry: {
        date: entry.date,
        level: entry.level,
        message: entry.message,
        ...(entry.cause === undefined ? {} : { cause: entry.cause }),
        annotations: entry.annotations,
        spans: entry.spans,
      },
    },
  };
};

const entriesFromStoreEvents = (
  events: ReadonlyArray<LogEntryRecordedEvent>,
  query: ProcessManagerLogQuery,
): ReadonlyArray<ProcessManagerLogEntry> => {
  const rows: ProcessManagerLogEntry[] = [];
  for (const event of events) {
    const entry = logEntryFromStored(event.log.entry);
    if (!entryMatchesQuery(entry, query)) {
      continue;
    }
    if (query.after !== undefined && event.log.entryId <= query.after) {
      continue;
    }
    if (query.before !== undefined && event.log.entryId >= query.before) {
      continue;
    }
    rows.push(entry);
  }
  return sortEntries(rows, query.sort).slice(0, query.limit);
};

const loadEntries = (
  events: (query?: StoreEventQuery) => Effect.Effect<AnalyticsEvent[]>,
  query: ProcessManagerLogQuery,
): Effect.Effect<ReadonlyArray<ProcessManagerLogEntry>, ProcessManagerLogQueryError> =>
  Effect.gen(function* () {
    const eventsResult = yield* events(storeEventQueryFromLogQuery(query));
    const logEvents = eventsResult.filter(isLogEntryRecorded);
    const entries = entriesFromStoreEvents(logEvents, query);
    if (entries.length === 0) {
      return yield* new ProcessManagerLogQueryError({
        reason: "No log entries matched the query",
      });
    }
    return entries;
  });

const queryEntries = (
  events: (query?: StoreEventQuery) => Effect.Effect<AnalyticsEvent[]>,
  logQuery: ProcessManagerLogQuery,
): Effect.Effect<void, ProcessManagerLogQueryError> =>
  Effect.gen(function* () {
    const entries = yield* loadEntries(events, logQuery);
    yield* replayLogQueryResults(entries, logQuery.sort);
  });

/** @internal */
export const makeProcessStoreLogApi = (deps: {
  readonly append: (event: AnalyticsEvent) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly appendBatch: (events: ReadonlyArray<AnalyticsEvent>) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly events: (query?: StoreEventQuery) => Effect.Effect<AnalyticsEvent[]>;
}): ProcessStoreLogApi => ({
  record: (groupId, entryId, entry) =>
    deps.append(makeRecordedEvent(groupId, entryId, entry)),

  recordBatch: (groupId, rows) =>
    deps.appendBatch(rows.map((row) => makeRecordedEvent(groupId, row.entryId, row.entry))),

  load: (query) => loadEntries(deps.events, query),

  query: (logQuery) => queryEntries(deps.events, logQuery),
});

/**
 * Context tag for {@link ProcessStoreLogApi}.
 *
 * @public
 */
export class ProcessStoreLog extends ProcessStore.Service<
  ProcessStoreLog
>()(
  "@nikscripts/effect-pm/store/log/ProcessStoreLog",
  ProcessStore.record({
    record:
      (s) =>
      (groupId: string, entryId: string, entry: ProcessManagerLogEntry) =>
        s.append(makeRecordedEvent(groupId, entryId, entry)),
    recordBatch:
      (s) =>
      (
        groupId: string,
        rows: ReadonlyArray<{
          readonly entryId: string;
          readonly entry: ProcessManagerLogEntry;
        }>,
      ) =>
        s.appendBatch(
          rows.map((row) =>
            makeRecordedEvent(groupId, row.entryId, row.entry),
          ),
        ),
  }),
  ProcessStore.read((s) => ({
    load: (query: ProcessManagerLogQuery) => loadEntries(s.events, query),
    query: (logQuery: ProcessManagerLogQuery) => queryEntries(s.events, logQuery),
  })),
) {}

/**
 * Type accessors for {@link ProcessStoreLog}.
 *
 * @public
 */
export declare namespace ProcessStoreLog {
  export type Type = ProcessStore.Service.Type<typeof ProcessStoreLog>;
  export type EmitType = ProcessStore.Service.EmitType<typeof ProcessStoreLog>;
}
