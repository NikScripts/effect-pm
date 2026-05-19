/**
 * **ProcessStore** — event-first analytics for processes (and future queue metrics).
 *
 * @remarks
 * Intentionally small surface:
 *
 * - **Append** — `append` / `appendBatch` only (no update/delete in the interface).
 * - **Envelope** — {@link AnalyticsEventBase} carries `occurredAt`, `entityType`, `entityId`.
 * - **Events** — `process.execution.completed` and `process.lifecycle.changed` to start;
 *   Prisma adapter stores the same shapes durably.
 *
 * Default implementation: {@link ProcessStore} service class with an in-memory store.
 * Use {@link ProcessStore.fileLayer} for local durable NDJSON storage.
 *
 * @module ProcessStore
 */

import {
  Clock,
  Context,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Semaphore,
  Schema,
} from "effect";
import {
  dateFromUnknown,
  isJsonValue,
  isRecord,
  isString,
  unknownJsonString,
} from "./internal/json";
import {
  decodeEventRow,
  encodeEvent,
  ProcessStoreEventDecodeError,
} from "./ProcessStoreCodec";
import type { EffectPmEventRow, JsonValue } from "./ProcessStoreEvent";
import {
  selectRuntimeRecords,
  type RuntimeRecord,
} from "./RuntimeStorage";
import type { RuntimeRecordQuery } from "./Query";
import type {
  RuntimeFact,
  RuntimeRef,
  RuntimeStateBase,
  RuntimeStateChange,
} from "./RuntimeState";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Pagination / time window for historical reads.
 *
 * @public
 */
export interface QueryOpts {
  limit?: number;
  /** Filter: only events before this epoch millis. */
  before?: number;
  /** Filter: only events after this epoch millis. */
  after?: number;
}

/**
 * Storage-neutral event query for the append-only analytics envelope.
 *
 * @public
 */
export interface StoreEventQuery {
  readonly entityType?: AnalyticsEvent["entityType"];
  readonly entityId?: string;
  readonly types?: ReadonlyArray<AnalyticsEvent["type"]>;
  readonly opts?: QueryOpts;
}

/**
 * Storage-neutral query for persisted runtime facts.
 *
 * @public
 */
export interface RuntimeFactQuery {
  readonly ref?: RuntimeRef;
  readonly types?: ReadonlyArray<RuntimeFact["type"]>;
  readonly opts?: QueryOpts;
}

/**
 * Storage-neutral query for persisted runtime state changes.
 *
 * @public
 */
export interface RuntimeStateHistoryQuery {
  readonly ref: RuntimeRef;
  readonly opts?: QueryOpts;
}

/**
 * Common fields for every stored analytics row.
 *
 * @public
 */
export interface AnalyticsEventBase {
  id: string;
  type: string;
  /** Epoch milliseconds when the event occurred. Use `Clock.currentTimeMillis` to produce. */
  occurredAt: number;
  entityType: string;
  entityId: string;
  attributes?: Record<string, unknown>;
}

/**
 * One finished process run (success, failure, or interrupt).
 *
 * @public
 */
export interface ProcessExecutionCompletedEvent extends AnalyticsEventBase {
  type: "process.execution.completed";
  entityType: "process";
  execution: {
    scheduleKey: string | null;
    /** Epoch millis when the execution started. */
    startedAt: number;
    /** Epoch millis when the execution completed. */
    completedAt: number;
    durationMs: number;
    status: "completed" | "failed" | "interrupted";
    error?: string;
    isStartupRun: boolean;
  };
}

/**
 * High-level lifecycle labels written by the process supervisor.
 *
 * @public
 */
export type ProcessLifecycleTag =
  | "Started"
  | "Stopped"
  | "Restarted"
  | "Errored"
  | "Recovered"
  | "Disabled"
  | "Enabled";

/**
 * Supervisor-observed lifecycle transition for a process id.
 *
 * @public
 */
export interface ProcessLifecycleChangedEvent extends AnalyticsEventBase {
  type: "process.lifecycle.changed";
  entityType: "process";
  lifecycle: {
    tag: ProcessLifecycleTag;
    error?: string;
  };
}

// ============================================================================
// Queue Event Types
// ============================================================================

export type QueueItemStatus = "completed" | "failed" | "retried" | "exhausted";

export interface QueueItemCompletedEvent extends AnalyticsEventBase {
  type: "queue.item.completed";
  entityType: "queue";
  item: {
    status: QueueItemStatus;
    priority: "high" | "normal" | "low";
    durationMs: number;
    attempts: number;
    error?: string;
  };
}

export type QueueLifecycleTag =
  | "Started"
  | "Paused"
  | "Resumed"
  | "Shutdown"
  | "Cleared";

export interface QueueLifecycleChangedEvent extends AnalyticsEventBase {
  type: "queue.lifecycle.changed";
  entityType: "queue";
  lifecycle: {
    tag: QueueLifecycleTag;
    itemsCleared?: number;
  };
}

/**
 * Generic runtime fact persisted through the current analytics event envelope.
 *
 * @remarks
 * This bridges Phase C runtime facts into today's `ProcessStore` append API
 * without adding a storage method for every runtime feature.
 *
 * @public
 */
export interface RuntimeFactRecordedEvent extends AnalyticsEventBase {
  type: "runtime.fact.recorded";
  fact: RuntimeFact;
}

/**
 * Generic runtime state transition persisted through the analytics envelope.
 *
 * @public
 */
export interface RuntimeStateChangedEvent extends AnalyticsEventBase {
  type: "runtime.state.changed";
  change: RuntimeStateChange;
}

// ============================================================================
// Event Union
// ============================================================================

/**
 * Closed union of supported analytics payloads.
 *
 * @public
 */
export type AnalyticsEvent =
  | ProcessExecutionCompletedEvent
  | ProcessLifecycleChangedEvent
  | QueueItemCompletedEvent
  | QueueLifecycleChangedEvent
  | RuntimeFactRecordedEvent
  | RuntimeStateChangedEvent;

/**
 * Storage port implemented by the in-memory service and the Prisma-backed adapter
 * (`@nikscripts/effect-pm/prisma`).
 *
 * @public
 */
export interface ProcessStoreInterface {
  append: (event: AnalyticsEvent) => Effect.Effect<void>;
  appendBatch: (events: ReadonlyArray<AnalyticsEvent>) => Effect.Effect<void>;
  events: (query?: StoreEventQuery) => Effect.Effect<AnalyticsEvent[]>;
  records: (query?: RuntimeRecordQuery) => Effect.Effect<RuntimeRecord[]>;
  getProcessExecutions: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ProcessExecutionCompletedEvent[]>;
  getProcessLifecycle: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ProcessLifecycleChangedEvent[]>;
  getQueueItemCompletions: (
    queueId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<QueueItemCompletedEvent[]>;
  getQueueLifecycle: (
    queueId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<QueueLifecycleChangedEvent[]>;
}

// ============================================================================
// Internal Helpers
// ============================================================================

const applyQueryOpts = <T>(
  rows: readonly T[],
  opts: QueryOpts | undefined,
  getTimestamp: (row: T) => number,
): T[] => {
  const filtered = rows.filter((row) => {
    const timestamp = getTimestamp(row);
    if (opts?.before !== undefined && timestamp >= opts.before) {
      return false;
    }
    if (opts?.after !== undefined && timestamp <= opts.after) {
      return false;
    }
    return true;
  });

  if (opts?.limit === undefined) {
    return filtered;
  }

  return filtered.slice(0, Math.max(0, opts.limit));
};

const byTimestampDesc = <T>(getTimestamp: (row: T) => number) => (a: T, b: T) =>
  getTimestamp(b) - getTimestamp(a);

const matchesStoreEventQuery =
  (query: StoreEventQuery | undefined) =>
  (event: AnalyticsEvent): boolean => {
    if (query?.entityType !== undefined && event.entityType !== query.entityType) {
      return false;
    }
    if (query?.entityId !== undefined && event.entityId !== query.entityId) {
      return false;
    }
    if (
      query?.types !== undefined &&
      query.types.length > 0 &&
      !query.types.includes(event.type)
    ) {
      return false;
    }
    return true;
  };

const isProcessExecutionCompleted = (
  event: AnalyticsEvent,
): event is ProcessExecutionCompletedEvent =>
  event.type === "process.execution.completed" &&
  event.entityType === "process";

const isProcessLifecycleChanged = (
  event: AnalyticsEvent,
): event is ProcessLifecycleChangedEvent =>
  event.type === "process.lifecycle.changed" &&
  event.entityType === "process";

const isQueueItemCompleted = (
  event: AnalyticsEvent,
): event is QueueItemCompletedEvent =>
  event.type === "queue.item.completed" && event.entityType === "queue";

const isQueueLifecycleChanged = (
  event: AnalyticsEvent,
): event is QueueLifecycleChangedEvent =>
  event.type === "queue.lifecycle.changed" && event.entityType === "queue";

const matchesRuntimeFactQuery =
  (query: RuntimeFactQuery | undefined) =>
  (fact: RuntimeFact): boolean => {
    if (query?.ref !== undefined) {
      if (fact.ref.kind !== query.ref.kind || fact.ref.id !== query.ref.id) {
        return false;
      }
    }
    if (
      query?.types !== undefined &&
      query.types.length > 0 &&
      !query.types.includes(fact.type)
    ) {
      return false;
    }
    return true;
  };

const runtimeFactStoreQuery = (
  query: RuntimeFactQuery | undefined,
): StoreEventQuery => ({
  entityType: query?.ref?.kind,
  entityId: query?.ref?.id,
  types: ["runtime.fact.recorded"],
  opts: query?.opts === undefined
    ? undefined
    : {
        before: query.opts.before,
        after: query.opts.after,
      },
});

const runtimeFactsFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
  query: RuntimeFactQuery | undefined,
): RuntimeFact[] => {
  const out: RuntimeFact[] = [];
  for (const event of events) {
    if (
      event.type === "runtime.fact.recorded" &&
      matchesRuntimeFactQuery(query)(event.fact)
    ) {
      out.push(event.fact);
    }
  }
  return applyQueryOpts(out, query?.opts, (fact) => fact.occurredAt);
};

const runtimeStateStoreQuery = (
  query: RuntimeStateHistoryQuery,
): StoreEventQuery => ({
  entityType: query.ref.kind,
  entityId: query.ref.id,
  types: ["runtime.state.changed"],
  opts: query.opts,
});

const runtimeStateChangesFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
): RuntimeStateChange[] => {
  const out: RuntimeStateChange[] = [];
  for (const event of events) {
    if (event.type === "runtime.state.changed") {
      out.push(event.change);
    }
  }
  return out;
};

const selectEvents = <T extends AnalyticsEvent>(
  events: ReadonlyArray<AnalyticsEvent>,
  query: StoreEventQuery,
  refine: (event: AnalyticsEvent) => event is T,
): T[] => {
  const rows = events
    .filter(matchesStoreEventQuery(query))
    .filter(refine)
    .sort(byTimestampDesc((event) => event.occurredAt));
  return applyQueryOpts(rows, query.opts, (event) => event.occurredAt);
};

let inMemoryProcessStoreRunCounter = 0;

const makeRunId = (now: number): string => {
  inMemoryProcessStoreRunCounter++;
  return `run-${String(now)}-${String(inMemoryProcessStoreRunCounter)}`;
};

const eventToRuntimeRecord = (
  event: AnalyticsEvent,
  runId: string,
): RuntimeRecord => {
  const occurredAt = DateTime.makeUnsafe(event.occurredAt);
  return {
    id: event.id,
    type: event.type,
    occurredAt,
    createdAt: occurredAt,
    runId,
    processType: event.entityType,
    processId: event.entityId,
    attributes: event.attributes === undefined
      ? undefined
      : isJsonValue(event.attributes)
        ? event.attributes
        : undefined,
  };
};

const encodeJsonLine = (value: unknown): string | null =>
  Option.match(Schema.encodeUnknownOption(unknownJsonString)(value), {
    onNone: () => null,
    onSome: (line) => line,
  });

const decodeJsonLine = (line: string): unknown | null =>
  Option.match(Schema.decodeUnknownOption(unknownJsonString)(line), {
    onNone: () => null,
    onSome: (value) => value,
  });

const decodeStoredEvent = (row: EffectPmEventRow): AnalyticsEvent | null => {
  const decoded = decodeEventRow(row);
  return decoded instanceof ProcessStoreEventDecodeError ? null : decoded;
};

const decodeFileRow = (value: unknown): EffectPmEventRow | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const type = value["type"];
  const occurredAt = dateFromUnknown(value["occurredAt"]);
  const entityType = value["entityType"];
  const entityId = value["entityId"];
  const attributes = value["attributes"];
  const payload = value["payload"];
  const createdAt = dateFromUnknown(value["createdAt"]) ?? occurredAt;

  if (
    !isString(id) ||
    !isString(type) ||
    occurredAt === null ||
    !isString(entityType) ||
    !isString(entityId) ||
    !isJsonValue(payload) ||
    !(attributes === undefined || attributes === null || isJsonValue(attributes)) ||
    createdAt === null
  ) {
    return null;
  }

  return {
    id,
    type,
    occurredAt,
    entityType,
    entityId,
    attributes: attributes === undefined ? null : attributes,
    payload,
    createdAt,
  };
};

const decodeFileContents = (contents: string): AnalyticsEvent[] => {
  const out: AnalyticsEvent[] = [];
  for (const line of contents.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const value = decodeJsonLine(line);
    const row = value === null ? null : decodeFileRow(value);
    if (row === null) {
      continue;
    }
    const event = decodeStoredEvent(row);
    if (event !== null) {
      out.push(event);
    }
  }
  return out;
};

const encodeFileEventLine = (
  event: AnalyticsEvent,
  createdAt: number,
): string | null => {
  const encoded = encodeEvent(event);
  const row: { [key: string]: JsonValue } = {
    id: encoded.id,
    type: encoded.type,
    occurredAt: event.occurredAt,
    entityType: encoded.entityType,
    entityId: encoded.entityId,
    attributes: encoded.attributes ?? null,
    payload: encoded.payload,
    createdAt,
  };
  const line = encodeJsonLine(row);
  return line === null ? null : `${line}\n`;
};

// ============================================================================
// In-memory implementation
// ============================================================================

const makeInMemoryProcessStore: Effect.Effect<
  ProcessStoreInterface,
  never,
  never
> = Effect.gen(function* () {
  const events: AnalyticsEvent[] = [];
  const now = yield* Clock.currentTimeMillis;
  const runId = makeRunId(now);

  return {
    append: (event) =>
      Effect.sync(() => {
        events.push(event);
      }),

    appendBatch: (batch) =>
      Effect.sync(() => {
        for (const event of batch) {
          events.push(event);
        }
      }),

    events: (query) =>
      Effect.sync(() => {
        const rows = events
          .filter(matchesStoreEventQuery(query))
          .sort(byTimestampDesc((event) => event.occurredAt));
        return applyQueryOpts(rows, query?.opts, (event) => event.occurredAt);
      }),

    records: (query) =>
      Effect.sync(() =>
        selectRuntimeRecords(
          events.map((event) => eventToRuntimeRecord(event, runId)),
          query,
        )
      ),

    getProcessExecutions: (processId, opts) =>
      Effect.sync(() =>
        selectEvents(
          events,
          { entityType: "process", entityId: processId, types: ["process.execution.completed"], opts },
          isProcessExecutionCompleted,
        ),
      ),

    getProcessLifecycle: (processId, opts) =>
      Effect.sync(() =>
        selectEvents(
          events,
          { entityType: "process", entityId: processId, types: ["process.lifecycle.changed"], opts },
          isProcessLifecycleChanged,
        ),
      ),

    getQueueItemCompletions: (queueId, opts) =>
      Effect.sync(() =>
        selectEvents(
          events,
          { entityType: "queue", entityId: queueId, types: ["queue.item.completed"], opts },
          isQueueItemCompleted,
        ),
      ),

    getQueueLifecycle: (queueId, opts) =>
      Effect.sync(() =>
        selectEvents(
          events,
          { entityType: "queue", entityId: queueId, types: ["queue.lifecycle.changed"], opts },
          isQueueLifecycleChanged,
        ),
      ),
  };
});

const makeFileProcessStore = (
  filePath: string,
): Effect.Effect<
  ProcessStoreInterface,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const semaphore = yield* Semaphore.make(1);
    const directory = path.dirname(filePath);
    const ensureDirectory = fs
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.orDie);

    const readEvents = Effect.gen(function* () {
      yield* ensureDirectory;
      const exists = yield* fs.exists(filePath).pipe(Effect.orDie);
      if (!exists) {
        return [];
      }
      const contents = yield* fs.readFileString(filePath).pipe(Effect.orDie);
      return decodeFileContents(contents);
    });

    const appendOne = (event: AnalyticsEvent) =>
      Effect.gen(function* () {
        yield* ensureDirectory;
        const now = yield* Clock.currentTimeMillis;
        const line = encodeFileEventLine(event, now);
        if (line !== null) {
          yield* fs.writeFileString(filePath, line, { flag: "a" }).pipe(Effect.orDie);
        }
      });

    const queryEvents = (query: StoreEventQuery | undefined) =>
      Effect.map(readEvents, (storedEvents) => {
        const rows = storedEvents
          .filter(matchesStoreEventQuery(query))
          .sort(byTimestampDesc((event) => event.occurredAt));
        return applyQueryOpts(rows, query?.opts, (event) => event.occurredAt);
      });

    const queryRecords = (query: RuntimeRecordQuery | undefined) =>
      Effect.map(readEvents, (storedEvents) =>
        selectRuntimeRecords(
          storedEvents.map((event) => eventToRuntimeRecord(event, "file-store")),
          query,
        )
      );

    return {
      append: (event) => semaphore.withPermits(1)(appendOne(event)),
      appendBatch: (batch) =>
        semaphore.withPermits(1)(
          Effect.gen(function* () {
            for (const event of batch) {
              yield* appendOne(event);
            }
          }),
        ),
      events: (query) => semaphore.withPermits(1)(queryEvents(query)),
      records: (query) => semaphore.withPermits(1)(queryRecords(query)),
      getProcessExecutions: (processId, opts) =>
        semaphore.withPermits(1)(
          Effect.map(
            queryEvents({
              entityType: "process",
              entityId: processId,
              types: ["process.execution.completed"],
              opts,
            }),
            (rows) => rows.filter(isProcessExecutionCompleted),
          ),
        ),
      getProcessLifecycle: (processId, opts) =>
        semaphore.withPermits(1)(
          Effect.map(
            queryEvents({
              entityType: "process",
              entityId: processId,
              types: ["process.lifecycle.changed"],
              opts,
            }),
            (rows) => rows.filter(isProcessLifecycleChanged),
          ),
        ),
      getQueueItemCompletions: (queueId, opts) =>
        semaphore.withPermits(1)(
          Effect.map(
            queryEvents({
              entityType: "queue",
              entityId: queueId,
              types: ["queue.item.completed"],
              opts,
            }),
            (rows) => rows.filter(isQueueItemCompleted),
          ),
        ),
      getQueueLifecycle: (queueId, opts) =>
        semaphore.withPermits(1)(
          Effect.map(
            queryEvents({
              entityType: "queue",
              entityId: queueId,
              types: ["queue.lifecycle.changed"],
              opts,
            }),
            (rows) => rows.filter(isQueueLifecycleChanged),
          ),
        ),
    };
  });

// ============================================================================
// Public Service
// ============================================================================

/**
 * Context tag for {@link ProcessStoreInterface} (in-memory implementation by default).
 *
 * @public
 */
export class ProcessStore extends Context.Service<
  ProcessStore,
  ProcessStoreInterface
>()("@nikscripts/effect-pm/ProcessStore", {
  make: makeInMemoryProcessStore,
}) {}

export namespace ProcessStore {
  /**
   * `Layer` that provides {@link ProcessStore} backed by an in-memory event list.
   *
   * @public
   */
  export const layer = Layer.effect(ProcessStore, makeInMemoryProcessStore);
  /**
   * Raw `Effect` that materializes {@link ProcessStoreInterface} (no `Layer` wrapper).
   * Useful in tests that call `Effect.provideService` manually.
   *
   * @public
   */
  export const memory = makeInMemoryProcessStore;

  /**
   * Raw `Effect` that materializes a file-backed {@link ProcessStoreInterface}.
   *
   * @public
   */
  export const file = makeFileProcessStore;

  /**
   * `Layer` that provides {@link ProcessStore} backed by an append-only NDJSON file.
   *
   * @public
   */
  export const fileLayer = (filePath: string) =>
    Layer.effect(ProcessStore, makeFileProcessStore(filePath));

  /**
   * Generic runtime projections derived from {@link ProcessStoreInterface.events}.
   *
   * @public
   */
  export const runtime = {
    facts: (query?: RuntimeFactQuery): Effect.Effect<RuntimeFact[], never, ProcessStore> =>
      Effect.gen(function* () {
        const store = yield* ProcessStore;
        const events = yield* store.events(runtimeFactStoreQuery(query));
        return runtimeFactsFromEvents(events, query);
      }),
    stateHistory: (
      query: RuntimeStateHistoryQuery,
    ): Effect.Effect<RuntimeStateChange[], never, ProcessStore> =>
      Effect.gen(function* () {
        const store = yield* ProcessStore;
        const events = yield* store.events(runtimeStateStoreQuery(query));
        return runtimeStateChangesFromEvents(events);
      }),
    latestState: (
      ref: RuntimeRef,
    ): Effect.Effect<Option.Option<RuntimeStateBase>, never, ProcessStore> =>
      Effect.map(
        ProcessStore.runtime.stateHistory({ ref, opts: { limit: 1 } }),
        (changes) =>
          changes[0] === undefined
            ? Option.none()
            : Option.some(changes[0].current),
      ),
  } as const;

  /**
   * Typed RunResource projections derived from generic runtime facts.
   *
   * @public
   */
  export const runResource = {
    history: (
      resourceId: string,
      opts?: QueryOpts,
    ): Effect.Effect<RuntimeFact[], never, ProcessStore> =>
      runtime.facts({
        ref: { kind: "run-resource", id: resourceId },
        opts,
      }),
  } as const;
}

