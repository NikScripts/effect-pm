/**
 * **ProcessStore** — runtime record storage facade for processes and resources.
 *
 * @module ProcessStore
 */

import type { Effect } from "effect";
import { Context, Effect as Effect_, Layer, Option } from "effect";
import {
  makeFileProcessStore,
  makeInMemoryProcessStore,
  makeProcessStoreFromRuntimeStorage,
} from "./internal/store/composite";
import { ProcessStoreGroupLog } from "./internal/store/groupLog";
import type { ProcessStoreGroupLogApi } from "./internal/store/groupLog";
import { ProcessStoreQueueResource } from "./internal/store/queueResource";
import type { ProcessStoreQueueResourceApi } from "./internal/store/queueResource";
import {
  runtimeFactStoreQuery,
  runtimeFactsFromEvents,
  runtimeStateChangesFromEvents,
  runtimeStateStoreQuery,
} from "./internal/store/spine";
import type {
  AnalyticsEvent,
  ProcessExecutionCompletedEvent,
  ProcessLifecycleChangedEvent,
  ProcessStoreWriteError,
  QueryOpts,
  QueueItemCompletedEvent,
  QueueLifecycleChangedEvent,
  RuntimeFactQuery,
  RuntimeStateHistoryQuery,
  StoreEventQuery,
} from "./ProcessStoreEvent";
import type { RuntimeRecordQuery } from "./Query";
import type { RuntimeRecord } from "./RuntimeStorage";
import type { RuntimeFact, RuntimeRef, RuntimeStateBase, RuntimeStateChange } from "./RuntimeState";
import { RuntimeStorage } from "./RuntimeStorage";

export type {
  QueryOpts,
  StoreEventQuery,
  RuntimeFactQuery,
  RuntimeStateHistoryQuery,
  AnalyticsEventBase,
  ProcessExecutionCompletedEvent,
  ProcessLifecycleTag,
  ProcessLifecycleChangedEvent,
  QueueItemStatus,
  QueueItemCompletedEvent,
  QueueLifecycleTag,
  QueueLifecycleChangedEvent,
  RuntimeFactRecordedEvent,
  RuntimeStateChangedEvent,
  GroupLogEntryRecordedEvent,
  AnalyticsEvent,
  ProcessStoreWriteError,
  JsonValue,
  EffectPmEventRow,
} from "./ProcessStoreEvent";

export {
  ProcessStoreDuplicateRecordError,
  ProcessStoreReadonlyRecordError,
  isGroupLogEntryRecorded,
} from "./ProcessStoreEvent";

export { ProcessStoreQueueResourceContextError } from "./internal/store/queueResource";

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
} from "./internal/store/queueResource";

export type { ProcessStoreGroupLogApi } from "./internal/store/groupLog";

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
  readonly GroupLog: ProcessStoreGroupLogApi;
  readonly QueueResource: ProcessStoreQueueResourceApi;
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
  const facetLayers = Layer.mergeAll(
    ProcessStoreGroupLog.layerRuntimeStorage,
    ProcessStoreQueueResource.layerRuntimeStorage,
  );

  /**
   * `Layer` that provides {@link ProcessStore} from injected {@link RuntimeStorage}
   * plus internal facet services used by {@link QueueResource} and log relay.
   *
   * @public
   */
  export const layerRuntimeStorage: Layer.Layer<
    ProcessStore | ProcessStoreGroupLog | ProcessStoreQueueResource,
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

  /** @public */
  export const runtime = {
    facts: (query?: RuntimeFactQuery): Effect_.Effect<RuntimeFact[], never, ProcessStore> =>
      Effect_.gen(function* () {
        const store = yield* ProcessStore;
        const events = yield* store.events(runtimeFactStoreQuery(query));
        return runtimeFactsFromEvents(events, query);
      }),
    stateHistory: (
      query: RuntimeStateHistoryQuery,
    ): Effect_.Effect<RuntimeStateChange[], never, ProcessStore> =>
      Effect_.gen(function* () {
        const store = yield* ProcessStore;
        const events = yield* store.events(runtimeStateStoreQuery(query));
        return runtimeStateChangesFromEvents(events);
      }),
    latestState: (
      ref: RuntimeRef,
    ): Effect_.Effect<Option.Option<RuntimeStateBase>, never, ProcessStore> =>
      Effect_.map(
        ProcessStore.runtime.stateHistory({ ref, opts: { limit: 1 } }),
        (changes) =>
          changes[0] === undefined
            ? Option.none()
            : Option.some(changes[0].current),
      ),
  } as const;

  /** @public */
  export const runResource = {
    history: (
      resourceId: string,
      opts?: QueryOpts,
    ): Effect_.Effect<RuntimeFact[], never, ProcessStore> =>
      ProcessStore.runtime.facts({
        ref: { kind: "run-resource", id: resourceId },
        opts,
      }),
  } as const;
}
