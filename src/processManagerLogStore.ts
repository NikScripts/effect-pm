import { Cause, Duration, Effect, FileSystem, Layer, Option, Path, PubSub, Ref, Schedule, Scope, Stream } from "effect";
import type { LogLevel } from "effect/LogLevel";
import {
  ProcessGroupLogContext,
  ProcessManagerLogAnnotationKeys,
} from "./processManagerLogContext.js";
import type { ProcessManagerLogEntry } from "./processManagerLogEntry.js";
import {
  ProcessManagerLogRelay,
  type ProcessManagerLogRelayService,
} from "./processManagerLogRelay.js";
import type { ProcessManagerLogQuery } from "./processManagerLogQuery.js";
import { ProcessManagerLogQueryError, replayLogQueryResults } from "./processManagerLogQuery.js";
import {
  GroupLogEntryRecordedEvent,
  isGroupLogEntryRecorded,
  ProcessStore,
  type StoreEventQuery,
} from "./ProcessStore.js";

const storeFlushInterval = Duration.millis(250);
const storeFlushBatchSize = 64;

/**
 * NDJSON {@link ProcessStore} path for a group's persisted log history.
 *
 * @public
 */
export const groupLogStoreFilePath = (
  logDirectory: string,
  groupId: string,
): string => `${logDirectory.replace(/\/+$/, "")}/${groupId}/events.ndjson`;

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
 * @public
 */
export const makeGroupLogEntryRecordedEvent = (
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
 * Query persisted group logs through {@link ProcessStore}.
 *
 * @public
 */
export const queryGroupLogsFromStore = (
  query: ProcessManagerLogQuery,
): Effect.Effect<void, ProcessManagerLogQueryError, ProcessStore> =>
  Effect.gen(function* () {
    const store = yield* ProcessStore;
    const events = yield* store.events(storeEventQueryFromLogQuery(query));
    const logEvents = events.filter(isGroupLogEntryRecorded);
    const entries = entriesFromStoreEvents(logEvents, query);
    if (entries.length === 0) {
      return yield* Effect.fail(
        new ProcessManagerLogQueryError({
          reason: "No log entries matched the query",
        }),
      );
    }
    yield* replayLogQueryResults(entries, query.sort);
  });

/**
 * Query a group's on-disk log store file (operator `pm logs`).
 *
 * @public
 */
export const queryGroupLogsFromFile = (
  filePath: string,
  query: ProcessManagerLogQuery,
): Effect.Effect<void, ProcessManagerLogQueryError, FileSystem.FileSystem | Path.Path> =>
  queryGroupLogsFromStore(query).pipe(
    Effect.provide(ProcessStore.fileLayer(filePath)),
    Effect.scoped,
  );

type PendingLogAppend = {
  readonly entryId: string;
  readonly entry: ProcessManagerLogEntry;
};

const makePersistingRelay = (
  base: ProcessManagerLogRelayService,
): Effect.Effect<
  ProcessManagerLogRelayService,
  never,
  ProcessGroupLogContext | ProcessStore | Scope.Scope
> =>
  Effect.gen(function* () {
    const group = yield* ProcessGroupLogContext;
    const storeOption = yield* Effect.serviceOption(ProcessStore);
    const entryCounter = yield* Ref.make(0);
    const buffer = yield* Ref.make<ReadonlyArray<PendingLogAppend>>([]);

    const flush = Effect.gen(function* () {
      if (Option.isNone(storeOption)) {
        return;
      }
      const batch = yield* Ref.getAndSet(buffer, []);
      if (batch.length === 0) {
        return;
      }
      const events = batch.map((row) =>
        makeGroupLogEntryRecordedEvent(group.groupId, row.entryId, row.entry),
      );
      yield* storeOption.value.appendBatch(events).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("ProcessStore group log append failed").pipe(
            Effect.annotateLogs("cause", Cause.pretty(cause)),
          ),
        ),
      );
    });

    yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(storeFlushInterval)));

    const queueAppend = (entry: ProcessManagerLogEntry): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (Option.isNone(storeOption)) {
          return;
        }
        const entryId = String((yield* Ref.getAndUpdate(entryCounter, (n) => n + 1)));
        yield* Ref.update(buffer, (rows) => [...rows, { entryId, entry }]);
        const pending = yield* Ref.get(buffer);
        if (pending.length >= storeFlushBatchSize) {
          yield* flush;
        }
      });

    return ProcessManagerLogRelay.of({
      publish: (entry) =>
        Effect.gen(function* () {
          yield* base.publish(entry);
          yield* queueAppend(entry);
        }),
      snapshot: base.snapshot,
      stream: base.stream,
    });
  });

const historyCapacity = 500;

/**
 * Relay layer with in-memory tail plus batched {@link ProcessStore} append.
 *
 * @public
 */
export const layerWithProcessStore: Layer.Layer<
  ProcessManagerLogRelay,
  never,
  ProcessGroupLogContext | ProcessStore
> = Layer.effect(
  ProcessManagerLogRelay,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<ProcessManagerLogEntry>();
    const history = yield* Ref.make<ReadonlyArray<ProcessManagerLogEntry>>([]);
    const base = ProcessManagerLogRelay.of({
      publish: (entry) =>
        Effect.gen(function* () {
          yield* PubSub.publish(pubsub, entry);
          yield* Ref.update(history, (items) => {
            const next = [...items, entry];
            return next.length <= historyCapacity
              ? next
              : next.slice(next.length - historyCapacity);
          });
        }),
      snapshot: Ref.get(history),
      stream: Stream.fromPubSub(pubsub),
    });
    return yield* makePersistingRelay(base);
  }),
);
