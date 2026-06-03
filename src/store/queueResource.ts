/**
 * **Queue resource storage facet** — durable, queryable history of one
 * priority-aware {@link QueueResource} worker.
 *
 * @remarks
 * Per-domain facet for {@link QueueResource}. Owns 19 concrete
 * wire-event types and their `Queue*Fact` / `Queue*Change` value
 * shapes; reads return typed unions, not generic envelopes.
 *
 * ## Wire types at a glance
 *
 * | Subject | Wire types | Indexed columns |
 * |---------|-----------|-----------------|
 * | `QueueEntry` (× 9) | `Queue.Entry.Enqueued`, `.Started`, `.Completed`, `.Failed`, `.Retried`, `.Exhausted`, `.Released`, `.DeadLettered`, `.Dropped` | `subjectId = entryId`, `key`, `indexA = batchId`, `indexB = releaseId` (released only) |
 * | `QueueLifecycle` (× 6) | `Queue.Lifecycle.Started`, `.Paused`, `.Resumed`, `.Shutdown`, `.Cleared`, `.Drained` | `subjectId = queueId` |
 * | `QueueDedupeKey` (× 3) | `Queue.DedupeKey.Added`, `.Released`, `.Hydrated` | `subjectId = key`, `key = key` |
 * | `QueueRateLimit` (× 1) | `Queue.RateLimit.Exceeded` | `subjectId = entryId`, `key = limitKey` |
 *
 * Every record carries `processType: "QueueResource"` and
 * `processId: <queueId>`. Indexed columns let per-key, per-batch, and
 * per-release lookups push down to SQL without scanning the payload.
 *
 * ## Emit (optional)
 *
 * {@link QueueResource} calls {@link emitEntryFact}, {@link emitLifecycleChange},
 * {@link emitDedupeKeyChange}, and {@link emitRateLimitExceededFact} (scoped
 * telemetry under `QueueResourceStore.Entry.*`, `.Lifecycle.*`, etc.). When the
 * facet layer is not composed each static telemetry emitter is a silent no-op;
 * when composed, writes surface typed failures. Queue internals wrap
 * telemetry-only writes with `ProcessStore.catchErrorAndLog`.
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

import { DateTime, Effect, Option } from "effect";
import {
  filterMapNullable,
  nullable,
  numberValue,
  optionalValue,
  stringValue,
  valueWhen,
} from "../internal/store/decode";
import {
  applyQueryOpts,
  isFiniteNumber,
  isJsonValue,
  isRecord,
  isString,
  recordAttributesObject,
  runtimeRecordQuery,
} from "../internal/store/helpers";
import type { ProcessStoreSpine } from "../internal/store/spine";
import {
  QueueDedupeKeyScope,
  QueueEntryScope,
  QueueResourceScope,
} from "../QueueResourceScope";
import { ProcessStore, Telemetry } from "../ProcessStore";
import type { ProcessStoreWriteError } from "../ProcessStoreEvent";
import { QueueResourceTelemetry } from "./queueResourceTelemetry";
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
/** @public */
export type QueueEntryFactType = Telemetry.Type.Event<
  typeof QueueResourceTelemetry,
  "Entry"
>;

/** @public */
export type QueueLifecycleChangeType = Telemetry.Type.Event<
  typeof QueueResourceTelemetry,
  "Lifecycle"
>;

/** @public */
export type QueueDedupeKeyChangeType = Telemetry.Type.Event<
  typeof QueueResourceTelemetry,
  "DedupeKey"
>;

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
  readonly type: "Queue.Entry.Enqueued";
  readonly enqueuedAt: number;
  readonly payload?: JsonValue;
}

/** @public */
export interface QueueEntryStartedFact extends QueueEntryFactCommon {
  readonly type: "Queue.Entry.Started";
  readonly startedAt: number;
}

/** @public */
export interface QueueEntryCompletedFact extends QueueEntryFactCommon {
  readonly type: "Queue.Entry.Completed";
  readonly startedAt: number;
  readonly durationMs: number;
}

/** @public */
export interface QueueEntryFailedFact extends QueueEntryFactCommon {
  readonly type: "Queue.Entry.Failed";
  readonly startedAt: number;
  readonly durationMs: number;
  readonly error?: string;
}

/** @public */
export interface QueueEntryRetriedFact extends QueueEntryFactCommon {
  readonly type: "Queue.Entry.Retried";
  readonly error?: string;
}

/** @public */
export interface QueueEntryExhaustedFact extends QueueEntryFactCommon {
  readonly type: "Queue.Entry.Exhausted";
  readonly error?: string;
}

/** @public */
export interface QueueEntryReleasedFact extends QueueEntryFactCommon {
  readonly type: "Queue.Entry.Released";
  readonly releaseId: string;
  readonly interruptedAt?: number;
}

/** @public */
export interface QueueEntryDeadLetteredFact extends QueueEntryFactCommon {
  readonly type: "Queue.Entry.DeadLettered";
  readonly reason?: string;
  readonly error?: string;
}

/** @public */
export interface QueueEntryDroppedFact extends QueueEntryFactCommon {
  readonly type: "Queue.Entry.Dropped";
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
  readonly type: "Queue.Lifecycle.Started";
}

/** @public */
export interface QueueLifecyclePausedChange extends QueueLifecycleChangeCommon {
  readonly type: "Queue.Lifecycle.Paused";
}

/** @public */
export interface QueueLifecycleResumedChange
  extends QueueLifecycleChangeCommon {
  readonly type: "Queue.Lifecycle.Resumed";
}

/** @public */
export interface QueueLifecycleShutdownChange
  extends QueueLifecycleChangeCommon {
  readonly type: "Queue.Lifecycle.Shutdown";
}

/** @public */
export interface QueueLifecycleClearedChange
  extends QueueLifecycleChangeCommon {
  readonly type: "Queue.Lifecycle.Cleared";
  readonly itemsCleared: number;
}

/** @public */
export interface QueueLifecycleDrainedChange
  extends QueueLifecycleChangeCommon {
  readonly type: "Queue.Lifecycle.Drained";
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
  readonly type: "Queue.DedupeKey.Added";
}

/** @public */
export interface QueueDedupeKeyReleasedChange
  extends QueueDedupeKeyChangeCommon {
  readonly type: "Queue.DedupeKey.Released";
}

/** @public */
export interface QueueDedupeKeyHydratedChange
  extends QueueDedupeKeyChangeCommon {
  readonly type: "Queue.DedupeKey.Hydrated";
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

/** @public */
export type QueueRateLimitExceededFactType = Telemetry.Type.Event<
  typeof QueueResourceTelemetry,
  "RateLimit"
>;

/** @public */
export interface QueueRateLimitExceededFact {
  readonly type: QueueRateLimitExceededFactType;
  readonly id: string;
  readonly queueId: string;
  readonly entryId: string;
  /** Epoch milliseconds. */
  readonly occurredAt: number;
  readonly limitKey: string;
  readonly algorithm: "fixed-window" | "token-bucket";
  readonly limit: number;
  readonly tokens: number;
  readonly windowMs: number;
  readonly outcome: "delayed" | "rejected";
  readonly delayMs: number;
  readonly remaining: number;
  readonly resetAfterMs: number;
  readonly retryAfterMs?: number;
  readonly error?: string;
  readonly key?: string;
  readonly priority?: QueueResourceStorePriority;
  readonly attributes?: Record<string, unknown>;
}

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

/** @public */
export interface QueueRateLimitQuery {
  readonly queueId?: string;
  readonly entryId?: string;
  readonly limitKey?: string;
  readonly opts?: QueryOpts;
}

// ============================================================================
// Constants and type guards
// ============================================================================

const QUEUE_RESOURCE_PROCESS_TYPE = "QueueResource";
const QUEUE_ENTRY_SUBJECT_TYPE = "QueueEntry";
const QUEUE_LIFECYCLE_SUBJECT_TYPE = "QueueLifecycle";
const QUEUE_DEDUPE_KEY_SUBJECT_TYPE = "QueueDedupeKey";
const QUEUE_RATELIMIT_SUBJECT_TYPE = "QueueRateLimit";

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
  record: RuntimeRecord,
): QueueEntryFactCommonDecoded | null =>
  nullable(
    Option.all({
      id: Option.orElse(stringValue(raw["id"]), () => Option.some(record.id)),
      queueId: Option.some(record.processId),
      entryId: Option.orElse(
        stringValue(raw["entryId"]),
        () =>
          record.subjectId === undefined
            ? Option.none()
            : Option.some(record.subjectId),
      ),
      occurredAt: Option.orElse(
        numberValue(raw["occurredAt"]),
        () =>
          Option.some(DateTime.toEpochMillis(record.occurredAt)),
      ),
      key: optionalValue(raw["key"], isString),
      priority: optionalValue(raw["priority"], isQueuePriority),
      attempts: optionalValue(raw["attempts"], isFiniteNumber),
      batchId: optionalValue(raw["batchId"], isString),
    }).pipe(
      Option.map(({ attempts, batchId, entryId, id, key, occurredAt, priority, queueId }) => {
        const attributes =
          recordAttributesObject(raw["attributes"]) ??
          recordAttributesObject(record.attributes);
        return {
          id,
          queueId,
          entryId,
          occurredAt,
          ...(key === undefined ? {} : { key }),
          ...(priority === undefined ? {} : { priority }),
          ...(attempts === undefined ? {} : { attempts }),
          ...(batchId === undefined ? {} : { batchId }),
          ...(attributes === undefined ? {} : { attributes }),
        };
      }),
    ),
  );

const decodeQueueEntryFactValue = (
  record: RuntimeRecord,
  type: QueueEntryFactType,
): QueueEntryFact | null => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const value = record.payload;
  if (!isRecord(value)) return null;
  const common = decodeEntryCommon(value, record);
  if (common === null) return null;
  switch (type) {
    case "Queue.Entry.Enqueued": {
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
    case "Queue.Entry.Started": {
      const startedAt = value["startedAt"];
      if (!isFiniteNumber(startedAt)) return null;
      return { ...common, type, startedAt };
    }
    case "Queue.Entry.Completed": {
      const startedAt = value["startedAt"];
      const durationMs = value["durationMs"];
      if (!isFiniteNumber(startedAt) || !isFiniteNumber(durationMs)) {
        return null;
      }
      return { ...common, type, startedAt, durationMs };
    }
    case "Queue.Entry.Failed": {
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
    case "Queue.Entry.Retried": {
      const errorRaw = value["error"];
      if (errorRaw !== undefined && !isString(errorRaw)) return null;
      return {
        ...common,
        type,
        ...(errorRaw === undefined ? {} : { error: errorRaw }),
      };
    }
    case "Queue.Entry.Exhausted": {
      const errorRaw = value["error"];
      if (errorRaw !== undefined && !isString(errorRaw)) return null;
      return {
        ...common,
        type,
        ...(errorRaw === undefined ? {} : { error: errorRaw }),
      };
    }
    case "Queue.Entry.Released": {
      const releaseId = value["releaseId"] ?? record.indexB;
      if (!isString(releaseId)) return null;
      const interruptedAt = optionalValue(value["interruptedAt"], isFiniteNumber);
      return interruptedAt.pipe(
        Option.match({
          onNone: () => null,
          onSome: (interruptedAtRaw) => ({
            ...common,
            type,
            releaseId,
            ...(interruptedAtRaw === undefined
              ? {}
              : { interruptedAt: interruptedAtRaw }),
          }),
        }),
      );
    }
    case "Queue.Entry.DeadLettered": {
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
    case "Queue.Entry.Dropped": {
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

const decodeQueueLifecycleChangeValue = (
  record: RuntimeRecord,
  type: QueueLifecycleChangeType,
): QueueLifecycleChange | null => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  return nullable(
    Option.all({
      id: Option.orElse(stringValue(raw["id"]), () => Option.some(record.id)),
      queueId: Option.some(record.processId),
      changedAt: Option.orElse(
        numberValue(raw["changedAt"]),
        () => Option.some(DateTime.toEpochMillis(record.occurredAt)),
      ),
    }).pipe(
      Option.flatMap((common): Option.Option<QueueLifecycleChange> => {
        const attributes =
          recordAttributesObject(raw["attributes"]) ??
          recordAttributesObject(record.attributes);
        const base = {
          ...common,
          ...(attributes === undefined ? {} : { attributes }),
        };
        return type === "Queue.Lifecycle.Cleared"
          ? numberValue(raw["itemsCleared"]).pipe(
              Option.map((itemsCleared): QueueLifecycleChange => ({
                ...base,
                type,
                itemsCleared,
              })),
            )
          : Option.some<QueueLifecycleChange>({ ...base, type });
      }),
    ),
  );
};

const decodeQueueDedupeKeyChangeValue = (
  record: RuntimeRecord,
  type: QueueDedupeKeyChangeType,
): QueueDedupeKeyChange | null => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  return nullable(
    Option.all({
      id: Option.orElse(stringValue(raw["id"]), () => Option.some(record.id)),
      queueId: Option.some(record.processId),
      key: stringValue(raw["key"]),
      changedAt: Option.orElse(
        numberValue(raw["changedAt"]),
        () => Option.some(DateTime.toEpochMillis(record.occurredAt)),
      ),
    }).pipe(
      Option.map((fields) => {
        const attributes =
          recordAttributesObject(raw["attributes"]) ??
          recordAttributesObject(record.attributes);
        return {
          ...fields,
          type,
          ...(attributes === undefined ? {} : { attributes }),
        };
      }),
    ),
  );
};

const decodeQueueRateLimitExceededFactValue = (
  record: RuntimeRecord,
  type: QueueRateLimitExceededFactType,
): QueueRateLimitExceededFact | null => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  return nullable(
    Option.all({
      id: Option.orElse(stringValue(raw["id"]), () => Option.some(record.id)),
      queueId: Option.some(record.processId),
      entryId: stringValue(raw["entryId"]),
      occurredAt: Option.orElse(
        numberValue(raw["occurredAt"]),
        () => Option.some(DateTime.toEpochMillis(record.occurredAt)),
      ),
      limitKey: stringValue(raw["limitKey"]),
      algorithm: valueWhen(
        raw["algorithm"],
        (algorithm): algorithm is QueueRateLimitExceededFact["algorithm"] =>
          algorithm === "fixed-window" || algorithm === "token-bucket",
      ),
      limit: numberValue(raw["limit"]),
      tokens: numberValue(raw["tokens"]),
      windowMs: numberValue(raw["windowMs"]),
      outcome: valueWhen(
        raw["outcome"],
        (outcome): outcome is QueueRateLimitExceededFact["outcome"] =>
          outcome === "delayed" || outcome === "rejected",
      ),
      delayMs: numberValue(raw["delayMs"]),
      remaining: numberValue(raw["remaining"]),
      resetAfterMs: numberValue(raw["resetAfterMs"]),
    }).pipe(
      Option.flatMap((required) =>
        Option.all({
          retryAfterMs: optionalValue(raw["retryAfterMs"], isFiniteNumber),
          error: optionalValue(raw["error"], isString),
          key: optionalValue(raw["key"], isString),
          priority: optionalValue(raw["priority"], isQueuePriority),
        }).pipe(
          Option.map(({ error, key, priority, retryAfterMs }) => {
            const attributes =
              recordAttributesObject(raw["attributes"]) ??
              recordAttributesObject(record.attributes);
            return {
              ...required,
              type,
              ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
              ...(error === undefined ? {} : { error }),
              ...(key === undefined ? {} : { key }),
              ...(priority === undefined ? {} : { priority }),
              ...(attributes === undefined ? {} : { attributes }),
            };
          }),
        ),
      ),
    ),
  );
};

const QueueResourceCodec = Telemetry.codec(QueueResourceTelemetry)({
  Entry: {
    Enqueued: decodeQueueEntryFactValue,
    Started: decodeQueueEntryFactValue,
    Completed: decodeQueueEntryFactValue,
    Failed: decodeQueueEntryFactValue,
    Retried: decodeQueueEntryFactValue,
    Exhausted: decodeQueueEntryFactValue,
    Released: decodeQueueEntryFactValue,
    DeadLettered: decodeQueueEntryFactValue,
    Dropped: decodeQueueEntryFactValue,
  },
  Lifecycle: {
    Started: decodeQueueLifecycleChangeValue,
    Paused: decodeQueueLifecycleChangeValue,
    Resumed: decodeQueueLifecycleChangeValue,
    Shutdown: decodeQueueLifecycleChangeValue,
    Cleared: decodeQueueLifecycleChangeValue,
    Drained: decodeQueueLifecycleChangeValue,
  },
  DedupeKey: {
    Added: decodeQueueDedupeKeyChangeValue,
    Released: decodeQueueDedupeKeyChangeValue,
    Hydrated: decodeQueueDedupeKeyChangeValue,
  },
  RateLimit: {
    Exceeded: decodeQueueRateLimitExceededFactValue,
  },
});

/** @internal */
export const queueEntryFactTypes = QueueResourceCodec.types("Entry");

/** @internal */
export const queueLifecycleChangeTypes = QueueResourceCodec.types("Lifecycle");

/** @internal */
export const queueDedupeKeyChangeTypes = QueueResourceCodec.types("DedupeKey");

/** @internal */
export const queueRateLimitExceededFactTypes =
  QueueResourceCodec.types("RateLimit");

const recordToQueueEntryFact = (record: RuntimeRecord): QueueEntryFact | null =>
  QueueResourceCodec.decodeTag("Entry", record);

const recordToQueueLifecycleChange = (
  record: RuntimeRecord,
): QueueLifecycleChange | null =>
  QueueResourceCodec.decodeTag("Lifecycle", record);

const recordToQueueDedupeKeyChange = (
  record: RuntimeRecord,
): QueueDedupeKeyChange | null =>
  QueueResourceCodec.decodeTag("DedupeKey", record);

const recordToQueueRateLimitExceededFact = (
  record: RuntimeRecord,
): QueueRateLimitExceededFact | null =>
  QueueResourceCodec.decodeTag("RateLimit", record);

// ============================================================================
// Read-side query builders
// ============================================================================

const entryPredicates = (
  query: QueueEntryQuery | undefined,
): RuntimeRecordPredicate[] => [
    ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
    SubjectType.equals(QUEUE_ENTRY_SUBJECT_TYPE),
    ...(query?.queueId === undefined ? [] : [ProcessId.equals(query.queueId)]),
    ...(query?.types === undefined || query.types.length === 0
      ? []
      : [Type.in(query.types)]),
    ...(query?.entryId === undefined ? [] : [SubjectId.equals(query.entryId)]),
    ...(query?.key === undefined ? [] : [Key.equals(query.key)]),
    ...(query?.batchId === undefined ? [] : [IndexA.equals(query.batchId)]),
    ...(query?.releaseId === undefined
      ? []
      : [IndexB.equals(query.releaseId)]),
  ];

const lifecyclePredicates = (
  query: QueueLifecycleQuery | undefined,
): RuntimeRecordPredicate[] => [
    ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
    SubjectType.equals(QUEUE_LIFECYCLE_SUBJECT_TYPE),
    ...(query?.queueId === undefined ? [] : [ProcessId.equals(query.queueId)]),
    ...(query?.types === undefined || query.types.length === 0
      ? []
      : [Type.in(query.types)]),
  ];

const dedupePredicates = (
  query: QueueDedupeKeyQuery | undefined,
): RuntimeRecordPredicate[] => [
    ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
    SubjectType.equals(QUEUE_DEDUPE_KEY_SUBJECT_TYPE),
    ...(query?.queueId === undefined ? [] : [ProcessId.equals(query.queueId)]),
    ...(query?.key === undefined ? [] : [Key.equals(query.key)]),
    ...(query?.types === undefined || query.types.length === 0
      ? []
      : [Type.in(query.types)]),
  ];

const rateLimitPredicates = (
  query: QueueRateLimitQuery | undefined,
): RuntimeRecordPredicate[] => [
    ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
    SubjectType.equals(QUEUE_RATELIMIT_SUBJECT_TYPE),
    Type.in(queueRateLimitExceededFactTypes),
    ...(query?.queueId === undefined ? [] : [ProcessId.equals(query.queueId)]),
    ...(query?.entryId === undefined ? [] : [SubjectId.equals(query.entryId)]),
    ...(query?.limitKey === undefined ? [] : [Key.equals(query.limitKey)]),
  ];

// ============================================================================
// Read projections
// ============================================================================

const queueEntryFactsFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  query: QueueEntryQuery | undefined,
): QueueEntryFact[] =>
  applyQueryOpts(
    filterMapNullable(records, recordToQueueEntryFact),
    query?.opts,
    (fact) => fact.occurredAt,
  );

const queueLifecycleChangesFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  query: QueueLifecycleQuery | undefined,
): QueueLifecycleChange[] =>
  applyQueryOpts(
    filterMapNullable(records, recordToQueueLifecycleChange),
    query?.opts,
    (change) => change.changedAt,
  );

const queueDedupeKeyChangesFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  query: QueueDedupeKeyQuery | undefined,
): QueueDedupeKeyChange[] =>
  applyQueryOpts(
    filterMapNullable(records, recordToQueueDedupeKeyChange),
    query?.opts,
    (change) => change.changedAt,
  );

const queueRateLimitExceededFactsFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  query: QueueRateLimitQuery | undefined,
): QueueRateLimitExceededFact[] =>
  applyQueryOpts(
    filterMapNullable(records, recordToQueueRateLimitExceededFact),
    query?.opts,
    (fact) => fact.occurredAt,
  );

// ============================================================================
// Facet
// ============================================================================

/**
 * Queue resource storage facet (see module doc).
 *
 * Scoped fact emitters (`emitEntryFact`, …) delegate to static telemetry
 * on this class (`Entry.Enqueued`, `Lifecycle.Started`, …). They are silent
 * no-ops when the facet is not in context, and write through the spine when
 * it is. Storage failures surface through the returned error channel; queue
 * internals wrap telemetry-only writes with `ProcessStore.catchErrorAndLog`.
 *
 * Read methods (`entries`, `entriesByKey`, `lifecycle`, `dedupeKeys`, `rateLimits`)
 * are accessed through the resolved instance — `yield*` the facet (or
 * call `Effect.serviceOption(QueueResourceStore)`) to dispatch.
 *
 * @public
 */
export class QueueResourceStore extends ProcessStore.Service<
  QueueResourceStore
>()(
  "@nikscripts/effect-pm/store/queueResource/QueueResourceStore",
  "QueueResource",
  QueueResourceTelemetry,
  ProcessStore.query((s) => ({
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
    rateLimits: (query?: QueueRateLimitQuery) => readRateLimits(s, query),
  })),
  ProcessStore.for((queueId, s) => ({
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
    rateLimits: (query?: Omit<QueueRateLimitQuery, "queueId">) =>
      readRateLimits(s, { ...query, queueId }),
  })),
) {}

const entryFactInput = (
  fact: QueueEntryFact,
): {
  readonly id: string;
  readonly entryId: string;
  readonly occurredAt: number;
  readonly key?: string;
  readonly priority?: QueueResourceStorePriority;
  readonly attempts?: number;
  readonly batchId?: string;
} => ({
  id: fact.id,
  entryId: fact.entryId,
  occurredAt: fact.occurredAt,
  ...(fact.key === undefined ? {} : { key: fact.key }),
  ...(fact.priority === undefined ? {} : { priority: fact.priority }),
  ...(fact.attempts === undefined ? {} : { attempts: fact.attempts }),
  ...(fact.batchId === undefined ? {} : { batchId: fact.batchId }),
});

/** @public */
export const emitEntryFact = (
  fact: QueueEntryFact,
): Effect.Effect<void, ProcessStoreWriteError> =>
  QueueResourceScope.run(
    { queueId: fact.queueId },
    QueueEntryScope.run(
      { entryId: fact.entryId },
      Effect.gen(function* () {
        const common = entryFactInput(fact);
        switch (fact.type) {
          case "Queue.Entry.Enqueued":
            yield* QueueResourceStore.Entry.Enqueued({
              ...common,
              enqueuedAt: fact.enqueuedAt,
              ...(fact.payload === undefined ? {} : { payload: fact.payload }),
            });
            return;
          case "Queue.Entry.Started":
            yield* QueueResourceStore.Entry.Started({
              ...common,
              startedAt: fact.startedAt,
            });
            return;
          case "Queue.Entry.Completed":
            yield* QueueResourceStore.Entry.Completed({
              ...common,
              startedAt: fact.startedAt,
              durationMs: fact.durationMs,
            });
            return;
          case "Queue.Entry.Failed":
            yield* QueueResourceStore.Entry.Failed({
              ...common,
              startedAt: fact.startedAt,
              durationMs: fact.durationMs,
              ...(fact.error === undefined ? {} : { error: fact.error }),
            });
            return;
          case "Queue.Entry.Retried":
            yield* QueueResourceStore.Entry.Retried({
              ...common,
              ...(fact.error === undefined ? {} : { error: fact.error }),
            });
            return;
          case "Queue.Entry.Exhausted":
            yield* QueueResourceStore.Entry.Exhausted({
              ...common,
              ...(fact.error === undefined ? {} : { error: fact.error }),
            });
            return;
          case "Queue.Entry.Released":
            yield* QueueResourceStore.Entry.Released({
              ...common,
              releaseId: fact.releaseId,
              ...(fact.interruptedAt === undefined
                ? {}
                : { interruptedAt: fact.interruptedAt }),
            });
            return;
          case "Queue.Entry.DeadLettered":
            yield* QueueResourceStore.Entry.DeadLettered({
              ...common,
              ...(fact.reason === undefined ? {} : { reason: fact.reason }),
              ...(fact.error === undefined ? {} : { error: fact.error }),
            });
            return;
          case "Queue.Entry.Dropped":
            yield* QueueResourceStore.Entry.Dropped({
              ...common,
              ...(fact.reason === undefined ? {} : { reason: fact.reason }),
            });
            return;
          default: {
            const unknown = fact as { readonly type: string };
            return yield* Effect.die(
              `emitEntryFact: unknown entry fact type ${unknown.type}`,
            );
          }
        }
      }),
    ),
  );

/** @public */
export const emitLifecycleChange = (
  change: QueueLifecycleChange,
): Effect.Effect<void, ProcessStoreWriteError> =>
  QueueResourceScope.run(
    { queueId: change.queueId },
    Effect.gen(function* () {
      const input = { id: change.id, changedAt: change.changedAt };
      switch (change.type) {
        case "Queue.Lifecycle.Started":
          yield* QueueResourceStore.Lifecycle.Started(input);
          return;
        case "Queue.Lifecycle.Paused":
          yield* QueueResourceStore.Lifecycle.Paused(input);
          return;
        case "Queue.Lifecycle.Resumed":
          yield* QueueResourceStore.Lifecycle.Resumed(input);
          return;
        case "Queue.Lifecycle.Shutdown":
          yield* QueueResourceStore.Lifecycle.Shutdown(input);
          return;
        case "Queue.Lifecycle.Cleared":
          yield* QueueResourceStore.Lifecycle.Cleared({
            ...input,
            itemsCleared: change.itemsCleared,
          });
          return;
        case "Queue.Lifecycle.Drained":
          yield* QueueResourceStore.Lifecycle.Drained(input);
          return;
      }
    }),
  );

/** @public */
export const emitDedupeKeyChange = (
  change: QueueDedupeKeyChange,
): Effect.Effect<void, ProcessStoreWriteError> =>
  QueueResourceScope.run(
    { queueId: change.queueId },
    QueueDedupeKeyScope.run(
      { key: change.key },
      Effect.gen(function* () {
        const input = { id: change.id, changedAt: change.changedAt };
        switch (change.type) {
          case "Queue.DedupeKey.Added":
            yield* QueueResourceStore.DedupeKey.Added(input);
            return;
          case "Queue.DedupeKey.Released":
            yield* QueueResourceStore.DedupeKey.Released(input);
            return;
          case "Queue.DedupeKey.Hydrated":
            yield* QueueResourceStore.DedupeKey.Hydrated(input);
            return;
        }
      }),
    ),
  );

/** @public */
export const emitRateLimitExceededFact = (
  fact: QueueRateLimitExceededFact,
): Effect.Effect<void, ProcessStoreWriteError> =>
  QueueResourceScope.run(
    { queueId: fact.queueId },
    QueueEntryScope.run(
      { entryId: fact.entryId },
      QueueResourceStore.RateLimit.Exceeded({
        id: fact.id,
        occurredAt: fact.occurredAt,
        limitKey: fact.limitKey,
        algorithm: fact.algorithm,
        limit: fact.limit,
        tokens: fact.tokens,
        windowMs: fact.windowMs,
        outcome: fact.outcome,
        delayMs: fact.delayMs,
        remaining: fact.remaining,
        resetAfterMs: fact.resetAfterMs,
        ...(fact.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: fact.retryAfterMs }),
        ...(fact.error === undefined ? {} : { error: fact.error }),
        ...(fact.key === undefined ? {} : { key: fact.key }),
        ...(fact.priority === undefined ? {} : { priority: fact.priority }),
      }),
    ),
  );

/** @public */
export const emitEntryFacts = (
  facts: ReadonlyArray<QueueEntryFact>,
): Effect.Effect<void, ProcessStoreWriteError> =>
  Effect.forEach(facts, emitEntryFact, { discard: true });

/** @public */
export const emitLifecycleChanges = (
  changes: ReadonlyArray<QueueLifecycleChange>,
): Effect.Effect<void, ProcessStoreWriteError> =>
  Effect.forEach(changes, emitLifecycleChange, { discard: true });

/** @public */
export const emitDedupeKeyChanges = (
  changes: ReadonlyArray<QueueDedupeKeyChange>,
): Effect.Effect<void, ProcessStoreWriteError> =>
  Effect.forEach(changes, emitDedupeKeyChange, { discard: true });

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

const readRateLimits = (
  s: ProcessStoreSpine,
  query: QueueRateLimitQuery | undefined,
): Effect.Effect<QueueRateLimitExceededFact[], RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(rateLimitPredicates(query), query?.opts))
    .pipe(
      Effect.map((records) =>
        queueRateLimitExceededFactsFromRecords(records, query),
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
  export type Type = ProcessStore.Service.Type<typeof QueueResourceStore>;
  export type EmitType = ProcessStore.Service.EmitType<typeof QueueResourceStore>;
  export type IdentifierType = ProcessStore.Service.IdentifierType<
    typeof QueueResourceStore
  >;
}
