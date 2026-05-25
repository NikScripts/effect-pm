/**
 * Queue resource storage facet — durable, queryable history of one
 * priority-aware {@link QueueResource} worker.
 *
 * @remarks
 * Per-domain facet for {@link QueueResource}. Owns its concrete
 * wire-event types (`queue.entry.<status>`, `queue.lifecycle.<tag>`,
 * `queue.dedupe-key.<status>` — 18 distinct types in total), its
 * `Queue*Fact` / `Queue*Change` value shapes, and per-kind read
 * projections.
 *
 * **No shared generic vocabulary.** This facet does **not** use the
 * removed `runtime.fact.recorded` / `runtime.state.changed` envelope.
 * Each per-domain facet (queue, run-resource, process, …) owns its own
 * concrete types — see `docs/STORAGE.md`.
 *
 * ## Emit (optional)
 *
 * `QueueResource.make` calls the **static** record helpers on this class
 * (`ProcessStoreQueueResource.recordEntry`, `.recordLifecycle`,
 * `.recordDedupeKey`, plus their `*Batch` variants). When the facet
 * layer is not composed each call is a silent no-op; when composed it
 * writes through the spine. The builder wraps every static emitter
 * with a built-in `catchCause + Effect.logWarning` so storage failures
 * never propagate into queue work.
 *
 * ## Read (instance-only)
 *
 * Read methods live only on the resolved instance — yield it (or call
 * `Effect.serviceOption(ProcessStoreQueueResource)` and pattern-match
 * the optional) and dispatch:
 *
 * ```ts
 * const queue = yield* ProcessStoreQueueResource;
 * yield* queue.entries({ queueId: "@app/Email" });
 * yield* queue.entriesByKey("user-42");
 * yield* queue.lifecycle({ queueId: "@app/Email" });
 * yield* queue.dedupeKeys({ queueId: "@app/Email" });
 * ```
 *
 * ## Compose
 *
 * - `ProcessStoreQueueResource.layerRuntimeStorage` — facet on top of
 *   injected {@link RuntimeStorage}.
 * - `ProcessStoreQueueResource.layer` — facet + in-memory
 *   {@link RuntimeStorage} (dev/test only).
 * - Composed by `ProcessStorage.layerRuntimeStorage` and
 *   `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`.
 *
 * @module store/QueueResource
 */

import { Effect } from "effect";
import { applyQueryOpts } from "../internal/store/spine";
import { ProcessStore } from "../ProcessStore";
import type {
  AnalyticsEvent,
  AnalyticsEventBase,
  JsonValue,
  QueryOpts,
  StoreEventQuery,
} from "../ProcessStoreEvent";

// ============================================================================
// Public type-level vocabulary
// ============================================================================

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
export type ProcessStoreQueueResourceLifecycleTag =
  | "Started"
  | "Paused"
  | "Resumed"
  | "Shutdown"
  | "Cleared"
  | "Drained";

/** @public */
export type ProcessStoreQueueResourceDedupeKeyStatus =
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
  readonly priority?: ProcessStoreQueueResourcePriority;
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
// Wire events — one concrete type per fact / change discriminator
// ============================================================================

/** @public */
export interface QueueEntryEnqueuedEvent extends AnalyticsEventBase {
  type: "queue.entry.enqueued";
  entityType: "queue-resource";
  fact: QueueEntryEnqueuedFact;
}

/** @public */
export interface QueueEntryStartedEvent extends AnalyticsEventBase {
  type: "queue.entry.started";
  entityType: "queue-resource";
  fact: QueueEntryStartedFact;
}

/** @public */
export interface QueueEntryCompletedEvent extends AnalyticsEventBase {
  type: "queue.entry.completed";
  entityType: "queue-resource";
  fact: QueueEntryCompletedFact;
}

/** @public */
export interface QueueEntryFailedEvent extends AnalyticsEventBase {
  type: "queue.entry.failed";
  entityType: "queue-resource";
  fact: QueueEntryFailedFact;
}

/** @public */
export interface QueueEntryRetriedEvent extends AnalyticsEventBase {
  type: "queue.entry.retried";
  entityType: "queue-resource";
  fact: QueueEntryRetriedFact;
}

/** @public */
export interface QueueEntryExhaustedEvent extends AnalyticsEventBase {
  type: "queue.entry.exhausted";
  entityType: "queue-resource";
  fact: QueueEntryExhaustedFact;
}

/** @public */
export interface QueueEntryReleasedEvent extends AnalyticsEventBase {
  type: "queue.entry.released";
  entityType: "queue-resource";
  fact: QueueEntryReleasedFact;
}

/** @public */
export interface QueueEntryDeadLetteredEvent extends AnalyticsEventBase {
  type: "queue.entry.dead-lettered";
  entityType: "queue-resource";
  fact: QueueEntryDeadLetteredFact;
}

/** @public */
export interface QueueEntryDroppedEvent extends AnalyticsEventBase {
  type: "queue.entry.dropped";
  entityType: "queue-resource";
  fact: QueueEntryDroppedFact;
}

/**
 * Closed union of every persisted queue-entry wire event. Contributed
 * to {@link AnalyticsEvent} via re-export from `ProcessStoreEvent.ts`.
 *
 * @public
 */
export type QueueEntryRecordedEvent =
  | QueueEntryEnqueuedEvent
  | QueueEntryStartedEvent
  | QueueEntryCompletedEvent
  | QueueEntryFailedEvent
  | QueueEntryRetriedEvent
  | QueueEntryExhaustedEvent
  | QueueEntryReleasedEvent
  | QueueEntryDeadLetteredEvent
  | QueueEntryDroppedEvent;

/** @public */
export interface QueueLifecycleStartedEvent extends AnalyticsEventBase {
  type: "queue.lifecycle.started";
  entityType: "queue-resource";
  change: QueueLifecycleStartedChange;
}

/** @public */
export interface QueueLifecyclePausedEvent extends AnalyticsEventBase {
  type: "queue.lifecycle.paused";
  entityType: "queue-resource";
  change: QueueLifecyclePausedChange;
}

/** @public */
export interface QueueLifecycleResumedEvent extends AnalyticsEventBase {
  type: "queue.lifecycle.resumed";
  entityType: "queue-resource";
  change: QueueLifecycleResumedChange;
}

/** @public */
export interface QueueLifecycleShutdownEvent extends AnalyticsEventBase {
  type: "queue.lifecycle.shutdown";
  entityType: "queue-resource";
  change: QueueLifecycleShutdownChange;
}

/** @public */
export interface QueueLifecycleClearedEvent extends AnalyticsEventBase {
  type: "queue.lifecycle.cleared";
  entityType: "queue-resource";
  change: QueueLifecycleClearedChange;
}

/** @public */
export interface QueueLifecycleDrainedEvent extends AnalyticsEventBase {
  type: "queue.lifecycle.drained";
  entityType: "queue-resource";
  change: QueueLifecycleDrainedChange;
}

/**
 * Closed union of every persisted queue-lifecycle wire event.
 *
 * @public
 */
export type QueueLifecycleChangedEvent =
  | QueueLifecycleStartedEvent
  | QueueLifecyclePausedEvent
  | QueueLifecycleResumedEvent
  | QueueLifecycleShutdownEvent
  | QueueLifecycleClearedEvent
  | QueueLifecycleDrainedEvent;

/** @public */
export interface QueueDedupeKeyAddedEvent extends AnalyticsEventBase {
  type: "queue.dedupe-key.added";
  entityType: "queue-resource";
  change: QueueDedupeKeyAddedChange;
}

/** @public */
export interface QueueDedupeKeyReleasedEvent extends AnalyticsEventBase {
  type: "queue.dedupe-key.released";
  entityType: "queue-resource";
  change: QueueDedupeKeyReleasedChange;
}

/** @public */
export interface QueueDedupeKeyHydratedEvent extends AnalyticsEventBase {
  type: "queue.dedupe-key.hydrated";
  entityType: "queue-resource";
  change: QueueDedupeKeyHydratedChange;
}

/**
 * Closed union of every persisted queue-dedupe-key wire event.
 *
 * @public
 */
export type QueueDedupeKeyChangedEvent =
  | QueueDedupeKeyAddedEvent
  | QueueDedupeKeyReleasedEvent
  | QueueDedupeKeyHydratedEvent;

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

const QUEUE_RESOURCE_ENTITY_TYPE = "queue-resource" as const;
const QUEUE_ENTRY_SUBJECT_TYPE = "queue-entry" as const;
const QUEUE_LIFECYCLE_SUBJECT_TYPE = "queue-lifecycle" as const;
const QUEUE_DEDUPE_KEY_SUBJECT_TYPE = "queue-dedupe-key" as const;
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

/**
 * Narrows an {@link AnalyticsEvent} to {@link QueueEntryRecordedEvent}.
 *
 * @public
 */
export const isQueueEntryRecordedEvent = (
  event: AnalyticsEvent,
): event is QueueEntryRecordedEvent => {
  switch (event.type) {
    case "queue.entry.enqueued":
    case "queue.entry.started":
    case "queue.entry.completed":
    case "queue.entry.failed":
    case "queue.entry.retried":
    case "queue.entry.exhausted":
    case "queue.entry.released":
    case "queue.entry.dead-lettered":
    case "queue.entry.dropped":
      return true;
    default:
      return false;
  }
};

/**
 * Narrows an {@link AnalyticsEvent} to {@link QueueLifecycleChangedEvent}.
 *
 * @public
 */
export const isQueueLifecycleChangedEvent = (
  event: AnalyticsEvent,
): event is QueueLifecycleChangedEvent => {
  switch (event.type) {
    case "queue.lifecycle.started":
    case "queue.lifecycle.paused":
    case "queue.lifecycle.resumed":
    case "queue.lifecycle.shutdown":
    case "queue.lifecycle.cleared":
    case "queue.lifecycle.drained":
      return true;
    default:
      return false;
  }
};

/**
 * Narrows an {@link AnalyticsEvent} to {@link QueueDedupeKeyChangedEvent}.
 *
 * @public
 */
export const isQueueDedupeKeyChangedEvent = (
  event: AnalyticsEvent,
): event is QueueDedupeKeyChangedEvent => {
  switch (event.type) {
    case "queue.dedupe-key.added":
    case "queue.dedupe-key.released":
    case "queue.dedupe-key.hydrated":
      return true;
    default:
      return false;
  }
};

// ============================================================================
// Encoders (fact / change → wire event)
// ============================================================================

const mergeAttributes = (
  base: Record<string, unknown>,
  user: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  if (user === undefined) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(user)) {
    if (out[key] === undefined) out[key] = value;
  }
  return out;
};

const baseEntryAttributes = (fact: QueueEntryFact): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    subjectType: QUEUE_ENTRY_SUBJECT_TYPE,
    subjectId: fact.entryId,
    indexNames: QUEUE_RESOURCE_INDEX_NAMES,
  };
  if (fact.key !== undefined) base["key"] = fact.key;
  if (fact.batchId !== undefined) base["indexA"] = fact.batchId;
  if (fact.type === "queue.entry.released") {
    base["indexB"] = fact.releaseId;
  }
  return mergeAttributes(base, fact.attributes);
};

const baseLifecycleAttributes = (
  change: QueueLifecycleChange,
): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    subjectType: QUEUE_LIFECYCLE_SUBJECT_TYPE,
    subjectId: change.queueId,
  };
  return mergeAttributes(base, change.attributes);
};

const baseDedupeAttributes = (
  change: QueueDedupeKeyChange,
): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    subjectType: QUEUE_DEDUPE_KEY_SUBJECT_TYPE,
    subjectId: change.key,
    key: change.key,
  };
  return mergeAttributes(base, change.attributes);
};

/** @internal */
export const makeQueueEntryEvent = (
  fact: QueueEntryFact,
): QueueEntryRecordedEvent => {
  const id = `queue.entry/${fact.id}`;
  const occurredAt = fact.occurredAt;
  const entityId = fact.queueId;
  const attributes = baseEntryAttributes(fact);
  switch (fact.type) {
    case "queue.entry.enqueued":
      return {
        id,
        type: "queue.entry.enqueued",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    case "queue.entry.started":
      return {
        id,
        type: "queue.entry.started",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    case "queue.entry.completed":
      return {
        id,
        type: "queue.entry.completed",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    case "queue.entry.failed":
      return {
        id,
        type: "queue.entry.failed",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    case "queue.entry.retried":
      return {
        id,
        type: "queue.entry.retried",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    case "queue.entry.exhausted":
      return {
        id,
        type: "queue.entry.exhausted",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    case "queue.entry.released":
      return {
        id,
        type: "queue.entry.released",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    case "queue.entry.dead-lettered":
      return {
        id,
        type: "queue.entry.dead-lettered",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    case "queue.entry.dropped":
      return {
        id,
        type: "queue.entry.dropped",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
  }
};

/** @internal */
export const makeQueueLifecycleEvent = (
  change: QueueLifecycleChange,
): QueueLifecycleChangedEvent => {
  const id = `queue.lifecycle/${change.id}`;
  const occurredAt = change.changedAt;
  const entityId = change.queueId;
  const attributes = baseLifecycleAttributes(change);
  switch (change.type) {
    case "queue.lifecycle.started":
      return {
        id,
        type: "queue.lifecycle.started",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    case "queue.lifecycle.paused":
      return {
        id,
        type: "queue.lifecycle.paused",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    case "queue.lifecycle.resumed":
      return {
        id,
        type: "queue.lifecycle.resumed",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    case "queue.lifecycle.shutdown":
      return {
        id,
        type: "queue.lifecycle.shutdown",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    case "queue.lifecycle.cleared":
      return {
        id,
        type: "queue.lifecycle.cleared",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    case "queue.lifecycle.drained":
      return {
        id,
        type: "queue.lifecycle.drained",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
  }
};

/** @internal */
export const makeQueueDedupeKeyEvent = (
  change: QueueDedupeKeyChange,
): QueueDedupeKeyChangedEvent => {
  const id = `queue.dedupe-key/${change.id}`;
  const occurredAt = change.changedAt;
  const entityId = change.queueId;
  const attributes = baseDedupeAttributes(change);
  switch (change.type) {
    case "queue.dedupe-key.added":
      return {
        id,
        type: "queue.dedupe-key.added",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    case "queue.dedupe-key.released":
      return {
        id,
        type: "queue.dedupe-key.released",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    case "queue.dedupe-key.hydrated":
      return {
        id,
        type: "queue.dedupe-key.hydrated",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
  }
};

// ============================================================================
// Store-level query helpers (StoreEventQuery → AnalyticsEvent[])
// ============================================================================

/** @internal */
export const queueEntryStoreQuery = (
  query: QueueEntryQuery | undefined,
): StoreEventQuery => ({
  entityType: QUEUE_RESOURCE_ENTITY_TYPE,
  entityId: query?.queueId,
  types: query?.types ?? queueEntryFactTypes,
  opts:
    query?.opts === undefined
      ? undefined
      : { before: query.opts.before, after: query.opts.after },
});

/** @internal */
export const queueLifecycleStoreQuery = (
  query: QueueLifecycleQuery | undefined,
): StoreEventQuery => ({
  entityType: QUEUE_RESOURCE_ENTITY_TYPE,
  entityId: query?.queueId,
  types: query?.types ?? queueLifecycleChangeTypes,
  opts:
    query?.opts === undefined
      ? undefined
      : { before: query.opts.before, after: query.opts.after },
});

/** @internal */
export const queueDedupeKeyStoreQuery = (
  query: QueueDedupeKeyQuery | undefined,
): StoreEventQuery => ({
  entityType: QUEUE_RESOURCE_ENTITY_TYPE,
  entityId: query?.queueId,
  types: query?.types ?? queueDedupeKeyChangeTypes,
  opts:
    query?.opts === undefined
      ? undefined
      : { before: query.opts.before, after: query.opts.after },
});

// ============================================================================
// Projections (AnalyticsEvent[] → typed fact[]/change[])
// ============================================================================

const matchesEntryQuery =
  (query: QueueEntryQuery | undefined) =>
  (fact: QueueEntryFact): boolean => {
    if (query === undefined) return true;
    if (query.entryId !== undefined && fact.entryId !== query.entryId) {
      return false;
    }
    if (query.key !== undefined && fact.key !== query.key) {
      return false;
    }
    if (query.batchId !== undefined && fact.batchId !== query.batchId) {
      return false;
    }
    if (query.releaseId !== undefined) {
      if (
        fact.type !== "queue.entry.released" ||
        fact.releaseId !== query.releaseId
      ) {
        return false;
      }
    }
    return true;
  };

const matchesDedupeQuery =
  (query: QueueDedupeKeyQuery | undefined) =>
  (change: QueueDedupeKeyChange): boolean => {
    if (query === undefined) return true;
    if (query.key !== undefined && change.key !== query.key) {
      return false;
    }
    return true;
  };

/** @internal */
export const queueEntryFactsFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
  query: QueueEntryQuery | undefined,
): QueueEntryFact[] => {
  const matches = matchesEntryQuery(query);
  const out: QueueEntryFact[] = [];
  for (const event of events) {
    if (!isQueueEntryRecordedEvent(event)) continue;
    if (!matches(event.fact)) continue;
    out.push(event.fact);
  }
  return applyQueryOpts(out, query?.opts, (fact) => fact.occurredAt);
};

/** @internal */
export const queueLifecycleChangesFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
  query: QueueLifecycleQuery | undefined,
): QueueLifecycleChange[] => {
  const out: QueueLifecycleChange[] = [];
  for (const event of events) {
    if (!isQueueLifecycleChangedEvent(event)) continue;
    out.push(event.change);
  }
  return applyQueryOpts(out, query?.opts, (change) => change.changedAt);
};

/** @internal */
export const queueDedupeKeyChangesFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
  query: QueueDedupeKeyQuery | undefined,
): QueueDedupeKeyChange[] => {
  const matches = matchesDedupeQuery(query);
  const out: QueueDedupeKeyChange[] = [];
  for (const event of events) {
    if (!isQueueDedupeKeyChangedEvent(event)) continue;
    if (!matches(event.change)) continue;
    out.push(event.change);
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
 * is. Every static emit wraps with `catchCause + logWarning` so storage
 * failures never propagate to queue work.
 *
 * Read methods (`entries`, `entriesByKey`, `lifecycle`, `dedupeKeys`)
 * are accessed through the resolved instance — `yield*` the facet (or
 * call `Effect.serviceOption(ProcessStoreQueueResource)`) to dispatch.
 *
 * @public
 */
export class ProcessStoreQueueResource extends ProcessStore.Service<
  ProcessStoreQueueResource
>()(
  "@nikscripts/effect-pm/store/queueResource/ProcessStoreQueueResource",
  ProcessStore.record((s) => ({
    recordEntry: (fact: QueueEntryFact) =>
      s.append(makeQueueEntryEvent(fact)),
    recordEntryBatch: (facts: ReadonlyArray<QueueEntryFact>) =>
      s.appendBatch(facts.map(makeQueueEntryEvent)),
    recordLifecycle: (change: QueueLifecycleChange) =>
      s.append(makeQueueLifecycleEvent(change)),
    recordLifecycleBatch: (changes: ReadonlyArray<QueueLifecycleChange>) =>
      s.appendBatch(changes.map(makeQueueLifecycleEvent)),
    recordDedupeKey: (change: QueueDedupeKeyChange) =>
      s.append(makeQueueDedupeKeyEvent(change)),
    recordDedupeKeyBatch: (changes: ReadonlyArray<QueueDedupeKeyChange>) =>
      s.appendBatch(changes.map(makeQueueDedupeKeyEvent)),
  })),
  ProcessStore.read((s) => ({
    entries: (query?: QueueEntryQuery) =>
      s
        .events(queueEntryStoreQuery(query))
        .pipe(
          Effect.map((events) => queueEntryFactsFromEvents(events, query)),
        ),
    entriesByKey: (key: string, query?: Omit<QueueEntryQuery, "key">) => {
      const merged: QueueEntryQuery = { ...query, key };
      return s
        .events(queueEntryStoreQuery(merged))
        .pipe(
          Effect.map((events) => queueEntryFactsFromEvents(events, merged)),
        );
    },
    lifecycle: (query?: QueueLifecycleQuery) =>
      s
        .events(queueLifecycleStoreQuery(query))
        .pipe(
          Effect.map((events) =>
            queueLifecycleChangesFromEvents(events, query),
          ),
        ),
    dedupeKeys: (query?: QueueDedupeKeyQuery) =>
      s
        .events(queueDedupeKeyStoreQuery(query))
        .pipe(
          Effect.map((events) =>
            queueDedupeKeyChangesFromEvents(events, query),
          ),
        ),
  })),
) {}

/**
 * Type accessors merged onto {@link ProcessStoreQueueResource} via
 * declaration merging:
 *
 * - `ProcessStoreQueueResource.Type` — full service shape (record + read).
 * - `ProcessStoreQueueResource.EmitType` — record-section emit shape only.
 *
 * Use these to type custom mocks supplied through `Layer.succeed` /
 * `Effect.provideService`:
 *
 * ```ts
 * const mock: ProcessStoreQueueResource.Type = { ... };
 * ```
 *
 * @public
 */
export declare namespace ProcessStoreQueueResource {
  export type Type = ProcessStore.Service.Type<
    typeof ProcessStoreQueueResource
  >;
  export type EmitType = ProcessStore.Service.EmitType<
    typeof ProcessStoreQueueResource
  >;
}
