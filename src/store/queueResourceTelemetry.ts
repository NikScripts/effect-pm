/**
 * Queue resource facet telemetry tree (schemas, indexes, codec wiring).
 *
 * @module store/queueResourceTelemetry
 * @internal
 */

import { Schema } from "effect";
import {
  QueueDedupeKeyScope,
  QueueEntryScope,
  QueueResourceScope,
} from "../QueueResourceScope";
import { ProcessStore, Telemetry } from "../ProcessStore";

const QueuePrioritySchema = Schema.Literals(["high", "normal", "low"]);
const QueueRateLimitAlgorithmSchema = Schema.Literals([
  "fixed-window",
  "token-bucket",
]);
const QueueRateLimitOutcomeSchema = Schema.Literals(["delayed", "rejected"]);

const QueueEntryState = QueueEntryScope.Schema.State;
const QueueResourceState = QueueResourceScope.Schema.State;
const QueueDedupeKeyState = QueueDedupeKeyScope.Schema.State;

const queueEntryIndex = Telemetry.index(({ field }) => ({
  subjectType: "QueueEntry",
  subjectId: field("entryId"),
  key: field("key").optional(),
  indexA: field("batchId").optional().named("batchId"),
}));

const queueEntryCommonFields = {
  id: Schema.String,
  entryId: QueueEntryState.Entry.entryId,
  occurredAt: Schema.Number,
  key: Schema.optional(Schema.String),
  priority: Schema.optional(QueuePrioritySchema),
  attempts: Schema.optional(Schema.Number),
  batchId: Schema.optional(Schema.String),
} as const;

class QueueEntryEnqueued extends Telemetry.Schema<QueueEntryEnqueued>()(
  QueueEntryScope,
)({
  ...queueEntryCommonFields,
  enqueuedAt: Schema.Number,
  payload: Schema.optional(Schema.Unknown),
}) {}

class QueueEntryStarted extends Telemetry.Schema<QueueEntryStarted>()(
  QueueEntryScope,
)({
  ...queueEntryCommonFields,
  startedAt: Schema.Number,
}) {}

class QueueEntryCompleted extends Telemetry.Schema<QueueEntryCompleted>()(
  QueueEntryScope,
)({
  ...queueEntryCommonFields,
  startedAt: Schema.Number,
  durationMs: Schema.Number,
}) {}

class QueueEntryFailed extends Telemetry.Schema<QueueEntryFailed>()(
  QueueEntryScope,
)({
  ...queueEntryCommonFields,
  startedAt: Schema.Number,
  durationMs: Schema.Number,
  error: Schema.optional(Schema.String),
}) {}

class QueueEntryRetried extends Telemetry.Schema<QueueEntryRetried>()(
  QueueEntryScope,
)({
  ...queueEntryCommonFields,
  error: Schema.optional(Schema.String),
}) {}

class QueueEntryExhausted extends Telemetry.Schema<QueueEntryExhausted>()(
  QueueEntryScope,
)({
  ...queueEntryCommonFields,
  error: Schema.optional(Schema.String),
}) {}

class QueueEntryReleased extends Telemetry.Schema<QueueEntryReleased>()(
  QueueEntryScope,
)({
  ...queueEntryCommonFields,
  releaseId: Schema.String,
  interruptedAt: Schema.optional(Schema.Number),
}) {}

class QueueEntryDeadLettered extends Telemetry.Schema<QueueEntryDeadLettered>()(
  QueueEntryScope,
)({
  ...queueEntryCommonFields,
  reason: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}) {}

class QueueEntryDropped extends Telemetry.Schema<QueueEntryDropped>()(
  QueueEntryScope,
)({
  ...queueEntryCommonFields,
  reason: Schema.optional(Schema.String),
}) {}

const queueLifecycleIndex = Telemetry.index(({ field }) => ({
  subjectType: "QueueLifecycle",
  subjectId: field("queueId"),
}));

const queueLifecycleCommonFields = {
  id: Schema.String,
  queueId: QueueResourceState.queueId,
  changedAt: Schema.Number,
} as const;

class QueueLifecycleStarted extends Telemetry.Schema<QueueLifecycleStarted>()(
  QueueResourceScope,
)({
  ...queueLifecycleCommonFields,
}) {}

class QueueLifecyclePaused extends Telemetry.Schema<QueueLifecyclePaused>()(
  QueueResourceScope,
)({
  ...queueLifecycleCommonFields,
}) {}

class QueueLifecycleResumed extends Telemetry.Schema<QueueLifecycleResumed>()(
  QueueResourceScope,
)({
  ...queueLifecycleCommonFields,
}) {}

class QueueLifecycleShutdown extends Telemetry.Schema<QueueLifecycleShutdown>()(
  QueueResourceScope,
)({
  ...queueLifecycleCommonFields,
}) {}

class QueueLifecycleCleared extends Telemetry.Schema<QueueLifecycleCleared>()(
  QueueResourceScope,
)({
  ...queueLifecycleCommonFields,
  itemsCleared: Schema.Number,
}) {}

class QueueLifecycleDrained extends Telemetry.Schema<QueueLifecycleDrained>()(
  QueueResourceScope,
)({
  ...queueLifecycleCommonFields,
}) {}

const queueDedupeKeyIndex = Telemetry.index(({ field }) => ({
  subjectType: "QueueDedupeKey",
  subjectId: field("key"),
  key: field("key"),
}));

const queueDedupeKeyCommonFields = {
  id: Schema.String,
  key: QueueDedupeKeyState.DedupeKey.key,
  changedAt: Schema.Number,
} as const;

class QueueDedupeKeyAdded extends Telemetry.Schema<QueueDedupeKeyAdded>()(
  QueueDedupeKeyScope,
)(queueDedupeKeyCommonFields) {}

class QueueDedupeKeyReleased extends Telemetry.Schema<QueueDedupeKeyReleased>()(
  QueueDedupeKeyScope,
)(queueDedupeKeyCommonFields) {}

class QueueDedupeKeyHydrated extends Telemetry.Schema<QueueDedupeKeyHydrated>()(
  QueueDedupeKeyScope,
)(queueDedupeKeyCommonFields) {}

class QueueRateLimitExceeded extends Telemetry.Schema<QueueRateLimitExceeded>()(
  QueueEntryScope,
)({
  id: Schema.String,
  entryId: QueueEntryState.Entry.entryId,
  occurredAt: Schema.Number,
  limitKey: Schema.String,
  algorithm: QueueRateLimitAlgorithmSchema,
  limit: Schema.Number,
  tokens: Schema.Number,
  windowMs: Schema.Number,
  outcome: QueueRateLimitOutcomeSchema,
  delayMs: Schema.Number,
  remaining: Schema.Number,
  resetAfterMs: Schema.Number,
  retryAfterMs: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  priority: Schema.optional(QueuePrioritySchema),
}) {}

/** @internal */
export const QueueResourceTelemetry = ProcessStore.telemetry(
  QueueResourceScope,
)(
  Telemetry.namespace("Queue"),
  Telemetry.tag("Entry")(
    Telemetry.event("Enqueued", QueueEntryEnqueued).pipe(
      queueEntryIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.Enqueued",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    ),
    Telemetry.event("Started", QueueEntryStarted).pipe(
      queueEntryIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.Started",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    ),
    Telemetry.event("Completed", QueueEntryCompleted).pipe(
      queueEntryIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.Completed",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    ),
    Telemetry.event("Failed", QueueEntryFailed).pipe(
      queueEntryIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.Failed",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    ),
    Telemetry.event("Retried", QueueEntryRetried).pipe(
      queueEntryIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.Retried",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    ),
    Telemetry.event("Exhausted", QueueEntryExhausted).pipe(
      queueEntryIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.Exhausted",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    ),
    Telemetry.event("Released", QueueEntryReleased).pipe(
      queueEntryIndex,
      Telemetry.index(({ field }) => ({
        indexB: field("releaseId").named("releaseId"),
      })),
      Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.Released",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    ),
    Telemetry.event("DeadLettered", QueueEntryDeadLettered).pipe(
      queueEntryIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.DeadLettered",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    ),
    Telemetry.event("Dropped", QueueEntryDropped).pipe(
      queueEntryIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Entry.Dropped",
        ({ entryId }) => ({ entryId: String(entryId) }),
      ),
    ),
  ),
  Telemetry.tag("Lifecycle")(
    Telemetry.event("Started", QueueLifecycleStarted).pipe(
      queueLifecycleIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Lifecycle.Started",
        ({ queueId }) => ({ queueId: String(queueId) }),
      ),
    ),
    Telemetry.event("Paused", QueueLifecyclePaused).pipe(
      queueLifecycleIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Lifecycle.Paused",
        ({ queueId }) => ({ queueId: String(queueId) }),
      ),
    ),
    Telemetry.event("Resumed", QueueLifecycleResumed).pipe(
      queueLifecycleIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Lifecycle.Resumed",
        ({ queueId }) => ({ queueId: String(queueId) }),
      ),
    ),
    Telemetry.event("Shutdown", QueueLifecycleShutdown).pipe(
      queueLifecycleIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Lifecycle.Shutdown",
        ({ queueId }) => ({ queueId: String(queueId) }),
      ),
    ),
    Telemetry.event("Cleared", QueueLifecycleCleared).pipe(
      queueLifecycleIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Lifecycle.Cleared",
        ({ queueId }) => ({ queueId: String(queueId) }),
      ),
    ),
    Telemetry.event("Drained", QueueLifecycleDrained).pipe(
      queueLifecycleIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for Lifecycle.Drained",
        ({ queueId }) => ({ queueId: String(queueId) }),
      ),
    ),
  ),
  Telemetry.tag("DedupeKey")(
    Telemetry.event("Added", QueueDedupeKeyAdded).pipe(
      queueDedupeKeyIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for DedupeKey.Added",
        ({ key }) => ({ key: String(key) }),
      ),
    ),
    Telemetry.event("Released", QueueDedupeKeyReleased).pipe(
      queueDedupeKeyIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for DedupeKey.Released",
        ({ key }) => ({ key: String(key) }),
      ),
    ),
    Telemetry.event("Hydrated", QueueDedupeKeyHydrated).pipe(
      queueDedupeKeyIndex,
      Telemetry.logWarning(
        "QueueResourceStore write failed for DedupeKey.Hydrated",
        ({ key }) => ({ key: String(key) }),
      ),
    ),
  ),
  Telemetry.tag("RateLimit")(
    Telemetry.event("Exceeded", QueueRateLimitExceeded).pipe(
      Telemetry.index(({ field }) => ({
        subjectType: "QueueRateLimit",
        subjectId: field("entryId"),
        key: field("limitKey"),
      })),
      Telemetry.logWarning(
        "QueueResourceStore write failed for RateLimit.Exceeded",
        ({ entryId, limitKey }) => ({
          entryId: String(entryId),
          limitKey: String(limitKey),
        }),
      ),
    ),
  ),
);
