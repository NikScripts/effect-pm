/**
 * **ProcessStore** — runtime record storage facade for processes and resources.
 *
 * @remarks
 * `ProcessStore` is the module-facing storage facade. The default in-memory
 * implementation persists normalized runtime records and projects legacy
 * analytics events from those records for compatibility.
 *
 * ## Storage model (read this before adding persistence)
 *
 * There is **one** persistence stack:
 *
 * 1. **`RuntimeStorage`** — raw port over normalized {@link RuntimeRecord} rows
 *    (create/read/update/delete). Swap adapters here (memory, SQLite, Prisma, …).
 * 2. **`ProcessStore`** — module-facing client on top of `RuntimeStorage`: append/read
 *    analytics events, queue resource helpers, runtime projections.
 *
 * **Do not** add parallel “log storage layers”, file-backed `ProcessStore` shortcuts for
 * new code, or domain modules that compose SQLite under their own name. Provide
 * `RuntimeStorage` (or `ProcessStore.layer` / {@link ProcessStore.layerRuntimeStorage} /
 * {@link ProcessStore.layerSqlite}) at app/child launch; use {@link Logs} (and similar)
 * only for encoding and querying event shapes through `ProcessStore`.
 *
 * Default in-memory: {@link ProcessStore.layer}. Durable local: {@link ProcessStore.layerSqlite}.
 * **Legacy only:** {@link ProcessStore.fileLayer} (NDJSON, not `RuntimeStorage`).
 *
 * @module ProcessStore
 */

import {
  Clock,
  Context,
  Data,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Scope,
  Semaphore,
  Schema,
} from "effect";
import { SQLiteRuntimeStorage } from "./storage/sqlite/index.js";
import type { SQLiteRuntimeStorageConfig } from "./storage/sqlite/public-types.js";
import {
  And,
  Key,
  ProcessId,
  ProcessType,
  SubjectId,
  SubjectType,
  type RuntimeRecordPredicate,
} from "./Query";
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
  RuntimeStorage,
  type RuntimeStorageError,
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  selectRuntimeRecords,
  type RuntimeRecord,
  type RuntimeStorageService,
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

/** @public */
export type ProcessStoreQueueResourcePriority = "high" | "normal" | "low";

/** @public */
export type ProcessStoreQueueResourceEntryStatus =
  | "enqueued"
  | "started"
  | "completed"
  | "failed"
  | "retried"
  | "exhausted"
  | "released"
  | "dead-lettered"
  | "dropped";

/** @public */
export type ProcessStoreQueueResourceLifecycleTag = QueueLifecycleTag | "Drained";

/** @public */
export type ProcessStoreQueueResourceDedupeKeyStatus =
  | "added"
  | "released"
  | "hydrated";

/** @public */
export interface ProcessStoreQueueResourceContext {
  readonly queueId?: string;
  readonly entryId?: string;
  readonly key?: string;
  readonly batchId?: string;
  readonly releaseId?: string;
  readonly dedupeKey?: string;
}

/** @public */
export interface ProcessStoreQueueResourceEntryInput {
  readonly queueId?: string;
  readonly entryId?: string;
  readonly key?: string;
  readonly priority?: ProcessStoreQueueResourcePriority;
  readonly attempts?: number;
  readonly durationMs?: number;
  readonly error?: string;
  readonly batchId?: string;
  readonly releaseId?: string;
  readonly occurredAt?: DateTime.Utc;
  readonly enqueuedAt?: DateTime.Utc;
  readonly startedAt?: DateTime.Utc;
  readonly interruptedAt?: DateTime.Utc;
  readonly payload?: JsonValue;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

/** @public */
export interface ProcessStoreQueueResourceLifecycleInput {
  readonly queueId?: string;
  readonly tag: ProcessStoreQueueResourceLifecycleTag;
  readonly itemsCleared?: number;
  readonly occurredAt?: DateTime.Utc;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

/** @public */
export interface ProcessStoreQueueResourceDedupeKeyInput {
  readonly queueId?: string;
  readonly key?: string;
  readonly occurredAt?: DateTime.Utc;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

/** @public */
export class ProcessStoreQueueResourceContextError extends Data.TaggedError(
  "ProcessStoreQueueResourceContextError",
)<{
  readonly field: "queueId" | "entryId" | "key";
}> {}

/** @public */
export class ProcessStoreDuplicateRecordError extends Data.TaggedError(
  "ProcessStoreDuplicateRecordError",
)<{
  readonly id: string;
}> {}

/** @public */
export class ProcessStoreReadonlyRecordError extends Data.TaggedError(
  "ProcessStoreReadonlyRecordError",
)<{
  readonly id: string;
}> {}

/** @public */
export type ProcessStoreWriteError =
  | ProcessStoreDuplicateRecordError
  | ProcessStoreReadonlyRecordError;

/** @public */
export interface ProcessStoreQueueResourceApi {
  readonly withQueue: <A, E, R>(
    queueId: string,
    use: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly withEntry: <A, E, R>(
    entryId: string,
    use: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly withBatch: <A, E, R>(
    batchId: string,
    use: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly withDedupeKey: <A, E, R>(
    key: string,
    use: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly entryEnqueued: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryStarted: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryCompleted: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryFailed: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryRetried: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryExhausted: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryReleased: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryDeadLettered: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryDropped: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly lifecycleChanged: (
    input: ProcessStoreQueueResourceLifecycleInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly dedupeKeyAdded: (
    input?: ProcessStoreQueueResourceDedupeKeyInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly dedupeKeyReleased: (
    input?: ProcessStoreQueueResourceDedupeKeyInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly dedupeKeyHydrated: (
    input?: ProcessStoreQueueResourceDedupeKeyInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entries: (
    queueId?: string,
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
  readonly entry: (
    entryId: string,
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<Option.Option<RuntimeRecord>>;
  readonly entriesByKey: (
    key: string,
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
  readonly dedupeKeys: (
    queueId?: string,
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
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

/**
 * Structured group log line persisted for operator `pm logs` history.
 *
 * @public
 */
export interface GroupLogEntryRecordedEvent extends AnalyticsEventBase {
  type: "group.log.entry";
  entityType: "group";
  log: {
    readonly entryId: string;
    readonly entry: {
      readonly date: string;
      readonly level: string;
      readonly message: string;
      readonly cause?: string;
      readonly annotations: Readonly<Record<string, string>>;
      readonly spans: ReadonlyArray<string>;
    };
  };
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
  | RuntimeStateChangedEvent
  | GroupLogEntryRecordedEvent;

/**
 * Storage port implemented by the in-memory service and the Prisma-backed adapter
 * (`@nikscripts/effect-pm/prisma`).
 *
 * @public
 */
export interface ProcessStoreInterface {
  append: (event: AnalyticsEvent) => Effect.Effect<void, ProcessStoreWriteError>;
  appendBatch: (events: ReadonlyArray<AnalyticsEvent>) => Effect.Effect<void, ProcessStoreWriteError>;
  events: (query?: StoreEventQuery) => Effect.Effect<AnalyticsEvent[]>;
  records: (query?: RuntimeRecordQuery) => Effect.Effect<RuntimeRecord[]>;
  queueResource: ProcessStoreQueueResourceApi;
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

/**
 * @public
 */
export const isGroupLogEntryRecorded = (
  event: AnalyticsEvent,
): event is GroupLogEntryRecordedEvent =>
  event.type === "group.log.entry" && event.entityType === "group";

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

const queueResourceProcessType = "queue-resource";
const queueResourceEntrySubjectType = "queue-entry";
const queueResourceDedupeSubjectType = "queue-dedupe-key";
const queueResourceLifecycleSubjectType = "queue-lifecycle";
const queueResourceIndexNames = ["batchId", "releaseId"];

class ProcessStoreQueueResourceContextTag extends Context.Service<
  ProcessStoreQueueResourceContextTag,
  ProcessStoreQueueResourceContext
>()("@nikscripts/effect-pm/ProcessStore/ProcessStoreQueueResourceContextTag") {}

const currentQueueResourceContext: Effect.Effect<ProcessStoreQueueResourceContext> =
  Effect.serviceOption(ProcessStoreQueueResourceContextTag).pipe(
    Effect.map(
      Option.match({
        onNone: (): ProcessStoreQueueResourceContext => ({}),
        onSome: (context) => context,
      }),
    ),
  );

const stringAttribute = (
  attributes: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  const value = attributes?.[key];
  return isString(value) ? value : undefined;
};

const stringArrayAttribute = (
  attributes: Record<string, unknown> | undefined,
  key: string,
): ReadonlyArray<string> | undefined => {
  const value = attributes?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (!isString(item)) {
      return undefined;
    }
    out.push(item);
  }
  return out;
};

const runtimeRecordPayload = (event: AnalyticsEvent): JsonValue | undefined => {
  if (event.type === "runtime.fact.recorded") {
    return isJsonValue(event.fact.payload) ? event.fact.payload : undefined;
  }
  const payload = encodeEvent(event).payload;
  return isJsonValue(payload) ? payload : undefined;
};

const runtimeRecordType = (event: AnalyticsEvent): string =>
  event.type === "runtime.fact.recorded" ? event.fact.type : event.type;

const runtimeRecordOccurredAt = (event: AnalyticsEvent): number =>
  event.type === "runtime.fact.recorded" ? event.fact.occurredAt : event.occurredAt;

const runtimeRecordAttributes = (event: AnalyticsEvent): JsonValue | undefined => {
  const out: { [key: string]: JsonValue } = {};
  let hasAttributes = false;
  if (
    event.attributes !== undefined &&
    isJsonValue(event.attributes) &&
    isRecord(event.attributes)
  ) {
    for (const [key, value] of Object.entries(event.attributes)) {
      if (isJsonValue(value)) {
        out[key] = value;
        hasAttributes = true;
      }
    }
  }
  if (event.type === "runtime.fact.recorded") {
    out["factId"] = event.fact.id;
    hasAttributes = true;
  }
  return hasAttributes ? out : undefined;
};

const isLegacyEventRecordType = (type: string): type is Exclude<
  AnalyticsEvent["type"],
  "runtime.fact.recorded"
> => {
  switch (type) {
    case "process.execution.completed":
    case "process.lifecycle.changed":
    case "queue.item.completed":
    case "queue.lifecycle.changed":
    case "runtime.state.changed":
    case "group.log.entry":
      return true;
    default:
      return false;
  }
};

const recordAttributes = (
  value: JsonValue | undefined,
): Record<string, unknown> | undefined => {
  if (value === undefined || !isRecord(value)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = item;
  }
  return out;
};

const recordToStoredEventRow = (record: RuntimeRecord): EffectPmEventRow | null => {
  if (!isLegacyEventRecordType(record.type)) {
    return null;
  }
  const payload = record.payload;
  if (payload === undefined) {
    return null;
  }
  if (!isJsonValue(payload)) {
    return null;
  }
  return {
    id: record.id,
    type: record.type,
    occurredAt: DateTime.toDateUtc(record.occurredAt),
    entityType: record.processType,
    entityId: record.processId,
    attributes: record.attributes ?? null,
    payload,
    createdAt: DateTime.toDateUtc(record.createdAt),
  };
};

const recordToAnalyticsEvent = (record: RuntimeRecord): AnalyticsEvent | null => {
  const row = recordToStoredEventRow(record);
  if (row !== null) {
    return decodeStoredEvent(row);
  }
  const occurredAt = DateTime.toEpochMillis(record.occurredAt);
  const attributes = recordAttributes(record.attributes);
  const factId = stringAttribute(attributes, "factId") ?? record.id;
  return {
    id: record.id,
    type: "runtime.fact.recorded",
    occurredAt,
    entityType: record.processType,
    entityId: record.processId,
    attributes,
    fact: {
      id: factId,
      ref: { kind: record.processType, id: record.processId },
      type: record.type,
      occurredAt,
      payload: record.payload ?? null,
      attributes,
    },
  };
};

const recordsToEvents = (
  records: ReadonlyArray<RuntimeRecord>,
): AnalyticsEvent[] => {
  const out: AnalyticsEvent[] = [];
  for (const record of records) {
    const event = recordToAnalyticsEvent(record);
    if (event !== null) {
      out.push(event);
    }
  }
  return out;
};

const requireQueueResourceField = (
  value: string | undefined,
  field: "queueId" | "entryId" | "key",
): Effect.Effect<string, ProcessStoreQueueResourceContextError> =>
  value === undefined
    ? Effect.fail(new ProcessStoreQueueResourceContextError({ field }))
    : Effect.succeed(value);

const processStoreWriteErrorFromRuntimeStorage = (
  error: RuntimeStorageError,
): ProcessStoreWriteError => {
  if (error instanceof RuntimeStorageDuplicateRecordError) {
    return new ProcessStoreDuplicateRecordError({ id: error.id });
  }
  if (error instanceof RuntimeStorageReadonlyRecordError) {
    return new ProcessStoreReadonlyRecordError({ id: error.id });
  }
  return error;
};

const withRuntimePredicate = (
  query: RuntimeRecordQuery | undefined,
  predicate: RuntimeRecordPredicate,
): RuntimeRecordQuery => ({
  ...query,
  predicate: query?.predicate === undefined
    ? predicate
    : And([predicate, query.predicate]),
});

const queueEntryPredicate = (queueId?: string): RuntimeRecordPredicate => {
  const predicates: RuntimeRecordPredicate[] = [
    ProcessType.equals(queueResourceProcessType),
    SubjectType.equals(queueResourceEntrySubjectType),
  ];
  if (queueId !== undefined) {
    predicates.push(ProcessId.equals(queueId));
  }
  return And(predicates);
};

const queueDedupePredicate = (queueId?: string): RuntimeRecordPredicate => {
  const predicates: RuntimeRecordPredicate[] = [
    ProcessType.equals(queueResourceProcessType),
    SubjectType.equals(queueResourceDedupeSubjectType),
  ];
  if (queueId !== undefined) {
    predicates.push(ProcessId.equals(queueId));
  }
  return And(predicates);
};

const dateMillis = (date: DateTime.Utc): number => DateTime.toEpochMillis(date);

const entryFactType = (status: ProcessStoreQueueResourceEntryStatus): string =>
  `queue.entry.${status}`;

const dedupeFactType = (status: ProcessStoreQueueResourceDedupeKeyStatus): string =>
  `queue.dedupe-key.${status}`;

const lifecycleFactType = (tag: ProcessStoreQueueResourceLifecycleTag): string =>
  `queue.lifecycle.${tag.toLowerCase()}`;

const entryPayload = (
  status: ProcessStoreQueueResourceEntryStatus,
  input: ProcessStoreQueueResourceEntryInput,
): JsonValue => {
  const payload: { [key: string]: JsonValue } = { status };
  if (input.priority !== undefined) payload["priority"] = input.priority;
  if (input.attempts !== undefined) payload["attempts"] = input.attempts;
  if (input.durationMs !== undefined) payload["durationMs"] = input.durationMs;
  if (input.error !== undefined) payload["error"] = input.error;
  if (input.enqueuedAt !== undefined) payload["enqueuedAt"] = dateMillis(input.enqueuedAt);
  if (input.startedAt !== undefined) payload["startedAt"] = dateMillis(input.startedAt);
  if (input.interruptedAt !== undefined) payload["interruptedAt"] = dateMillis(input.interruptedAt);
  if (input.payload !== undefined) payload["payload"] = input.payload;
  if (input.attributes !== undefined) payload["attributes"] = input.attributes;
  return payload;
};

const lifecyclePayload = (
  input: ProcessStoreQueueResourceLifecycleInput,
): JsonValue => {
  const payload: { [key: string]: JsonValue } = { tag: input.tag };
  if (input.itemsCleared !== undefined) {
    payload["itemsCleared"] = input.itemsCleared;
  }
  if (input.attributes !== undefined) {
    payload["attributes"] = input.attributes;
  }
  return payload;
};

const dedupePayload = (
  status: ProcessStoreQueueResourceDedupeKeyStatus,
  input: ProcessStoreQueueResourceDedupeKeyInput,
): JsonValue => {
  const payload: { [key: string]: JsonValue } = { status };
  if (input.attributes !== undefined) {
    payload["attributes"] = input.attributes;
  }
  return payload;
};

/** @internal */
export const makeProcessStoreQueueResource = (config: {
  readonly append: (event: AnalyticsEvent) => Effect.Effect<void, ProcessStoreWriteError, never>;
  readonly records: (query?: RuntimeRecordQuery) => Effect.Effect<RuntimeRecord[], never, never>;
}): ProcessStoreQueueResourceApi => {
  let sequence = 0;

  const nextFactId = (queueId: string, type: string, occurredAt: number): string => {
    sequence++;
    return `${queueId}/${type}/${String(occurredAt)}/${String(sequence)}`;
  };

  const appendFact = (
    queueId: string,
    type: string,
    occurredAt: DateTime.Utc,
    subjectType: string,
    payload: JsonValue,
    context: ProcessStoreQueueResourceContext,
    input: {
      readonly entryId?: string;
      readonly key?: string;
      readonly batchId?: string;
      readonly releaseId?: string;
    },
  ): Effect.Effect<void, ProcessStoreWriteError, never> => {
    const occurredAtMillis = dateMillis(occurredAt);
    const id = nextFactId(queueId, type, occurredAtMillis);
    const subjectId = input.entryId ?? context.entryId ?? input.key ?? context.dedupeKey ?? queueId;
    const key = input.key ?? context.key ?? context.dedupeKey;
    const batchId = input.batchId ?? context.batchId;
    const releaseId = input.releaseId ?? context.releaseId;
    const attributes: Record<string, unknown> = {
      processType: queueResourceProcessType,
      processId: queueId,
      subjectType,
      subjectId,
      indexNames: queueResourceIndexNames,
    };
    if (key !== undefined) attributes["key"] = key;
    if (batchId !== undefined) attributes["indexA"] = batchId;
    if (releaseId !== undefined) attributes["indexB"] = releaseId;

    const event: RuntimeFactRecordedEvent = {
      id,
      type: "runtime.fact.recorded",
      occurredAt: occurredAtMillis,
      entityType: queueResourceProcessType,
      entityId: queueId,
      attributes,
      fact: {
        id,
        ref: { kind: queueResourceProcessType, id: queueId },
        type,
        occurredAt: occurredAtMillis,
        payload,
        attributes,
      },
    };
    return config.append(event);
  };

  const writeEntry = (
    status: ProcessStoreQueueResourceEntryStatus,
    input: ProcessStoreQueueResourceEntryInput | undefined,
  ): Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError> =>
    Effect.gen(function* () {
      const ctx = yield* currentQueueResourceContext;
      const entryInput = input ?? {};
      const queueId = yield* requireQueueResourceField(
        entryInput.queueId ?? ctx.queueId,
        "queueId",
      );
      yield* appendFact(
        queueId,
        entryFactType(status),
        entryInput.occurredAt ?? (yield* Effect.map(Clock.currentTimeMillis, DateTime.makeUnsafe)),
        queueResourceEntrySubjectType,
        entryPayload(status, entryInput),
        ctx,
        {
          entryId: entryInput.entryId,
          key: entryInput.key,
          batchId: entryInput.batchId,
          releaseId: entryInput.releaseId,
        },
      );
    });

  const writeDedupe = (
    status: ProcessStoreQueueResourceDedupeKeyStatus,
    input: ProcessStoreQueueResourceDedupeKeyInput | undefined,
  ): Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError> =>
    Effect.gen(function* () {
      const ctx = yield* currentQueueResourceContext;
      const dedupeInput = input ?? {};
      const queueId = yield* requireQueueResourceField(
        dedupeInput.queueId ?? ctx.queueId,
        "queueId",
      );
      const key = yield* requireQueueResourceField(
        dedupeInput.key ?? ctx.dedupeKey ?? ctx.key,
        "key",
      );
      yield* appendFact(
        queueId,
        dedupeFactType(status),
        dedupeInput.occurredAt ?? (yield* Effect.map(Clock.currentTimeMillis, DateTime.makeUnsafe)),
        queueResourceDedupeSubjectType,
        dedupePayload(status, dedupeInput),
        ctx,
        { key },
      );
    });

  return {
    withQueue: (queueId, use) =>
      Effect.flatMap(currentQueueResourceContext, (ctx) =>
        use.pipe(Effect.provideService(ProcessStoreQueueResourceContextTag, { ...ctx, queueId }))
      ),
    withEntry: (entryId, use) =>
      Effect.flatMap(currentQueueResourceContext, (ctx) =>
        use.pipe(Effect.provideService(ProcessStoreQueueResourceContextTag, { ...ctx, entryId }))
      ),
    withBatch: (batchId, use) =>
      Effect.flatMap(currentQueueResourceContext, (ctx) =>
        use.pipe(Effect.provideService(ProcessStoreQueueResourceContextTag, { ...ctx, batchId }))
      ),
    withDedupeKey: (key, use) =>
      Effect.flatMap(currentQueueResourceContext, (ctx) =>
        use.pipe(
          Effect.provideService(ProcessStoreQueueResourceContextTag, {
            ...ctx,
            key,
            dedupeKey: key,
          }),
        )
      ),
    entryEnqueued: (input) => writeEntry("enqueued", input),
    entryStarted: (input) => writeEntry("started", input),
    entryCompleted: (input) => writeEntry("completed", input),
    entryFailed: (input) => writeEntry("failed", input),
    entryRetried: (input) => writeEntry("retried", input),
    entryExhausted: (input) => writeEntry("exhausted", input),
    entryReleased: (input) => writeEntry("released", input),
    entryDeadLettered: (input) => writeEntry("dead-lettered", input),
    entryDropped: (input) => writeEntry("dropped", input),
    lifecycleChanged: (input) =>
      Effect.gen(function* () {
        const ctx = yield* currentQueueResourceContext;
        const queueId = yield* requireQueueResourceField(input.queueId ?? ctx.queueId, "queueId");
        yield* appendFact(
          queueId,
          lifecycleFactType(input.tag),
          input.occurredAt ?? (yield* Effect.map(Clock.currentTimeMillis, DateTime.makeUnsafe)),
          queueResourceLifecycleSubjectType,
          lifecyclePayload(input),
          ctx,
          {},
        );
      }),
    dedupeKeyAdded: (input) => writeDedupe("added", input),
    dedupeKeyReleased: (input) => writeDedupe("released", input),
    dedupeKeyHydrated: (input) => writeDedupe("hydrated", input),
    entries: (queueId, query) =>
      config.records(withRuntimePredicate(query, queueEntryPredicate(queueId))),
    entry: (entryId, query) =>
      Effect.map(
        config.records(
          withRuntimePredicate(
            query,
            And([queueEntryPredicate(), SubjectId.equals(entryId)]),
          ),
        ),
        (rows) => rows[0] === undefined ? Option.none() : Option.some(rows[0]),
      ),
    entriesByKey: (key, query) =>
      config.records(withRuntimePredicate(query, And([queueEntryPredicate(), Key.equals(key)]))),
    dedupeKeys: (queueId, query) =>
      config.records(withRuntimePredicate(query, queueDedupePredicate(queueId))),
  };
};

const eventToRuntimeRecord = (
  event: AnalyticsEvent,
  runId: string,
): RuntimeRecord => {
  const attributes = event.attributes;
  const recordAttributes = runtimeRecordAttributes(event);
  const occurredAt = DateTime.makeUnsafe(runtimeRecordOccurredAt(event));
  return {
    id: event.id,
    type: runtimeRecordType(event),
    occurredAt,
    createdAt: DateTime.makeUnsafe(event.occurredAt),
    runId,
    processType: stringAttribute(attributes, "processType") ?? event.entityType,
    processId: stringAttribute(attributes, "processId") ?? event.entityId,
    subjectType: stringAttribute(attributes, "subjectType"),
    subjectId: stringAttribute(attributes, "subjectId"),
    key: stringAttribute(attributes, "key"),
    indexA: stringAttribute(attributes, "indexA"),
    indexB: stringAttribute(attributes, "indexB"),
    indexC: stringAttribute(attributes, "indexC"),
    indexD: stringAttribute(attributes, "indexD"),
    indexE: stringAttribute(attributes, "indexE"),
    indexF: stringAttribute(attributes, "indexF"),
    indexG: stringAttribute(attributes, "indexG"),
    indexH: stringAttribute(attributes, "indexH"),
    indexNames: stringArrayAttribute(attributes, "indexNames"),
    payload: runtimeRecordPayload(event),
    attributes: recordAttributes,
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

const makeRuntimeStorageProcessStore = (
  storage: RuntimeStorageService,
  runId: string,
): ProcessStoreInterface => {
  const appendEvent = (event: AnalyticsEvent) =>
    storage.create(eventToRuntimeRecord(event, runId)).pipe(
      Effect.mapError(processStoreWriteErrorFromRuntimeStorage),
    );
  const readRecords = (query: RuntimeRecordQuery | undefined) =>
    storage.read(query);
  const readEvents = (query: StoreEventQuery | undefined) =>
    Effect.map(storage.read(), (records) => {
      const rows = recordsToEvents(records)
        .filter(matchesStoreEventQuery(query))
        .sort(byTimestampDesc((event) => event.occurredAt));
      return applyQueryOpts(rows, query?.opts, (event) => event.occurredAt);
    });

  return {
    append: appendEvent,

    appendBatch: (batch) =>
      Effect.forEach(batch, appendEvent, { discard: true }),

    events: readEvents,

    records: readRecords,

    queueResource: makeProcessStoreQueueResource({
      append: appendEvent,
      records: readRecords,
    }),

    getProcessExecutions: (processId, opts) =>
      Effect.map(readEvents({
        entityType: "process",
        entityId: processId,
        types: ["process.execution.completed"],
        opts,
      }), (events) =>
        selectEvents(
          events,
          { entityType: "process", entityId: processId, types: ["process.execution.completed"], opts },
          isProcessExecutionCompleted,
        ),
      ),

    getProcessLifecycle: (processId, opts) =>
      Effect.map(readEvents({
        entityType: "process",
        entityId: processId,
        types: ["process.lifecycle.changed"],
        opts,
      }), (events) =>
        selectEvents(
          events,
          { entityType: "process", entityId: processId, types: ["process.lifecycle.changed"], opts },
          isProcessLifecycleChanged,
        ),
      ),

    getQueueItemCompletions: (queueId, opts) =>
      Effect.map(readEvents({
        entityType: "queue",
        entityId: queueId,
        types: ["queue.item.completed"],
        opts,
      }), (events) =>
        selectEvents(
          events,
          { entityType: "queue", entityId: queueId, types: ["queue.item.completed"], opts },
          isQueueItemCompleted,
        ),
      ),

    getQueueLifecycle: (queueId, opts) =>
      Effect.map(readEvents({
        entityType: "queue",
        entityId: queueId,
        types: ["queue.lifecycle.changed"],
        opts,
      }), (events) =>
        selectEvents(
          events,
          { entityType: "queue", entityId: queueId, types: ["queue.lifecycle.changed"], opts },
          isQueueLifecycleChanged,
        ),
      ),
  };
};

const makeInMemoryProcessStore: Effect.Effect<
  ProcessStoreInterface,
  never,
  never
> = Effect.gen(function* () {
  const storage = yield* RuntimeStorage.memory;
  const now = yield* Clock.currentTimeMillis;
  return makeRuntimeStorageProcessStore(storage, makeRunId(now));
});

const makeProcessStoreFromRuntimeStorage: Effect.Effect<
  ProcessStoreInterface,
  never,
  RuntimeStorage
> = Effect.gen(function* () {
  const storage = yield* RuntimeStorage;
  const now = yield* Clock.currentTimeMillis;
  return makeRuntimeStorageProcessStore(storage, makeRunId(now));
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
    const appendSerializedEvent = (event: AnalyticsEvent) =>
      semaphore.withPermits(1)(appendOne(event));
    const readSerializedRecords = (query: RuntimeRecordQuery | undefined) =>
      semaphore.withPermits(1)(queryRecords(query));

    return {
      append: appendSerializedEvent,
      appendBatch: (batch) =>
        semaphore.withPermits(1)(
          Effect.gen(function* () {
            for (const event of batch) {
              yield* appendOne(event);
            }
          }),
        ),
      events: (query) => semaphore.withPermits(1)(queryEvents(query)),
      records: readSerializedRecords,
      queueResource: makeProcessStoreQueueResource({
        append: appendSerializedEvent,
        records: readSerializedRecords,
      }),
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
   * `Layer` that provides {@link ProcessStore} from an injected {@link RuntimeStorage}.
   *
   * @public
   */
  export const layerRuntimeStorage: Layer.Layer<ProcessStore, never, RuntimeStorage> =
    Layer.effect(ProcessStore, makeProcessStoreFromRuntimeStorage);

  /**
   * `ProcessStore` backed by SQLite {@link RuntimeStorage} (canonical durable local stack).
   *
   * @remarks
   * Equivalent to `Layer.provide(layerRuntimeStorage, SQLiteRuntimeStorage.layer(config))`.
   * Use at composition root (group child, tests, examples)—not inside `Logs` or other
   * domain modules.
   *
   * @public
   */
  export const layerSqlite = (
    config: SQLiteRuntimeStorageConfig,
  ): Layer.Layer<ProcessStore, never, Scope.Scope> =>
    Layer.provide(layerRuntimeStorage, SQLiteRuntimeStorage.layer(config)).pipe(
      Layer.orDie,
    );

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
   * @deprecated **Do not use for new code.** Legacy append-only NDJSON compatibility
   * only. Prefer {@link ProcessStore.layerRuntimeStorage} with SQLite or Prisma adapters.
   *
   * @public
   */
  export const file = makeFileProcessStore;

  /**
   * `Layer` that provides {@link ProcessStore} backed by an append-only NDJSON file.
   *
   * @deprecated **Do not use for new code.** See {@link ProcessStore.file}.
   *
   * @public
   */
  export const fileLayer = (filePath: string) =>
    Layer.effect(ProcessStore, makeFileProcessStore(filePath));

  /**
   * QueueResource semantic storage helpers.
   *
   * @public
   */
  export const QueueResource = {
    withQueue: <A, E, R>(queueId: string, use: Effect.Effect<A, E, R>) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.withQueue(queueId, use)),
    withEntry: <A, E, R>(entryId: string, use: Effect.Effect<A, E, R>) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.withEntry(entryId, use)),
    withBatch: <A, E, R>(batchId: string, use: Effect.Effect<A, E, R>) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.withBatch(batchId, use)),
    withDedupeKey: <A, E, R>(key: string, use: Effect.Effect<A, E, R>) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.withDedupeKey(key, use)),
    entryEnqueued: (input?: ProcessStoreQueueResourceEntryInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.entryEnqueued(input)),
    entryStarted: (input?: ProcessStoreQueueResourceEntryInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.entryStarted(input)),
    entryCompleted: (input?: ProcessStoreQueueResourceEntryInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.entryCompleted(input)),
    entryFailed: (input?: ProcessStoreQueueResourceEntryInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.entryFailed(input)),
    entryRetried: (input?: ProcessStoreQueueResourceEntryInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.entryRetried(input)),
    entryExhausted: (input?: ProcessStoreQueueResourceEntryInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.entryExhausted(input)),
    lifecycleChanged: (input: ProcessStoreQueueResourceLifecycleInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.lifecycleChanged(input)),
    dedupeKeyAdded: (input?: ProcessStoreQueueResourceDedupeKeyInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.dedupeKeyAdded(input)),
    dedupeKeyReleased: (input?: ProcessStoreQueueResourceDedupeKeyInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.dedupeKeyReleased(input)),
    dedupeKeyHydrated: (input?: ProcessStoreQueueResourceDedupeKeyInput) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.dedupeKeyHydrated(input)),
    entries: (queueId?: string, query?: RuntimeRecordQuery) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.entries(queueId, query)),
    entry: (entryId: string, query?: RuntimeRecordQuery) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.entry(entryId, query)),
    entriesByKey: (key: string, query?: RuntimeRecordQuery) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.entriesByKey(key, query)),
    dedupeKeys: (queueId?: string, query?: RuntimeRecordQuery) =>
      Effect.flatMap(ProcessStore, (store) => store.queueResource.dedupeKeys(queueId, query)),
  };

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

