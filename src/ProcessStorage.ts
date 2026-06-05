/**
 * **ProcessStorage** — combined layer for every built-in
 * {@link ProcessStore} facet.
 *
 * @remarks
 * One-stop shop for apps that want all six facets at once. Compose
 * either:
 *
 * - {@link ProcessStorage.layerRuntimeStorage} — facets only; expects
 *   the app to provide a {@link RuntimeStorage} adapter (e.g.
 *   `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`).
 * - {@link ProcessStorage.layer} — facets + the in-memory
 *   {@link RuntimeStorage} adapter; suitable for tests, examples, and
 *   short-lived dev programs.
 *
 * @example Durable composition
 * ```ts
 * import { ProcessStorage } from "@nikscripts/effect-pm";
 * import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";
 *
 * const program = Effect.scoped(...);
 *
 * Effect.runPromise(program.pipe(
 *   Effect.provide(Layer.provide(
 *     ProcessStorage.layerRuntimeStorage,
 *     layerProcessStore({ filename: ".effect-pm/data.sqlite" }),
 *   )),
 * ));
 * ```
 *
 * @example In-memory composition (tests / dev)
 * ```ts
 * Effect.provide(program, ProcessStorage.layer);
 * ```
 *
 * ### Facet classes (aliases)
 *
 * Each property is a **facet store class** (`QueueResourceStore`, …) under a
 * shorter import path: **`ProcessStorage.QueueResource`** === **`QueueResourceStore`**.
 * Layers and **`Effect.serviceOption`** work the same from here or
 * **`@nikscripts/effect-pm/store/*`**.
 *
 * @module ProcessStorage
 */

import { Layer } from "effect";
import { ArchiveSink } from "./sink/ArchiveSink";
import { RuntimeStorage } from "./RuntimeStorage";
import { LogStore } from "./store/log";
import { ProcessExecutionStore } from "./store/processExecution";
import { ProcessGroupStore } from "./store/processGroup";
import { ProcessLifecycleStore } from "./store/processLifecycle";
import { QueueResourceStore } from "./store/queueResource";
import { archiveLegs } from "./store/RunResourceStore";
import { RunResourceStore } from "./store/RunResource";
import type { ProcessStoreRegistry } from "./internal/store/service";
import type { AnyFacetClass } from "./internal/store/service";
import { toProcessStoreQueryClient, type StoreQueryClient } from "./storeTransport";

const processLifecycleLayer = ProcessLifecycleStore.layerRuntimeStorage;

const processGroupLayer = Layer.provide(
  ProcessGroupStore.layerRuntimeStorage,
  processLifecycleLayer,
);

const facetLayers = Layer.mergeAll(
  LogStore.layerRuntimeStorage,
  QueueResourceStore.layerRuntimeStorage,
  RunResourceStore.layerRuntimeStorage,
  ProcessExecutionStore.layerRuntimeStorage,
  processLifecycleLayer,
  processGroupLayer,
);

const runResourceArchiveSinkLayer = ArchiveSink.layerForStore(RunResourceStore, archiveLegs);

/**
 * All built-in facet layers plus RunResource {@link ArchiveSink} over
 * in-memory {@link RuntimeStorage}.
 *
 * @public
 */
export const processStorageWithRunResourceArchiveLayer = Layer.provide(
  Layer.mergeAll(facetLayers, runResourceArchiveSinkLayer),
  RuntimeStorage.layer,
);

/**
 * Combined storage **layers** plus **facet class aliases** (same tags as the
 * public `*Store` facet services).
 *
 * @public
 */
export const ProcessStorage = {
  /**
   * Combined facet layer; requires the caller to provide
   * {@link RuntimeStorage}. Use this for durable backends.
   */
  layerRuntimeStorage: facetLayers,

  /**
   * In-memory combined storage layer for tests, examples, and
   * short-lived dev programs. Wraps {@link layerRuntimeStorage} with
   * {@link RuntimeStorage.layer}.
   */
  layer: Layer.provide(
    facetLayers,
    RuntimeStorage.layer,
  ),

  /** Alias for {@link LogStore} (`log.entry` rows, durable log reads). */
  Log: LogStore,

  /**
   * Storage facet for **`QueueResource`** analytics — alias for
   * {@link QueueResourceStore}. Not the queue worker service.
   */
  QueueResource: QueueResourceStore,

  /** Alias for {@link RunResourceStore}. */
  RunResource: RunResourceStore,

  /** Alias for {@link ProcessExecutionStore}. */
  ProcessExecution: ProcessExecutionStore,

  /** Alias for {@link ProcessLifecycleStore}. */
  ProcessLifecycle: ProcessLifecycleStore,

  /** Alias for {@link ProcessGroupStore}. */
  ProcessGroup: ProcessGroupStore,

  /**
   * Provide all six facet `Query` sub-tags via a single store transport
   * client. One transport, all facets — each `Facet.layerRemote(client)`
   * call shares the same underlying connection.
   *
   * For apps that only use a subset of facets, call each facet's
   * `layerRemote` individually instead.
   */
  layerRemote: <R extends ProcessStoreRegistry<ReadonlyArray<AnyFacetClass>>>(
    client: StoreQueryClient<R>,
  ) => {
    const pc = toProcessStoreQueryClient(client);
    return Layer.mergeAll(
      LogStore.layerRemote(pc),
      QueueResourceStore.layerRemote(pc),
      RunResourceStore.layerRemote(pc),
      ProcessExecutionStore.layerRemote(pc),
      ProcessLifecycleStore.layerRemote(pc),
      ProcessGroupStore.layerRemote(pc),
    );
  },
} as const;

export declare namespace ProcessStorage {
  export type Services =
    | LogStore
    | QueueResourceStore
    | RunResourceStore
    | ProcessExecutionStore
    | ProcessLifecycleStore
    | ProcessGroupStore;
}
