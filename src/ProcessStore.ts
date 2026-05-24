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
 *    analytics events, runtime projections.
 *
 * Facet services (separate context tags, composable via {@link ProcessStore.layer}):
 * - {@link ProcessStoreGroupLog} — structured `group.log.entry` persistence
 * - {@link ProcessStoreQueueResource} — queue semantic runtime facts
 *
 * **Do not** add parallel “log storage layers”, file-backed `ProcessStore` shortcuts for
 * new code, or domain modules that compose SQLite under their own name. Provide
 * `RuntimeStorage` (or `ProcessStore.layer` / {@link ProcessStore.layerRuntimeStorage}) at
 * app/child launch; use {@link ProcessStoreGroupLog} and {@link ProcessStoreQueueResource}
 * for facet-specific helpers.
 * Capture/relay: `@nikscripts/effect-pm/Logs` (see `src/Logs.ts`).
 *
 * Default in-memory: {@link ProcessStore.layer}. Durable local:
 * `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`.
 * **Legacy only:** {@link ProcessStore.fileLayer} (NDJSON, not `RuntimeStorage`).
 *
 * @module ProcessStore
 */

import { Context, Effect, Layer, Option } from "effect";
import {
  makeFileProcessStore,
  makeInMemoryProcessStore,
  makeProcessStoreFromRuntimeStorage,
} from "./ProcessStoreComposite";
import { ProcessStoreGroupLog } from "./ProcessStoreGroupLog";
import { ProcessStoreQueueResource } from "./ProcessStoreQueueResource";
import {
  runtimeFactStoreQuery,
  runtimeFactsFromEvents,
  runtimeStateChangesFromEvents,
  runtimeStateStoreQuery,
} from "./processStoreSpine";
import type {
  ProcessStoreInterface,
  QueryOpts,
  RuntimeFactQuery,
  RuntimeStateHistoryQuery,
} from "./ProcessStoreTypes";
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
  ProcessStoreInterface,
  ProcessStoreWriteError,
} from "./ProcessStoreTypes";

export {
  ProcessStoreDuplicateRecordError,
  ProcessStoreReadonlyRecordError,
  isGroupLogEntryRecorded,
} from "./ProcessStoreTypes";

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
} from "./ProcessStoreQueueResource";

export {
  ProcessStoreQueueResource,
  ProcessStoreQueueResourceContextError,
} from "./ProcessStoreQueueResource";

export type { ProcessStoreGroupLogApi } from "./ProcessStoreGroupLog";

export {
  ProcessStoreGroupLog,
  makeRecordedEvent,
  storeEventQueryFromLogQuery,
  makeProcessStoreGroupLog,
  makeProcessStoreLogs,
} from "./ProcessStoreGroupLog";

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
  const facetLayers = Layer.mergeAll(
    ProcessStoreGroupLog.layerRuntimeStorage,
    ProcessStoreQueueResource.layerRuntimeStorage,
  );

  /**
   * `Layer` that provides {@link ProcessStore} from injected {@link RuntimeStorage}
   * plus facet services.
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

  /**
   * `Layer` that provides {@link ProcessStore}, {@link ProcessStoreGroupLog}, and
   * {@link ProcessStoreQueueResource} backed by in-memory {@link RuntimeStorage}.
   *
   * @public
   */
  export const layer = Layer.provide(ProcessStore.layerRuntimeStorage, RuntimeStorage.layer);

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
      ProcessStore.runtime.facts({
        ref: { kind: "run-resource", id: resourceId },
        opts,
      }),
  } as const;
}
