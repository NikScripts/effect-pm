/**
 * Structured log facet for {@link ProcessStoreInterface}.
 *
 * @module ProcessStoreGroupLog
 */

import { Clock, Context, Effect, Layer } from "effect";
import type { LogLevel } from "effect/LogLevel";
import { ProcessManagerLogAnnotationKeys } from "./processManagerLogContext";
import type { ProcessManagerLogEntry } from "./processManagerLogEntry";
import type { ProcessManagerLogQuery } from "./processManagerLogQuery";
import { ProcessManagerLogQueryError, replayLogQueryResults } from "./processManagerLogQuery";
import {
  makeProcessStoreSpine,
  makeRunId,
} from "./processStoreSpine";
import type {
  AnalyticsEvent,
  GroupLogEntryRecordedEvent,
  ProcessStoreWriteError,
  StoreEventQuery,
} from "./ProcessStoreTypes";
import { isGroupLogEntryRecorded } from "./ProcessStoreTypes";
import { RuntimeStorage } from "./RuntimeStorage";

/**
 * Log operations exposed on {@link ProcessStoreInterface.GroupLog}.
 *
 * @public
 */
export interface ProcessStoreGroupLogApi {
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
  stored: GroupLogEntryRecordedEvent["log"]["entry"],
): ProcessManagerLogEntry => ({
  date: stored.date,
  level: stored.level as LogLevel,
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
    entityType: query.groupId === undefined ? undefined : "group",
    entityId: query.groupId,
    types: ["group.log.entry"],
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
 * Build a `group.log.entry` analytics event for {@link ProcessStoreInterface.append}.
 *
 * @public
 */
export const makeRecordedEvent = (
  groupId: string,
  entryId: string,
  entry: ProcessManagerLogEntry,
): GroupLogEntryRecordedEvent => {
  const occurredAt = Date.parse(entry.date);
  return {
    id: `${groupId}-log-${entryId}`,
    type: "group.log.entry",
    occurredAt: Number.isNaN(occurredAt) ? 0 : occurredAt,
    entityType: "group",
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
  events: ReadonlyArray<GroupLogEntryRecordedEvent>,
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

/**
 * @public
 */
export const makeProcessStoreGroupLog = (deps: {
  readonly append: (event: AnalyticsEvent) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly appendBatch: (events: ReadonlyArray<AnalyticsEvent>) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly events: (query?: StoreEventQuery) => Effect.Effect<AnalyticsEvent[]>;
}): ProcessStoreGroupLogApi => ({
  record: (groupId, entryId, entry) =>
    deps.append(makeRecordedEvent(groupId, entryId, entry)),

  recordBatch: (groupId, rows) =>
    deps.appendBatch(rows.map((row) => makeRecordedEvent(groupId, row.entryId, row.entry))),

  load: (query) =>
    Effect.gen(function* () {
      const events = yield* deps.events(storeEventQueryFromLogQuery(query));
      const logEvents = events.filter(isGroupLogEntryRecorded);
      const entries = entriesFromStoreEvents(logEvents, query);
      if (entries.length === 0) {
        return yield* new ProcessManagerLogQueryError({
          reason: "No log entries matched the query",
        });
      }
      return entries;
    }),

  query: (logQuery) =>
    Effect.gen(function* () {
      const events = yield* deps.events(storeEventQueryFromLogQuery(logQuery));
      const logEvents = events.filter(isGroupLogEntryRecorded);
      const entries = entriesFromStoreEvents(logEvents, logQuery);
      if (entries.length === 0) {
        return yield* new ProcessManagerLogQueryError({
          reason: "No log entries matched the query",
        });
      }
      yield* replayLogQueryResults(entries, logQuery.sort);
    }),
});

/** @internal @deprecated Use {@link makeProcessStoreGroupLog}. */
export const makeProcessStoreLogs = makeProcessStoreGroupLog;

const makeProcessStoreGroupLogFromRuntimeStorage: Effect.Effect<
  ProcessStoreGroupLogApi,
  never,
  RuntimeStorage
> = Effect.gen(function* () {
  const storage = yield* RuntimeStorage;
  const now = yield* Clock.currentTimeMillis;
  const spine = makeProcessStoreSpine(storage, makeRunId(now));
  return makeProcessStoreGroupLog({
    append: spine.append,
    appendBatch: spine.appendBatch,
    events: spine.events,
  });
});

/**
 * Context tag for {@link ProcessStoreGroupLogApi}.
 *
 * @public
 */
export class ProcessStoreGroupLog extends Context.Service<
  ProcessStoreGroupLog,
  ProcessStoreGroupLogApi
>()("@nikscripts/effect-pm/ProcessStoreGroupLog", {
  make: makeProcessStoreGroupLogFromRuntimeStorage,
}) {}

export namespace ProcessStoreGroupLog {
  /**
   * `Layer` that provides {@link ProcessStoreGroupLog} from injected {@link RuntimeStorage}.
   *
   * @public
   */
  export const layerRuntimeStorage: Layer.Layer<ProcessStoreGroupLog, never, RuntimeStorage> =
    Layer.effect(ProcessStoreGroupLog, makeProcessStoreGroupLogFromRuntimeStorage);

  /**
   * `Layer` backed by in-memory {@link RuntimeStorage}.
   *
   * @public
   */
  export const layer: Layer.Layer<ProcessStoreGroupLog, never, never> = Layer.provide(
    layerRuntimeStorage,
    RuntimeStorage.layer,
  );

  export const record = (
    groupId: string,
    entryId: string,
    entry: ProcessManagerLogEntry,
  ): Effect.Effect<void, ProcessStoreWriteError, ProcessStoreGroupLog> =>
    Effect.flatMap(ProcessStoreGroupLog, (store) => store.record(groupId, entryId, entry));

  export const recordBatch = (
    groupId: string,
    rows: ReadonlyArray<{ readonly entryId: string; readonly entry: ProcessManagerLogEntry }>,
  ): Effect.Effect<void, ProcessStoreWriteError, ProcessStoreGroupLog> =>
    Effect.flatMap(ProcessStoreGroupLog, (store) => store.recordBatch(groupId, rows));

  export const load = (
    query: ProcessManagerLogQuery,
  ): Effect.Effect<ReadonlyArray<ProcessManagerLogEntry>, ProcessManagerLogQueryError, ProcessStoreGroupLog> =>
    Effect.flatMap(ProcessStoreGroupLog, (store) => store.load(query));

  export const query = (
    logQuery: ProcessManagerLogQuery,
  ): Effect.Effect<void, ProcessManagerLogQueryError, ProcessStoreGroupLog> =>
    Effect.flatMap(ProcessStoreGroupLog, (store) => store.query(logQuery));
}
