/**
 * **ProcessStore** — builder helpers for storage facets.
 *
 * @module ProcessStore
 */

import {
  defineProcessStoreFacet,
  processStoreRead,
  processStoreRecord,
  type ProcessStoreFacetEmitShape,
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
  QueueItemCompletedEvent,
  QueueItemStatus,
  QueueLifecycleChangedEvent,
  QueueLifecycleTag,
  RunResourceFactRecordedEvent,
  RunResourceStateChangedEvent,
  StoreEventQuery,
} from "./ProcessStoreEvent";

export {
  ProcessStoreDuplicateRecordError,
  ProcessStoreReadonlyRecordError,
  isLogEntryRecorded,
} from "./ProcessStoreEvent";

export { ProcessStoreQueueResourceContextError } from "./store/queueResource";

export type {
  ProcessStoreQueueResourceApi,
  ProcessStoreQueueResourceContext,
  ProcessStoreQueueResourceDedupeKeyInput,
  ProcessStoreQueueResourceDedupeKeyStatus,
  ProcessStoreQueueResourceEntryInput,
  ProcessStoreQueueResourceEntryStatus,
  ProcessStoreQueueResourceLifecycleInput,
  ProcessStoreQueueResourceLifecycleTag,
  ProcessStoreQueueResourcePriority,
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
  }
}
