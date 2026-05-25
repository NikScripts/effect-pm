/**
 * **ProcessStore** — builder helpers for storage facets.
 *
 * @module ProcessStore
 */

import {
  defineProcessStoreFacet,
  processStoreRead,
  processStoreRecord,
  processStoreWithIdentifier,
  type ProcessStoreFacetEmitShape,
  type ProcessStoreFacetIdentifierShape,
  type ProcessStoreFacetShape,
} from "./internal/store/service";

export type {
  AnalyticsEvent,
  AnalyticsEventBase,
  EffectPmEventRow,
  JsonValue,
  LogEntryRecordedEvent,
  ProcessExecutionCompletedEvent,
  ProcessLifecycleChangedEvent,
  ProcessLifecycleTag,
  ProcessStoreWriteError,
  QueryOpts,
  QueueDedupeKeyChangedEvent,
  QueueEntryRecordedEvent,
  QueueLifecycleChangedEvent,
  RunResourceFactRecordedEvent,
  RunResourceStateChangedEvent,
  StoreEventQuery,
} from "./ProcessStoreEvent";

export {
  isQueueDedupeKeyChangedEvent,
  isQueueEntryRecordedEvent,
  isQueueLifecycleChangedEvent,
  ProcessStoreDuplicateRecordError,
  ProcessStoreReadonlyRecordError,
  isLogEntryRecorded,
} from "./ProcessStoreEvent";

export type {
  ProcessStoreQueueResourceDedupeKeyStatus,
  ProcessStoreQueueResourceEntryStatus,
  ProcessStoreQueueResourceLifecycleTag,
  ProcessStoreQueueResourcePriority,
  QueueDedupeKeyAddedChange,
  QueueDedupeKeyChange,
  QueueDedupeKeyChangeType,
  QueueDedupeKeyHydratedChange,
  QueueDedupeKeyQuery,
  QueueDedupeKeyReleasedChange,
  QueueEntryCompletedFact,
  QueueEntryDeadLetteredFact,
  QueueEntryDroppedFact,
  QueueEntryEnqueuedFact,
  QueueEntryExhaustedFact,
  QueueEntryFact,
  QueueEntryFactType,
  QueueEntryFailedFact,
  QueueEntryQuery,
  QueueEntryReleasedFact,
  QueueEntryRetriedFact,
  QueueEntryStartedFact,
  QueueLifecycleChange,
  QueueLifecycleChangeType,
  QueueLifecycleClearedChange,
  QueueLifecycleDrainedChange,
  QueueLifecyclePausedChange,
  QueueLifecycleQuery,
  QueueLifecycleResumedChange,
  QueueLifecycleShutdownChange,
  QueueLifecycleStartedChange,
} from "./store/queueResource";

export type { ProcessStoreLogApi } from "./store/log";

export type {
  ProcessLifecycleRecordInput,
} from "./store/processLifecycle";

export type {
  ProcessGroupMemberLifecycleInput,
} from "./store/processGroup";

/**
 * Declares a storage facet with one record section, one read section, and one
 * shared runtime-storage-backed implementation.
 *
 * @public
 */
export const ProcessStore = {
  Service: defineProcessStoreFacet,
  record: processStoreRecord,
  read: processStoreRead,
  withIdentifier: processStoreWithIdentifier,
} as const;

/**
 * Type-level helpers merged into the {@link ProcessStore} value via declaration
 * merging. Facet modules use these to expose `<Facet>.Type` and
 * `<Facet>.EmitType`.
 *
 * @public
 */
export declare namespace ProcessStore {
  export namespace Service {
    export type Type<T> = ProcessStoreFacetShape<T>;
    export type EmitType<T> = ProcessStoreFacetEmitShape<T>;
    export type IdentifierType<T> = ProcessStoreFacetIdentifierShape<T>;
  }
}
