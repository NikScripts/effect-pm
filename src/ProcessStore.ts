/**
 * **ProcessStore** — runtime record storage facade for processes and resources.
 *
 * @module ProcessStore
 */

import { Context, Effect, Layer } from "effect";
import {
  makeFileProcessStore,
  makeInMemoryProcessStore,
  makeProcessStoreFromRuntimeStorage,
} from "./internal/store/composite";
import { ProcessStoreLog } from "./store/log";
import type { ProcessStoreLogApi } from "./store/log";
import { ProcessStoreQueueResource } from "./store/queueResource";
import type { ProcessStoreQueueResourceApi } from "./store/queueResource";
import { ProcessStoreProcessExecution } from "./store/processExecution";
import { ProcessStoreProcessLifecycle } from "./store/processLifecycle";
import { ProcessStoreProcessGroup } from "./store/processGroup";
import { ProcessStoreRunResource } from "./store/runResource";
import type {
  AnalyticsEvent,
  ProcessLifecycleChangedEvent,
  ProcessStoreWriteError,
  QueryOpts,
  QueueItemCompletedEvent,
  QueueLifecycleChangedEvent,
  StoreEventQuery,
} from "./ProcessStoreEvent";
import type { RuntimeRecordQuery } from "./Query";
import type { RuntimeRecord } from "./RuntimeStorage";
import { RuntimeStorage } from "./RuntimeStorage";

export type {
  QueryOpts,
  StoreEventQuery,
  AnalyticsEventBase,
  ProcessExecutionCompletedEvent,
  ProcessLifecycleTag,
  ProcessLifecycleChangedEvent,
  QueueItemStatus,
  QueueItemCompletedEvent,
  QueueLifecycleTag,
  QueueLifecycleChangedEvent,
  RunResourceFactRecordedEvent,
  RunResourceStateChangedEvent,
  LogEntryRecordedEvent,
  AnalyticsEvent,
  ProcessStoreWriteError,
  JsonValue,
  EffectPmEventRow,
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
 * Storage port implemented by the in-memory service and durable adapters.
 *
 * @public
 */
export interface ProcessStoreInterface {
  append: (event: AnalyticsEvent) => Effect.Effect<void, ProcessStoreWriteError>;
  appendBatch: (events: ReadonlyArray<AnalyticsEvent>) => Effect.Effect<void, ProcessStoreWriteError>;
  events: (query?: StoreEventQuery) => Effect.Effect<AnalyticsEvent[]>;
  records: (query?: RuntimeRecordQuery) => Effect.Effect<RuntimeRecord[]>;
  readonly Log: ProcessStoreLogApi;
  readonly QueueResource: ProcessStoreQueueResourceApi;
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

/**
 * Context tag for {@link ProcessStoreInterface}.
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
  const processLifecycleLayer = ProcessStoreProcessLifecycle.layerRuntimeStorage;
  const processGroupLayer = Layer.provide(
    ProcessStoreProcessGroup.layerRuntimeStorage,
    processLifecycleLayer,
  );

  const facetLayers = Layer.mergeAll(
    ProcessStoreLog.layerRuntimeStorage,
    ProcessStoreQueueResource.layerRuntimeStorage,
    ProcessStoreRunResource.layerRuntimeStorage,
    ProcessStoreProcessExecution.layerRuntimeStorage,
    processLifecycleLayer,
    processGroupLayer,
  );

  /**
   * `Layer` that provides {@link ProcessStore} from injected {@link RuntimeStorage}
   * plus per-domain facets used by {@link QueueResource}, log relay,
   * `RunResource`, process execution, and lifecycle.
   *
   * @public
   */
  export const layerRuntimeStorage: Layer.Layer<
    | ProcessStore
    | ProcessStoreLog
    | ProcessStoreQueueResource
    | ProcessStoreRunResource
    | ProcessStoreProcessExecution
    | ProcessStoreProcessLifecycle
    | ProcessStoreProcessGroup,
    never,
    RuntimeStorage
  > = Layer.mergeAll(
    facetLayers,
    Layer.provide(Layer.effect(ProcessStore, makeProcessStoreFromRuntimeStorage), facetLayers),
  );

  /** @public */
  export const layer = Layer.provide(ProcessStore.layerRuntimeStorage, RuntimeStorage.layer);

  /** @public */
  export const memory = makeInMemoryProcessStore;

  /**
   * @deprecated Legacy NDJSON only. Prefer {@link ProcessStore.layerRuntimeStorage} with SQLite.
   * @public
   */
  export const file = makeFileProcessStore;

  /**
   * @deprecated See {@link ProcessStore.file}.
   * @public
   */
  export const fileLayer = (filePath: string) =>
    Layer.effect(ProcessStore, makeFileProcessStore(filePath));
}
