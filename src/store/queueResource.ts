/**
 * **Queue resource storage facet** — durable, queryable history of one
 * priority-aware {@link QueueResource} worker.
 *
 * @remarks
 * Per-domain facet for {@link QueueResource}. Owns 18 concrete
 * wire-event types and their `Queue*Fact` / `Queue*Change` value
 * shapes; reads return typed unions, not generic envelopes.
 *
 * ## Wire types at a glance
 *
 * | Subject | Wire types | Indexed columns |
 * |---------|-----------|-----------------|
 * | `queue-entry` (× 9) | `queue.entry.enqueued`, `.started`, `.completed`, `.failed`, `.retried`, `.exhausted`, `.released`, `.dead-lettered`, `.dropped` | `subjectId = entryId`, `key = fact.key`, `indexA = batchId`, `indexB = releaseId` (released only) |
 * | `queue-lifecycle` (× 6) | `queue.lifecycle.started`, `.paused`, `.resumed`, `.shutdown`, `.cleared`, `.drained` | `subjectId = queueId` |
 * | `queue-dedupe-key` (× 3) | `queue.dedupe-key.added`, `.released`, `.hydrated` | `subjectId = key`, `key = key` |
 *
 * Every record carries `processType: "queue-resource"` and
 * `processId: <queueId>`. Indexed columns let per-key, per-batch, and
 * per-release lookups push down to SQL without scanning the payload.
 *
 * ## Emit (optional)
 *
 * `QueueResource.make` calls the **static** record helpers on this
 * class (`QueueResourceStore.recordEntry`, `.recordLifecycle`,
 * `.recordDedupeKey`, plus their `*Batch` variants). When the facet
 * layer is not composed each call is a silent no-op; when composed it
 * writes through the spine and surfaces typed write failures. Queue internals
 * wrap telemetry-only writes with `ProcessStore.catchErrorAndLog`.
 *
 * ## Read
 *
 * Reads come from the resolved instance (via `yield*` or
 * `Effect.serviceOption`) **or** the identifier-bound shortcut
 * `QueueResourceStore.for(queueId)`:
 *
 * ```ts
 * // Instance + explicit queueId
 * const queue = yield* QueueResourceStore;
 * yield* queue.entries({ queueId: "@app/Email" });
 * yield* queue.entriesByKey("user-42");
 * yield* queue.lifecycle({ queueId: "@app/Email" });
 * yield* queue.dedupeKeys({ queueId: "@app/Email" });
 *
 * // Identifier-bound shortcut
 * const email = yield* QueueResourceStore.for("@app/Email");
 * yield* email.entries();
 * yield* email.entriesByKey("user-42");
 * yield* email.lifecycle();
 * yield* email.dedupeKeys();
 * ```
 *
 * @module store/QueueResource
 */

import { DateTime, Effect } from "effect";
import {
  applyQueryOpts,
  isFiniteNumber,
  isJsonValue,
  isRecord,
  isString,
  recordAttributesObject,
  runtimeRecordQuery,
  toJsonValue,
} from "../internal/store/helpers";
import type { ProcessStoreSpine } from "../internal/store/spine";
import { ProcessStore } from "../ProcessStore";
import type { JsonValue, QueryOpts } from "../ProcessStoreEvent";
import {
  IndexA,
  IndexB,
  Key,
  ProcessId,
  ProcessType,
  SubjectId,
  SubjectType,
  Type,
  type RuntimeRecordPredicate,
} from "../Query";
import type { RuntimeRecord, RuntimeStorageOperationalError } from "../RuntimeStorage";

// ============================================================================
// Public type-level vocabulary
// ============================================================================

/** @public */
export type QueueResourceStorePriority = "high" | "normal" | "low";

/** @public */
export type QueueResourceStoreEntryStatus =
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
export type QueueResourceStoreLifecycleTag =
  | "Started"
  | "Paused"
  | "Resumed"
  | "Shutdown"
  | "Cleared"
  | "Drained";

/** @public */
export type QueueResourceStoreDedupeKeyStatus =
  | "added"
  | "released"
  | "hydrated";

/** @public */
export type QueueEntryFactType =
  | "queue.entry.enqueued"
  | "queue.entry.started"
  | "queue.entry.completed"
  | "queue.entry.failed"
  | "queue.entry.retried"
  | "queue.entry.exhausted"
  | "queue.entry.released"
  | "queue.entry.dead-lettered"
  | "queue.entry.dropped";

/** @public */
export type QueueLifecycleChangeType =
  | "queue.lifecycle.started"
  | "queue.lifecycle.paused"
  | "queue.lifecycle.resumed"
  | "queue.lifecycle.shutdown"
  | "queue.lifecycle.cleared"
  | "queue.lifecycle.drained";

/** @public */
export type QueueDedupeKeyChangeType =
  | "queue.dedupe-key.added"
  | "queue.dedupe-key.released"
  | "queue.dedupe-key.hydrated";

// ============================================================================
// Fact / change shapes (per-status concrete types)
// ============================================================================

interface QueueEntryFactCommon {
  readonly id: string;
  readonly queueId: string;
  readonly entryId: string;
  /** Epoch milliseconds. */
  readonly occurredAt: number;
  readonly key?: string;
  readonly priority?: QueueResourceStorePriority;
  readonly attempts?: number;
  readonly batchId?: string;
  readonly attributes?: Record<string, unknown>;
}

/** @public */
export interface QueueEntryEnqueuedFact extends QueueEntryFactCommon {
  readonly type: "queue.entry.enqueued";
  readonly enqueuedAt: number;
  readonly payload?: JsonValue;
}

/** @public */
export interface QueueEntryStartedFact extends QueueEntryFactCommon {
  readonly type: "queue.entry.started";
  readonly startedAt: number;
}

/** @public */
export interface QueueEntryCompletedFact extends QueueEntryFactCommon {
  readonly type: "queue.entry.completed";
  readonly startedAt: number;
  readonly durationMs: number;
}

/** @public */
export interface QueueEntryFailedFact extends QueueEntryFactCommon {
  readonly type: "queue.entry.failed";
  readonly startedAt: number;
  readonly durationMs: number;
  readonly error?: string;
}

/** @public */
export interface QueueEntryRetriedFact extends QueueEntryFactCommon {
  readonly type: "queue.entry.retried";
  readonly error?: string;
}

/** @public */
export interface QueueEntryExhaustedFact extends QueueEntryFactCommon {
  readonly type: "queue.entry.exhausted";
  readonly error?: string;
}

/** @public */
export interface QueueEntryReleasedFact extends QueueEntryFactCommon {
  readonly type: "queue.entry.released";
  readonly releaseId: string;
  readonly interruptedAt?: number;
}

/** @public */
export interface QueueEntryDeadLetteredFact extends QueueEntryFactCommon {
  readonly type: "queue.entry.dead-lettered";
  readonly reason?: string;
  readonly error?: string;
}

/** @public */
export interface QueueEntryDroppedFact extends QueueEntryFactCommon {
  readonly type: "queue.entry.dropped";
  readonly reason?: string;
}

/**
 * Discriminated union of every per-status fact emitted by
 * {@link QueueResource}. Each fact maps 1:1 to a wire-event type
 * (`queue.entry.<status>`).
 *
 * @public
 */
export type QueueEntryFact =
  | QueueEntryEnqueuedFact
  | QueueEntryStartedFact
  | QueueEntryCompletedFact
  | QueueEntryFailedFact
  | QueueEntryRetriedFact
  | QueueEntryExhaustedFact
  | QueueEntryReleasedFact
  | QueueEntryDeadLetteredFact
  | QueueEntryDroppedFact;

interface QueueLifecycleChangeCommon {
  readonly id: string;
  readonly queueId: string;
  /** Epoch milliseconds. */
  readonly changedAt: number;
  readonly attributes?: Record<string, unknown>;
}

/** @public */
export interface QueueLifecycleStartedChange
  extends QueueLifecycleChangeCommon {
  readonly type: "queue.lifecycle.started";
}

/** @public */
export interface QueueLifecyclePausedChange extends QueueLifecycleChangeCommon {
  readonly type: "queue.lifecycle.paused";
}

/** @public */
export interface QueueLifecycleResumedChange
  extends QueueLifecycleChangeCommon {
  readonly type: "queue.lifecycle.resumed";
}

/** @public */
export interface QueueLifecycleShutdownChange
  extends QueueLifecycleChangeCommon {
  readonly type: "queue.lifecycle.shutdown";
}

/** @public */
export interface QueueLifecycleClearedChange
  extends QueueLifecycleChangeCommon {
  readonly type: "queue.lifecycle.cleared";
  readonly itemsCleared: number;
}

/** @public */
export interface QueueLifecycleDrainedChange
  extends QueueLifecycleChangeCommon {
  readonly type: "queue.lifecycle.drained";
}

/**
 * Discriminated union of every per-tag lifecycle change emitted by
 * {@link QueueResource}. Each change maps 1:1 to a wire-event type
 * (`queue.lifecycle.<tag>`).
 *
 * @public
 */
export type QueueLifecycleChange =
  | QueueLifecycleStartedChange
  | QueueLifecyclePausedChange
  | QueueLifecycleResumedChange
  | QueueLifecycleShutdownChange
  | QueueLifecycleClearedChange
  | QueueLifecycleDrainedChange;

interface QueueDedupeKeyChangeCommon {
  readonly id: string;
  readonly queueId: string;
  readonly key: string;
  /** Epoch milliseconds. */
  readonly changedAt: number;
  readonly attributes?: Record<string, unknown>;
}

/** @public */
export interface QueueDedupeKeyAddedChange extends QueueDedupeKeyChangeCommon {
  readonly type: "queue.dedupe-key.added";
}

/** @public */
export interface QueueDedupeKeyReleasedChange
  extends QueueDedupeKeyChangeCommon {
  readonly type: "queue.dedupe-key.released";
}

/** @public */
export interface QueueDedupeKeyHydratedChange
  extends QueueDedupeKeyChangeCommon {
  readonly type: "queue.dedupe-key.hydrated";
}

/**
 * Discriminated union of every per-status dedupe-key change emitted by
 * {@link QueueResource}. Each change maps 1:1 to a wire-event type
 * (`queue.dedupe-key.<status>`).
 *
 * @public
 */
export type QueueDedupeKeyChange =
  | QueueDedupeKeyAddedChange
  | QueueDedupeKeyReleasedChange
  | QueueDedupeKeyHydratedChange;

// ============================================================================
// Query types
// ============================================================================

/** @public */
export interface QueueEntryQuery {
  readonly queueId?: string;
  readonly entryId?: string;
  readonly key?: string;
  readonly batchId?: string;
  readonly releaseId?: string;
  readonly types?: ReadonlyArray<QueueEntryFactType>;
  readonly opts?: QueryOpts;
}

/** @public */
export interface QueueLifecycleQuery {
  readonly queueId?: string;
  readonly types?: ReadonlyArray<QueueLifecycleChangeType>;
  readonly opts?: QueryOpts;
}

/** @public */
export interface QueueDedupeKeyQuery {
  readonly queueId?: string;
  readonly key?: string;
  readonly types?: ReadonlyArray<QueueDedupeKeyChangeType>;
  readonly opts?: QueryOpts;
}

// ============================================================================
// Constants and type guards
// ============================================================================

const QUEUE_RESOURCE_PROCESS_TYPE = "queue-resource";
const QUEUE_ENTRY_SUBJECT_TYPE = "queue-entry";
const QUEUE_LIFECYCLE_SUBJECT_TYPE = "queue-lifecycle";
const QUEUE_DEDUPE_KEY_SUBJECT_TYPE = "queue-dedupe-key";
const QUEUE_RESOURCE_INDEX_NAMES = [
  "batchId",
  "releaseId",
] as const satisfies ReadonlyArray<string>;

/** @internal */
export const queueEntryFactTypes: ReadonlyArray<QueueEntryFactType> = [
  "queue.entry.enqueued",
  "queue.entry.started",
  "queue.entry.completed",
  "queue.entry.failed",
  "queue.entry.retried",
  "queue.entry.exhausted",
  "queue.entry.released",
  "queue.entry.dead-lettered",
  "queue.entry.dropped",
];

/** @internal */
export const queueLifecycleChangeTypes: ReadonlyArray<QueueLifecycleChangeType> =
  [
    "queue.lifecycle.started",
    "queue.lifecycle.paused",
    "queue.lifecycle.resumed",
    "queue.lifecycle.shutdown",
    "queue.lifecycle.cleared",
    "queue.lifecycle.drained",
  ];

/** @internal */
export const queueDedupeKeyChangeTypes: ReadonlyArray<QueueDedupeKeyChangeType> =
  [
    "queue.dedupe-key.added",
    "queue.dedupe-key.released",
    "queue.dedupe-key.hydrated",
  ];

const isQueueEntryFactType = (value: unknown): value is QueueEntryFactType =>
  isString(value) && queueEntryFactTypes.some((type) => type === value);

const isQueueLifecycleChangeType = (
  value: unknown,
): value is QueueLifecycleChangeType =>
  isString(value) && queueLifecycleChangeTypes.some((type) => type === value);

const isQueueDedupeKeyChangeType = (
  value: unknown,
): value is QueueDedupeKeyChangeType =>
  isString(value) && queueDedupeKeyChangeTypes.some((type) => type === value);

const queuePriorities: ReadonlyArray<QueueResourceStorePriority> = [
  "high",
  "normal",
  "low",
];

const isQueuePriority = (
  value: unknown,
): value is QueueResourceStorePriority =>
  isString(value) && queuePriorities.some((p) => p === value);

// ============================================================================
// Encoders (fact / change → RuntimeRecord)
// ============================================================================

const queueEntryFactAsJson = (fact: QueueEntryFact): JsonValue => {
  const out: { [key: string]: JsonValue } = {
    id: fact.id,
    queueId: fact.queueId,
    entryId: fact.entryId,
    type: fact.type,
    occurredAt: fact.occurredAt,
  };
  if (fact.key !== undefined) out["key"] = fact.key;
  if (fact.priority !== undefined) out["priority"] = fact.priority;
  if (fact.attempts !== undefined) out["attempts"] = fact.attempts;
  if (fact.batchId !== undefined) out["batchId"] = fact.batchId;
  if (fact.attributes !== undefined) {
    out["attributes"] = toJsonValue(fact.attributes);
  }
  switch (fact.type) {
    case "queue.entry.enqueued":
      out["enqueuedAt"] = fact.enqueuedAt;
      if (fact.payload !== undefined) out["payload"] = fact.payload;
      break;
    case "queue.entry.started":
      out["startedAt"] = fact.startedAt;
      break;
    case "queue.entry.completed":
      out["startedAt"] = fact.startedAt;
      out["durationMs"] = fact.durationMs;
      break;
    case "queue.entry.failed":
      out["startedAt"] = fact.startedAt;
      out["durationMs"] = fact.durationMs;
      if (fact.error !== undefined) out["error"] = fact.error;
      break;
    case "queue.entry.retried":
      if (fact.error !== undefined) out["error"] = fact.error;
      break;
    case "queue.entry.exhausted":
      if (fact.error !== undefined) out["error"] = fact.error;
      break;
    case "queue.entry.released":
      out["releaseId"] = fact.releaseId;
      if (fact.interruptedAt !== undefined) {
        out["interruptedAt"] = fact.interruptedAt;
      }
      break;
    case "queue.entry.dead-lettered":
      if (fact.reason !== undefined) out["reason"] = fact.reason;
      if (fact.error !== undefined) out["error"] = fact.error;
      break;
    case "queue.entry.dropped":
      if (fact.reason !== undefined) out["reason"] = fact.reason;
      break;
  }
  return out;
};

const lifecycleChangeAsJson = (change: QueueLifecycleChange): JsonValue => {
  const out: { [key: string]: JsonValue } = {
    id: change.id,
    queueId: change.queueId,
    type: change.type,
    changedAt: change.changedAt,
  };
  if (change.attributes !== undefined) {
    out["attributes"] = toJsonValue(change.attributes);
  }
  if (change.type === "queue.lifecycle.cleared") {
    out["itemsCleared"] = change.itemsCleared;
  }
  return out;
};

const dedupeChangeAsJson = (change: QueueDedupeKeyChange): JsonValue => ({
  id: change.id,
  queueId: change.queueId,
  key: change.key,
  type: change.type,
  changedAt: change.changedAt,
  ...(change.attributes !== undefined
    ? { attributes: toJsonValue(change.attributes) }
    : {}),
});

/**
 * Build a runtime record from a queue entry fact.
 *
 * @internal
 */
export const makeQueueEntryRecord = (
  fact: QueueEntryFact,
): Omit<RuntimeRecord, "runId" | "createdAt"> => {
  type Mutable = {
    -readonly [K in keyof Omit<RuntimeRecord, "runId" | "createdAt">]:
      Omit<RuntimeRecord, "runId" | "createdAt">[K];
  };
  const out: Mutable = {
    id: `queue.entry/${fact.id}`,
    type: fact.type,
    occurredAt: DateTime.makeUnsafe(fact.occurredAt),
    processType: QUEUE_RESOURCE_PROCESS_TYPE,
    processId: fact.queueId,
    subjectType: QUEUE_ENTRY_SUBJECT_TYPE,
    subjectId: fact.entryId,
    indexNames: QUEUE_RESOURCE_INDEX_NAMES,
    payload: { fact: queueEntryFactAsJson(fact) },
  };
  if (fact.key !== undefined) out.key = fact.key;
  if (fact.batchId !== undefined) out.indexA = fact.batchId;
  if (fact.type === "queue.entry.released") out.indexB = fact.releaseId;
  if (fact.attributes !== undefined) {
    out.attributes = toJsonValue(fact.attributes);
  }
  return out;
};

/**
 * Build a runtime record from a queue lifecycle change.
 *
 * @internal
 */
export const makeQueueLifecycleRecord = (
  change: QueueLifecycleChange,
): Omit<RuntimeRecord, "runId" | "createdAt"> => {
  const out: Omit<RuntimeRecord, "runId" | "createdAt"> = {
    id: `queue.lifecycle/${change.id}`,
    type: change.type,
    occurredAt: DateTime.makeUnsafe(change.changedAt),
    processType: QUEUE_RESOURCE_PROCESS_TYPE,
    processId: change.queueId,
    subjectType: QUEUE_LIFECYCLE_SUBJECT_TYPE,
    subjectId: change.queueId,
    payload: { change: lifecycleChangeAsJson(change) },
    ...(change.attributes !== undefined
      ? { attributes: toJsonValue(change.attributes) }
      : {}),
  };
  return out;
};

/**
 * Build a runtime record from a queue dedupe-key change.
 *
 * @internal
 */
export const makeQueueDedupeKeyRecord = (
  change: QueueDedupeKeyChange,
): Omit<RuntimeRecord, "runId" | "createdAt"> => ({
  id: `queue.dedupe-key/${change.id}`,
  type: change.type,
  occurredAt: DateTime.makeUnsafe(change.changedAt),
  processType: QUEUE_RESOURCE_PROCESS_TYPE,
  processId: change.queueId,
  subjectType: QUEUE_DEDUPE_KEY_SUBJECT_TYPE,
  subjectId: change.key,
  key: change.key,
  payload: { change: dedupeChangeAsJson(change) },
  ...(change.attributes !== undefined
    ? { attributes: toJsonValue(change.attributes) }
    : {}),
});

// ============================================================================
// Decoders (RuntimeRecord → fact / change)
// ============================================================================

interface QueueEntryFactCommonDecoded {
  readonly id: string;
  readonly queueId: string;
  readonly entryId: string;
  readonly occurredAt: number;
  readonly key?: string;
  readonly priority?: QueueResourceStorePriority;
  readonly attempts?: number;
  readonly batchId?: string;
  readonly attributes?: Record<string, unknown>;
}

const decodeEntryCommon = (
  raw: { readonly [key: string]: unknown },
): QueueEntryFactCommonDecoded | null => {
  const id = raw["id"];
  const queueId = raw["queueId"];
  const entryId = raw["entryId"];
  const occurredAt = raw["occurredAt"];
  if (
    !isString(id) ||
    !isString(queueId) ||
    !isString(entryId) ||
    !isFiniteNumber(occurredAt)
  ) {
    return null;
  }
  const keyRaw = raw["key"];
  const priorityRaw = raw["priority"];
  const attemptsRaw = raw["attempts"];
  const batchIdRaw = raw["batchId"];
  if (keyRaw !== undefined && !isString(keyRaw)) return null;
  if (priorityRaw !== undefined && !isQueuePriority(priorityRaw)) return null;
  if (attemptsRaw !== undefined && !isFiniteNumber(attemptsRaw)) return null;
  if (batchIdRaw !== undefined && !isString(batchIdRaw)) return null;
  const attributes = recordAttributesObject(raw["attributes"]);
  const out: { -readonly [K in keyof QueueEntryFactCommonDecoded]: QueueEntryFactCommonDecoded[K] } =
    {
      id,
      queueId,
      entryId,
      occurredAt,
    };
  if (keyRaw !== undefined) out.key = keyRaw;
  if (priorityRaw !== undefined) out.priority = priorityRaw;
  if (attemptsRaw !== undefined) out.attempts = attemptsRaw;
  if (batchIdRaw !== undefined) out.batchId = batchIdRaw;
  if (attributes !== undefined) out.attributes = attributes;
  return out;
};

const decodeQueueEntryFactValue = (
  type: QueueEntryFactType,
  value: unknown,
): QueueEntryFact | null => {
  if (!isRecord(value)) return null;
  if (value["type"] !== type) return null;
  const common = decodeEntryCommon(value);
  if (common === null) return null;
  switch (type) {
    case "queue.entry.enqueued": {
      const enqueuedAt = value["enqueuedAt"];
      if (!isFiniteNumber(enqueuedAt)) return null;
      const payload = value["payload"];
      if (payload !== undefined && !isJsonValue(payload)) return null;
      return {
        ...common,
        type,
        enqueuedAt,
        ...(payload === undefined ? {} : { payload }),
      };
    }
    case "queue.entry.started": {
      const startedAt = value["startedAt"];
      if (!isFiniteNumber(startedAt)) return null;
      return { ...common, type, startedAt };
    }
    case "queue.entry.completed": {
      const startedAt = value["startedAt"];
      const durationMs = value["durationMs"];
      if (!isFiniteNumber(startedAt) || !isFiniteNumber(durationMs)) {
        return null;
      }
      return { ...common, type, startedAt, durationMs };
    }
    case "queue.entry.failed": {
      const startedAt = value["startedAt"];
      const durationMs = value["durationMs"];
      const errorRaw = value["error"];
      if (!isFiniteNumber(startedAt) || !isFiniteNumber(durationMs)) {
        return null;
      }
      if (errorRaw !== undefined && !isString(errorRaw)) return null;
      return {
        ...common,
        type,
        startedAt,
        durationMs,
        ...(errorRaw === undefined ? {} : { error: errorRaw }),
      };
    }
    case "queue.entry.retried": {
      const errorRaw = value["error"];
      if (errorRaw !== undefined && !isString(errorRaw)) return null;
      return {
        ...common,
        type,
        ...(errorRaw === undefined ? {} : { error: errorRaw }),
      };
    }
    case "queue.entry.exhausted": {
      const errorRaw = value["error"];
      if (errorRaw !== undefined && !isString(errorRaw)) return null;
      return {
        ...common,
        type,
        ...(errorRaw === undefined ? {} : { error: errorRaw }),
      };
    }
    case "queue.entry.released": {
      const releaseId = value["releaseId"];
      if (!isString(releaseId)) return null;
      const interruptedAtRaw = value["interruptedAt"];
      if (
        interruptedAtRaw !== undefined &&
        !isFiniteNumber(interruptedAtRaw)
      ) {
        return null;
      }
      return {
        ...common,
        type,
        releaseId,
        ...(interruptedAtRaw === undefined
          ? {}
          : { interruptedAt: interruptedAtRaw }),
      };
    }
    case "queue.entry.dead-lettered": {
      const reasonRaw = value["reason"];
      const errorRaw = value["error"];
      if (reasonRaw !== undefined && !isString(reasonRaw)) return null;
      if (errorRaw !== undefined && !isString(errorRaw)) return null;
      return {
        ...common,
        type,
        ...(reasonRaw === undefined ? {} : { reason: reasonRaw }),
        ...(errorRaw === undefined ? {} : { error: errorRaw }),
      };
    }
    case "queue.entry.dropped": {
      const reasonRaw = value["reason"];
      if (reasonRaw !== undefined && !isString(reasonRaw)) return null;
      return {
        ...common,
        type,
        ...(reasonRaw === undefined ? {} : { reason: reasonRaw }),
      };
    }
  }
};

const recordToQueueEntryFact = (record: RuntimeRecord): QueueEntryFact | null => {
  if (!isQueueEntryFactType(record.type)) return null;
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  return decodeQueueEntryFactValue(record.type, payload["fact"]);
};

const decodeQueueLifecycleChangeValue = (
  type: QueueLifecycleChangeType,
  value: unknown,
): QueueLifecycleChange | null => {
  if (!isRecord(value)) return null;
  if (value["type"] !== type) return null;
  const id = value["id"];
  const queueId = value["queueId"];
  const changedAt = value["changedAt"];
  if (!isString(id) || !isString(queueId) || !isFiniteNumber(changedAt)) {
    return null;
  }
  const attributes = recordAttributesObject(value["attributes"]);
  const common: QueueLifecycleChangeCommon = {
    id,
    queueId,
    changedAt,
    ...(attributes === undefined ? {} : { attributes }),
  };
  if (type === "queue.lifecycle.cleared") {
    const itemsCleared = value["itemsCleared"];
    if (!isFiniteNumber(itemsCleared)) return null;
    return { ...common, type, itemsCleared };
  }
  return { ...common, type };
};

const recordToQueueLifecycleChange = (
  record: RuntimeRecord,
): QueueLifecycleChange | null => {
  if (!isQueueLifecycleChangeType(record.type)) return null;
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  return decodeQueueLifecycleChangeValue(record.type, payload["change"]);
};

const decodeQueueDedupeKeyChangeValue = (
  type: QueueDedupeKeyChangeType,
  value: unknown,
): QueueDedupeKeyChange | null => {
  if (!isRecord(value)) return null;
  if (value["type"] !== type) return null;
  const id = value["id"];
  const queueId = value["queueId"];
  const key = value["key"];
  const changedAt = value["changedAt"];
  if (
    !isString(id) ||
    !isString(queueId) ||
    !isString(key) ||
    !isFiniteNumber(changedAt)
  ) {
    return null;
  }
  const attributes = recordAttributesObject(value["attributes"]);
  return {
    id,
    queueId,
    key,
    changedAt,
    type,
    ...(attributes === undefined ? {} : { attributes }),
  };
};

const recordToQueueDedupeKeyChange = (
  record: RuntimeRecord,
): QueueDedupeKeyChange | null => {
  if (!isQueueDedupeKeyChangeType(record.type)) return null;
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  return decodeQueueDedupeKeyChangeValue(record.type, payload["change"]);
};

// ============================================================================
// Read-side query builders
// ============================================================================

const entryPredicates = (
  query: QueueEntryQuery | undefined,
): RuntimeRecordPredicate[] => {
  const preds: RuntimeRecordPredicate[] = [
    ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
    SubjectType.equals(QUEUE_ENTRY_SUBJECT_TYPE),
  ];
  if (query?.queueId !== undefined) preds.push(ProcessId.equals(query.queueId));
  if (query?.types !== undefined && query.types.length > 0) {
    preds.push(Type.in(query.types));
  }
  if (query?.entryId !== undefined) {
    preds.push(SubjectId.equals(query.entryId));
  }
  if (query?.key !== undefined) preds.push(Key.equals(query.key));
  if (query?.batchId !== undefined) preds.push(IndexA.equals(query.batchId));
  if (query?.releaseId !== undefined) {
    preds.push(IndexB.equals(query.releaseId));
  }
  return preds;
};

const lifecyclePredicates = (
  query: QueueLifecycleQuery | undefined,
): RuntimeRecordPredicate[] => {
  const preds: RuntimeRecordPredicate[] = [
    ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
    SubjectType.equals(QUEUE_LIFECYCLE_SUBJECT_TYPE),
  ];
  if (query?.queueId !== undefined) preds.push(ProcessId.equals(query.queueId));
  if (query?.types !== undefined && query.types.length > 0) {
    preds.push(Type.in(query.types));
  }
  return preds;
};

const dedupePredicates = (
  query: QueueDedupeKeyQuery | undefined,
): RuntimeRecordPredicate[] => {
  const preds: RuntimeRecordPredicate[] = [
    ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
    SubjectType.equals(QUEUE_DEDUPE_KEY_SUBJECT_TYPE),
  ];
  if (query?.queueId !== undefined) preds.push(ProcessId.equals(query.queueId));
  if (query?.key !== undefined) preds.push(Key.equals(query.key));
  if (query?.types !== undefined && query.types.length > 0) {
    preds.push(Type.in(query.types));
  }
  return preds;
};

// ============================================================================
// Read projections
// ============================================================================

const queueEntryFactsFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  query: QueueEntryQuery | undefined,
): QueueEntryFact[] => {
  const out: QueueEntryFact[] = [];
  for (const record of records) {
    const fact = recordToQueueEntryFact(record);
    if (fact === null) continue;
    out.push(fact);
  }
  return applyQueryOpts(out, query?.opts, (fact) => fact.occurredAt);
};

const queueLifecycleChangesFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  query: QueueLifecycleQuery | undefined,
): QueueLifecycleChange[] => {
  const out: QueueLifecycleChange[] = [];
  for (const record of records) {
    const change = recordToQueueLifecycleChange(record);
    if (change === null) continue;
    out.push(change);
  }
  return applyQueryOpts(out, query?.opts, (change) => change.changedAt);
};

const queueDedupeKeyChangesFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  query: QueueDedupeKeyQuery | undefined,
): QueueDedupeKeyChange[] => {
  const out: QueueDedupeKeyChange[] = [];
  for (const record of records) {
    const change = recordToQueueDedupeKeyChange(record);
    if (change === null) continue;
    out.push(change);
  }
  return applyQueryOpts(out, query?.opts, (change) => change.changedAt);
};

// ============================================================================
// Facet
// ============================================================================

/**
 * Queue resource storage facet (see module doc).
 *
 * Static record helpers (`recordEntry`, `recordLifecycle`,
 * `recordDedupeKey`, plus their `*Batch` variants) are silent no-ops
 * when the facet is not in context, and write through the spine when it
 * is. Storage failures surface through the returned error channel; queue
 * internals wrap telemetry-only writes with `ProcessStore.catchErrorAndLog`.
 *
 * Read methods (`entries`, `entriesByKey`, `lifecycle`, `dedupeKeys`)
 * are accessed through the resolved instance — `yield*` the facet (or
 * call `Effect.serviceOption(QueueResourceStore)`) to dispatch.
 *
 * @public
 */
export class QueueResourceStore extends ProcessStore.Service<
  QueueResourceStore
>()(
  "@nikscripts/effect-pm/store/queueResource/QueueResourceStore",
  ProcessStore.record({
    recordEntry: (s) => (fact: QueueEntryFact) =>
      s.create(makeQueueEntryRecord(fact)),
    recordEntryBatch: (s) => (facts: ReadonlyArray<QueueEntryFact>) =>
      s.createBatch(facts.map(makeQueueEntryRecord)),
    recordLifecycle: (s) => (change: QueueLifecycleChange) =>
      s.create(makeQueueLifecycleRecord(change)),
    recordLifecycleBatch:
      (s) => (changes: ReadonlyArray<QueueLifecycleChange>) =>
        s.createBatch(changes.map(makeQueueLifecycleRecord)),
    recordDedupeKey: (s) => (change: QueueDedupeKeyChange) =>
      s.create(makeQueueDedupeKeyRecord(change)),
    recordDedupeKeyBatch:
      (s) => (changes: ReadonlyArray<QueueDedupeKeyChange>) =>
        s.createBatch(changes.map(makeQueueDedupeKeyRecord)),
  }),
  ProcessStore.read((s) => ({
    // Every queue read pushes its filters to storage as indexed
    // `RuntimeRecordPredicate`s — there is no post-filter on a
    // payload sub-field — so `query?.opts` (including `limit`) is
    // safe to pass through. The decode step (`recordToQueue*`) can
    // still drop rows on malformed payload, in which case the result
    // length may fall below `limit`; for projection-correct limits
    // when post-filtering is required, see the `windowOpts` +
    // `applyQueryOpts` pattern in `processGroup.ts` /
    // `processExecution.ts`.
    entries: (query?: QueueEntryQuery) => readEntries(s, query),
    entriesByKey: (key: string, query?: Omit<QueueEntryQuery, "key">) =>
      readEntries(s, { ...query, key }),
    lifecycle: (query?: QueueLifecycleQuery) => readLifecycle(s, query),
    dedupeKeys: (query?: QueueDedupeKeyQuery) => readDedupeKeys(s, query),
  })),
  ProcessStore.withIdentifier((queueId, s) => ({
    entries: (query?: Omit<QueueEntryQuery, "queueId">) =>
      readEntries(s, { ...query, queueId }),
    entriesByKey: (
      key: string,
      query?: Omit<QueueEntryQuery, "queueId" | "key">,
    ) => readEntries(s, { ...query, queueId, key }),
    lifecycle: (query?: Omit<QueueLifecycleQuery, "queueId">) =>
      readLifecycle(s, { ...query, queueId }),
    dedupeKeys: (query?: Omit<QueueDedupeKeyQuery, "queueId">) =>
      readDedupeKeys(s, { ...query, queueId }),
  })),
) {}

const readEntries = (
  s: ProcessStoreSpine,
  query: QueueEntryQuery | undefined,
): Effect.Effect<QueueEntryFact[], RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(entryPredicates(query), query?.opts))
    .pipe(Effect.map((records) => queueEntryFactsFromRecords(records, query)));

const readLifecycle = (
  s: ProcessStoreSpine,
  query: QueueLifecycleQuery | undefined,
): Effect.Effect<QueueLifecycleChange[], RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(lifecyclePredicates(query), query?.opts))
    .pipe(
      Effect.map((records) =>
        queueLifecycleChangesFromRecords(records, query),
      ),
    );

const readDedupeKeys = (
  s: ProcessStoreSpine,
  query: QueueDedupeKeyQuery | undefined,
): Effect.Effect<QueueDedupeKeyChange[], RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(dedupePredicates(query), query?.opts))
    .pipe(
      Effect.map((records) =>
        queueDedupeKeyChangesFromRecords(records, query),
      ),
    );

/**
 * Type accessors merged onto {@link QueueResourceStore} via
 * declaration merging:
 *
 * - `QueueResourceStore.Type` — full service shape (record + read).
 * - `QueueResourceStore.EmitType` — record-section emit shape only.
 *
 * Use these to type custom mocks supplied through `Layer.succeed` /
 * `Effect.provideService`:
 *
 * ```ts
 * const mock: QueueResourceStore.Type = { ... };
 * ```
 *
 * @public
 */
export declare namespace QueueResourceStore {
  export type Type = ProcessStore.Service.Type<
    typeof QueueResourceStore
  >;
  export type EmitType = ProcessStore.Service.EmitType<
    typeof QueueResourceStore
  >;
  export type IdentifierType = ProcessStore.Service.IdentifierType<
    typeof QueueResourceStore
  >;
}
