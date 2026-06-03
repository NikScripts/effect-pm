/**
 * **Queue resource storage facet** — durable, queryable history of one
 * priority-aware {@link QueueResource} worker.
 *
 * @remarks
 * Per-domain facet for {@link QueueResource}. Owns 19 concrete wire-event
 * types and their fact / change value shapes; reads return typed unions, not
 * generic envelopes.
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
 * `processId: <queueId>`. Indexed columns push per-key, per-batch, and
 * per-release lookups down to SQL without scanning the payload.
 *
 * ## Emit (optional)
 *
 * {@link QueueResource} emits via `QueueResourceStore.Entry.*`,
 * `.Lifecycle.*`, `.DedupeKey.*`, and `.RateLimit.*` within the appropriate
 * scopes. When the facet layer is not composed each static emitter is a
 * silent no-op; when composed, writes surface typed failures. Queue internals
 * wrap observability-only writes with `ProcessStore.catchErrorAndLog`.
 *
 * ## Read
 *
 * ```ts
 * // Instance — explicit queueId required on each call
 * const store = yield* QueueResourceStore;
 * yield* store.entries({ queueId: "@app/Email" });
 * yield* store.entriesByKey("user-42");
 * yield* store.lifecycle({ queueId: "@app/Email" });
 * yield* store.dedupeKeys({ queueId: "@app/Email" });
 * yield* store.rateLimits({ queueId: "@app/Email" });
 * yield* store.entryHistory("entry/42", { queueId: "@app/Email" });
 * yield* store.latestEntryFact("entry/42");
 * yield* store.byBatch("batch-1", { queueId: "@app/Email" });
 * yield* store.latestLifecycleEvent("@app/Email");
 *
 * // Identifier-bound shortcut — queueId baked in
 * const email = yield* QueueResourceStore.for("@app/Email");
 * yield* email.entries();
 * yield* email.entriesByKey("user-42");
 * yield* email.lifecycle();
 * yield* email.dedupeKeys();
 * yield* email.rateLimits();
 * yield* email.entryHistory("entry/42");
 * yield* email.latestEntryFact("entry/42");
 * yield* email.byBatch("batch-1");
 * yield* email.latestLifecycleEvent();
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
import { ProcessStore, Telemetry } from "../ProcessStore";
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
// Constants
// ============================================================================

const QUEUE_RESOURCE_PROCESS_TYPE = "QueueResource";
const QUEUE_ENTRY_SUBJECT_TYPE = "QueueEntry";
const QUEUE_LIFECYCLE_SUBJECT_TYPE = "QueueLifecycle";
const QUEUE_DEDUPE_KEY_SUBJECT_TYPE = "QueueDedupeKey";
const QUEUE_RATELIMIT_SUBJECT_TYPE = "QueueRateLimit";

// ============================================================================
// Public vocabulary types (non-fact enumerations)
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

/**
 * Wire-type discriminators for `Queue.Entry.*` facts.
 * Derived from the telemetry tree; can be used in `types` query filters.
 * @public
 */
export type QueueEntryFactType = Telemetry.Type.Event<
  typeof QueueResourceTelemetry,
  "Entry"
>;

/**
 * Wire-type discriminators for `Queue.Lifecycle.*` changes.
 * @public
 */
export type QueueLifecycleChangeType = Telemetry.Type.Event<
  typeof QueueResourceTelemetry,
  "Lifecycle"
>;

/**
 * Wire-type discriminators for `Queue.DedupeKey.*` changes.
 * @public
 */
export type QueueDedupeKeyChangeType = Telemetry.Type.Event<
  typeof QueueResourceTelemetry,
  "DedupeKey"
>;

/**
 * Wire-type discriminator for `Queue.RateLimit.Exceeded`.
 * @public
 */
export type QueueRateLimitExceededFactType = Telemetry.Type.Event<
  typeof QueueResourceTelemetry,
  "RateLimit"
>;

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
// Internal decoder helpers
// ============================================================================

const queuePriorities: ReadonlyArray<QueueResourceStorePriority> = [
  "high",
  "normal",
  "low",
];

const isQueuePriority = (
  value: unknown,
): value is QueueResourceStorePriority =>
  isString(value) && queuePriorities.some((p) => p === value);

/** Fields shared by every entry decoder. File-internal only. */
interface EntryCommon {
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

/**
 * Decodes the fields shared by all `Queue.Entry.*` types from a raw payload
 * and the parent record. Returns `null` on any required-field failure.
 */
const decodeEntryCommon = (
  raw: Readonly<Record<string, unknown>>,
  record: RuntimeRecord,
): EntryCommon | null =>
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
        () => Option.some(DateTime.toEpochMillis(record.occurredAt)),
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

// ============================================================================
// Entry decoders (one per wire type)
// ============================================================================

const decodeEntryEnqueued = (
  record: RuntimeRecord,
  type: "Queue.Entry.Enqueued",
) => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  const common = decodeEntryCommon(raw, record);
  if (common === null) return null;
  const enqueuedAt = raw["enqueuedAt"];
  if (!isFiniteNumber(enqueuedAt)) return null;
  const payload = raw["payload"];
  if (payload !== undefined && !isJsonValue(payload)) return null;
  return {
    ...common,
    type,
    enqueuedAt,
    ...(payload === undefined ? {} : { payload: payload as JsonValue }),
  };
};

const decodeEntryStarted = (
  record: RuntimeRecord,
  type: "Queue.Entry.Started",
) => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  const common = decodeEntryCommon(raw, record);
  if (common === null) return null;
  const startedAt = raw["startedAt"];
  if (!isFiniteNumber(startedAt)) return null;
  return { ...common, type, startedAt };
};

const decodeEntryCompleted = (
  record: RuntimeRecord,
  type: "Queue.Entry.Completed",
) => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  const common = decodeEntryCommon(raw, record);
  if (common === null) return null;
  const startedAt = raw["startedAt"];
  const durationMs = raw["durationMs"];
  if (!isFiniteNumber(startedAt) || !isFiniteNumber(durationMs)) return null;
  return { ...common, type, startedAt, durationMs };
};

const decodeEntryFailed = (
  record: RuntimeRecord,
  type: "Queue.Entry.Failed",
) => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  const common = decodeEntryCommon(raw, record);
  if (common === null) return null;
  const startedAt = raw["startedAt"];
  const durationMs = raw["durationMs"];
  if (!isFiniteNumber(startedAt) || !isFiniteNumber(durationMs)) return null;
  const error = raw["error"];
  if (error !== undefined && !isString(error)) return null;
  return {
    ...common,
    type,
    startedAt,
    durationMs,
    ...(error === undefined ? {} : { error }),
  };
};

const decodeEntryRetried = (
  record: RuntimeRecord,
  type: "Queue.Entry.Retried",
) => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  const common = decodeEntryCommon(raw, record);
  if (common === null) return null;
  const error = raw["error"];
  if (error !== undefined && !isString(error)) return null;
  return { ...common, type, ...(error === undefined ? {} : { error }) };
};

const decodeEntryExhausted = (
  record: RuntimeRecord,
  type: "Queue.Entry.Exhausted",
) => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  const common = decodeEntryCommon(raw, record);
  if (common === null) return null;
  const error = raw["error"];
  if (error !== undefined && !isString(error)) return null;
  return { ...common, type, ...(error === undefined ? {} : { error }) };
};

const decodeEntryReleased = (
  record: RuntimeRecord,
  type: "Queue.Entry.Released",
) => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  const common = decodeEntryCommon(raw, record);
  if (common === null) return null;
  // releaseId is indexed via IndexB as a fallback when absent from payload
  const releaseId = raw["releaseId"] ?? record.indexB;
  if (!isString(releaseId)) return null;
  // interruptedAt: absent → ok, present+valid → include, present+invalid → reject
  const interruptedAt = optionalValue(raw["interruptedAt"], isFiniteNumber);
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
};

const decodeEntryDeadLettered = (
  record: RuntimeRecord,
  type: "Queue.Entry.DeadLettered",
) => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  const common = decodeEntryCommon(raw, record);
  if (common === null) return null;
  const reason = raw["reason"];
  const error = raw["error"];
  if (reason !== undefined && !isString(reason)) return null;
  if (error !== undefined && !isString(error)) return null;
  return {
    ...common,
    type,
    ...(reason === undefined ? {} : { reason }),
    ...(error === undefined ? {} : { error }),
  };
};

const decodeEntryDropped = (
  record: RuntimeRecord,
  type: "Queue.Entry.Dropped",
) => {
  if (record.processType !== QUEUE_RESOURCE_PROCESS_TYPE) return null;
  if (record.type !== type) return null;
  const raw = record.payload;
  if (!isRecord(raw)) return null;
  const common = decodeEntryCommon(raw, record);
  if (common === null) return null;
  const reason = raw["reason"];
  if (reason !== undefined && !isString(reason)) return null;
  return { ...common, type, ...(reason === undefined ? {} : { reason }) };
};

// ============================================================================
// Lifecycle decoders (one per wire type)
// ============================================================================

/**
 * Shared base decoder for the five lifecycle events that carry no extra
 * fields beyond `id`, `queueId`, `changedAt`, and optional `attributes`.
 * Each named decoder below instantiates this with its own literal type so
 * `Telemetry.Type.CodecTag` infers a distinct member for every event.
 */
const makeSimpleLifecycleDecoder =
  <T extends "Queue.Lifecycle.Started" | "Queue.Lifecycle.Paused" | "Queue.Lifecycle.Resumed" | "Queue.Lifecycle.Shutdown" | "Queue.Lifecycle.Drained">(
    _expectedType: T,
  ) =>
  (record: RuntimeRecord, type: T) => {
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
        Option.map((base) => {
          const attributes =
            recordAttributesObject(raw["attributes"]) ??
            recordAttributesObject(record.attributes);
          return {
            ...base,
            type,
            ...(attributes === undefined ? {} : { attributes }),
          };
        }),
      ),
    );
  };

const decodeLifecycleStarted = makeSimpleLifecycleDecoder("Queue.Lifecycle.Started");
const decodeLifecyclePaused = makeSimpleLifecycleDecoder("Queue.Lifecycle.Paused");
const decodeLifecycleResumed = makeSimpleLifecycleDecoder("Queue.Lifecycle.Resumed");
const decodeLifecycleShutdown = makeSimpleLifecycleDecoder("Queue.Lifecycle.Shutdown");
const decodeLifecycleDrained = makeSimpleLifecycleDecoder("Queue.Lifecycle.Drained");

/** `Queue.Lifecycle.Cleared` carries `itemsCleared` in addition to the base fields. */
const decodeLifecycleCleared = (
  record: RuntimeRecord,
  type: "Queue.Lifecycle.Cleared",
) => {
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
      itemsCleared: numberValue(raw["itemsCleared"]),
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

// ============================================================================
// DedupeKey decoders (one per wire type)
// ============================================================================

/**
 * Shared base decoder for the three dedupe-key events (`Added`, `Released`,
 * `Hydrated`). Same factory pattern as {@link makeSimpleLifecycleDecoder}.
 */
const makeDedupeKeyDecoder =
  <T extends QueueDedupeKeyChangeType>(_expectedType: T) =>
  (record: RuntimeRecord, type: T) => {
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

const decodeDedupeAdded = makeDedupeKeyDecoder("Queue.DedupeKey.Added");
const decodeDedupeReleased = makeDedupeKeyDecoder("Queue.DedupeKey.Released");
const decodeDedupeHydrated = makeDedupeKeyDecoder("Queue.DedupeKey.Hydrated");

// ============================================================================
// RateLimit decoder
// ============================================================================

const decodeRateLimitExceeded = (
  record: RuntimeRecord,
  type: "Queue.RateLimit.Exceeded",
) => {
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
        (v): v is "fixed-window" | "token-bucket" =>
          v === "fixed-window" || v === "token-bucket",
      ),
      limit: numberValue(raw["limit"]),
      tokens: numberValue(raw["tokens"]),
      windowMs: numberValue(raw["windowMs"]),
      outcome: valueWhen(
        raw["outcome"],
        (v): v is "delayed" | "rejected" =>
          v === "delayed" || v === "rejected",
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

// ============================================================================
// Codec
// ============================================================================

const QueueResourceCodec = Telemetry.codec(QueueResourceTelemetry)({
  Entry: {
    Enqueued: decodeEntryEnqueued,
    Started: decodeEntryStarted,
    Completed: decodeEntryCompleted,
    Failed: decodeEntryFailed,
    Retried: decodeEntryRetried,
    Exhausted: decodeEntryExhausted,
    Released: decodeEntryReleased,
    DeadLettered: decodeEntryDeadLettered,
    Dropped: decodeEntryDropped,
  },
  Lifecycle: {
    Started: decodeLifecycleStarted,
    Paused: decodeLifecyclePaused,
    Resumed: decodeLifecycleResumed,
    Shutdown: decodeLifecycleShutdown,
    Cleared: decodeLifecycleCleared,
    Drained: decodeLifecycleDrained,
  },
  DedupeKey: {
    Added: decodeDedupeAdded,
    Released: decodeDedupeReleased,
    Hydrated: decodeDedupeHydrated,
  },
  RateLimit: {
    Exceeded: decodeRateLimitExceeded,
  },
});

// Internal codec type constants — used in predicate builders and for
// pre-filtering storage queries to the wire types owned by this facet.
const entryRecordTypes = QueueResourceCodec.types("Entry");
const lifecycleRecordTypes = QueueResourceCodec.types("Lifecycle");
const dedupeKeyRecordTypes = QueueResourceCodec.types("DedupeKey");
const rateLimitRecordTypes = QueueResourceCodec.types("RateLimit");

// ============================================================================
// Public fact / change types — derived from codec
// ============================================================================

/**
 * Discriminated union of every per-status fact emitted by {@link QueueResource}.
 * Each member maps 1:1 to a wire-event type (`Queue.Entry.<status>`).
 *
 * @public
 */
export type QueueEntryFact = Telemetry.Type.CodecTag<typeof QueueResourceCodec, "Entry">;

/** @public */
export type QueueEntryEnqueuedFact = Extract<QueueEntryFact, { readonly type: "Queue.Entry.Enqueued" }>;
/** @public */
export type QueueEntryStartedFact = Extract<QueueEntryFact, { readonly type: "Queue.Entry.Started" }>;
/** @public */
export type QueueEntryCompletedFact = Extract<QueueEntryFact, { readonly type: "Queue.Entry.Completed" }>;
/** @public */
export type QueueEntryFailedFact = Extract<QueueEntryFact, { readonly type: "Queue.Entry.Failed" }>;
/** @public */
export type QueueEntryRetriedFact = Extract<QueueEntryFact, { readonly type: "Queue.Entry.Retried" }>;
/** @public */
export type QueueEntryExhaustedFact = Extract<QueueEntryFact, { readonly type: "Queue.Entry.Exhausted" }>;
/** @public */
export type QueueEntryReleasedFact = Extract<QueueEntryFact, { readonly type: "Queue.Entry.Released" }>;
/** @public */
export type QueueEntryDeadLetteredFact = Extract<QueueEntryFact, { readonly type: "Queue.Entry.DeadLettered" }>;
/** @public */
export type QueueEntryDroppedFact = Extract<QueueEntryFact, { readonly type: "Queue.Entry.Dropped" }>;

/**
 * Discriminated union of every per-tag lifecycle change emitted by
 * {@link QueueResource}. Each member maps 1:1 to a wire-event type
 * (`Queue.Lifecycle.<tag>`).
 *
 * @public
 */
export type QueueLifecycleChange = Telemetry.Type.CodecTag<typeof QueueResourceCodec, "Lifecycle">;

/** @public */
export type QueueLifecycleStartedChange = Extract<QueueLifecycleChange, { readonly type: "Queue.Lifecycle.Started" }>;
/** @public */
export type QueueLifecyclePausedChange = Extract<QueueLifecycleChange, { readonly type: "Queue.Lifecycle.Paused" }>;
/** @public */
export type QueueLifecycleResumedChange = Extract<QueueLifecycleChange, { readonly type: "Queue.Lifecycle.Resumed" }>;
/** @public */
export type QueueLifecycleShutdownChange = Extract<QueueLifecycleChange, { readonly type: "Queue.Lifecycle.Shutdown" }>;
/** @public */
export type QueueLifecycleClearedChange = Extract<QueueLifecycleChange, { readonly type: "Queue.Lifecycle.Cleared" }>;
/** @public */
export type QueueLifecycleDrainedChange = Extract<QueueLifecycleChange, { readonly type: "Queue.Lifecycle.Drained" }>;

/**
 * Discriminated union of every per-status dedupe-key change emitted by
 * {@link QueueResource}. Each member maps 1:1 to a wire-event type
 * (`Queue.DedupeKey.<status>`).
 *
 * @public
 */
export type QueueDedupeKeyChange = Telemetry.Type.CodecTag<typeof QueueResourceCodec, "DedupeKey">;

/** @public */
export type QueueDedupeKeyAddedChange = Extract<QueueDedupeKeyChange, { readonly type: "Queue.DedupeKey.Added" }>;
/** @public */
export type QueueDedupeKeyReleasedChange = Extract<QueueDedupeKeyChange, { readonly type: "Queue.DedupeKey.Released" }>;
/** @public */
export type QueueDedupeKeyHydratedChange = Extract<QueueDedupeKeyChange, { readonly type: "Queue.DedupeKey.Hydrated" }>;

/**
 * The single rate-limit fact emitted when a queue entry exceeds a configured
 * `rateLimit` quota. Maps 1:1 to `Queue.RateLimit.Exceeded`.
 *
 * @public
 */
export type QueueRateLimitExceededFact = Telemetry.Type.CodecTag<typeof QueueResourceCodec, "RateLimit">;

// ============================================================================
// Record → domain type helpers
// ============================================================================

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
// Predicate builders
// ============================================================================

const entryPredicates = (
  query: QueueEntryQuery | undefined,
): RuntimeRecordPredicate[] => [
  ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
  SubjectType.equals(QUEUE_ENTRY_SUBJECT_TYPE),
  // Narrow to the exact wire types this facet owns (or a caller-supplied
  // subset) so storage can use a covering index rather than scanning all rows.
  ...(query?.types !== undefined && query.types.length > 0
    ? [Type.in(query.types)]
    : [Type.in(entryRecordTypes)]),
  ...(query?.queueId === undefined ? [] : [ProcessId.equals(query.queueId)]),
  ...(query?.entryId === undefined ? [] : [SubjectId.equals(query.entryId)]),
  ...(query?.key === undefined ? [] : [Key.equals(query.key)]),
  ...(query?.batchId === undefined ? [] : [IndexA.equals(query.batchId)]),
  ...(query?.releaseId === undefined ? [] : [IndexB.equals(query.releaseId)]),
];

const lifecyclePredicates = (
  query: QueueLifecycleQuery | undefined,
): RuntimeRecordPredicate[] => [
  ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
  SubjectType.equals(QUEUE_LIFECYCLE_SUBJECT_TYPE),
  ...(query?.types !== undefined && query.types.length > 0
    ? [Type.in(query.types)]
    : [Type.in(lifecycleRecordTypes)]),
  ...(query?.queueId === undefined ? [] : [ProcessId.equals(query.queueId)]),
];

const dedupePredicates = (
  query: QueueDedupeKeyQuery | undefined,
): RuntimeRecordPredicate[] => [
  ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
  SubjectType.equals(QUEUE_DEDUPE_KEY_SUBJECT_TYPE),
  ...(query?.types !== undefined && query.types.length > 0
    ? [Type.in(query.types)]
    : [Type.in(dedupeKeyRecordTypes)]),
  ...(query?.queueId === undefined ? [] : [ProcessId.equals(query.queueId)]),
  ...(query?.key === undefined ? [] : [Key.equals(query.key)]),
];

const rateLimitPredicates = (
  query: QueueRateLimitQuery | undefined,
): RuntimeRecordPredicate[] => [
  ProcessType.equals(QUEUE_RESOURCE_PROCESS_TYPE),
  SubjectType.equals(QUEUE_RATELIMIT_SUBJECT_TYPE),
  Type.in(rateLimitRecordTypes),
  ...(query?.queueId === undefined ? [] : [ProcessId.equals(query.queueId)]),
  ...(query?.entryId === undefined ? [] : [SubjectId.equals(query.entryId)]),
  ...(query?.limitKey === undefined ? [] : [Key.equals(query.limitKey)]),
];

// ============================================================================
// Read projections — apply opts (sort + limit) to decoded results
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
 * Static optional telemetry emitters (`Entry.Enqueued`, `Lifecycle.Started`,
 * …) no-op when the facet is absent and write through the spine when it is.
 * Storage failures surface through the returned error channel; queue internals
 * wrap observability-only writes with `ProcessStore.catchErrorAndLog`.
 *
 * ### Read methods (resolved instance)
 *
 * | Method | Description |
 * |--------|-------------|
 * | `entries(query?)` | All entry facts matching the query. |
 * | `entriesByKey(key, query?)` | All entry facts for a specific dedup/routing key. |
 * | `lifecycle(query?)` | All lifecycle changes for a queue. |
 * | `dedupeKeys(query?)` | All dedupe-key changes for a queue. |
 * | `rateLimits(query?)` | All rate-limit exceeded facts for a queue. |
 * | `entryHistory(entryId, query?)` | All facts for a single entry, ordered by `occurredAt` desc. |
 * | `latestEntryFact(entryId, queueId?)` | The most recent fact for an entry (`Option.none` if not found). |
 * | `byBatch(batchId, query?)` | All entry facts that belong to a batch. |
 * | `latestLifecycleEvent(queueId, query?)` | The most recent lifecycle change for a queue. |
 *
 * @public
 */
export const QueueResourceStore = ProcessStore.Service(
  "@nikscripts/effect-pm/store/queueResource/QueueResourceStore",
  QueueResourceTelemetry,
  ProcessStore.query((s) => ({
    entries: (query?: QueueEntryQuery) => readEntries(s, query),
    entriesByKey: (key: string, query?: Omit<QueueEntryQuery, "key">) =>
      readEntries(s, { ...query, key }),
    lifecycle: (query?: QueueLifecycleQuery) => readLifecycle(s, query),
    dedupeKeys: (query?: QueueDedupeKeyQuery) => readDedupeKeys(s, query),
    rateLimits: (query?: QueueRateLimitQuery) => readRateLimits(s, query),
    entryHistory: (entryId: string, query?: Omit<QueueEntryQuery, "entryId">) =>
      readEntries(s, { ...query, entryId }),
    latestEntryFact: (
      entryId: string,
      queueId?: string,
    ) => readLatestEntryFact(s, entryId, queueId),
    byBatch: (batchId: string, query?: Omit<QueueEntryQuery, "batchId">) =>
      readEntries(s, { ...query, batchId }),
    latestLifecycleEvent: (
      queueId: string,
      query?: Omit<QueueLifecycleQuery, "queueId">,
    ) => readLatestLifecycleEvent(s, queueId, query),
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
    entryHistory: (
      entryId: string,
      query?: Omit<QueueEntryQuery, "queueId" | "entryId">,
    ) => readEntries(s, { ...query, queueId, entryId }),
    latestEntryFact: (entryId: string) =>
      readLatestEntryFact(s, entryId, queueId),
    byBatch: (
      batchId: string,
      query?: Omit<QueueEntryQuery, "queueId" | "batchId">,
    ) => readEntries(s, { ...query, queueId, batchId }),
    latestLifecycleEvent: (query?: Omit<QueueLifecycleQuery, "queueId">) =>
      readLatestLifecycleEvent(s, queueId, query),
  })),
);

export type QueueResourceStore = typeof QueueResourceStore.Identifier;

// ============================================================================
// Private read helpers
// ============================================================================

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
 * Returns the most recent fact for a single entry as an `Option`.
 * Passes `limit: 1` to storage since all predicates are indexed — no
 * post-filtering is required and decode failures are rare in practice.
 */
const readLatestEntryFact = (
  s: ProcessStoreSpine,
  entryId: string,
  queueId: string | undefined,
): Effect.Effect<Option.Option<QueueEntryFact>, RuntimeStorageOperationalError> =>
  readEntries(s, { entryId, queueId, opts: { limit: 1 } }).pipe(
    Effect.map((facts) =>
      facts[0] === undefined ? Option.none() : Option.some(facts[0]),
    ),
  );

/**
 * Returns the most recent lifecycle change for a queue as an `Option`.
 * Uses `limit: 1` at storage since the queueId predicate pushes down.
 */
const readLatestLifecycleEvent = (
  s: ProcessStoreSpine,
  queueId: string,
  query: Omit<QueueLifecycleQuery, "queueId"> | undefined,
): Effect.Effect<Option.Option<QueueLifecycleChange>, RuntimeStorageOperationalError> =>
  readLifecycle(s, { ...query, queueId, opts: { limit: 1 } }).pipe(
    Effect.map((changes) =>
      changes[0] === undefined ? Option.none() : Option.some(changes[0]),
    ),
  );
