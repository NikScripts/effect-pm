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
 * @module ProcessStorage
 */

import { Layer } from "effect";
import { RuntimeStorage } from "./RuntimeStorage";
import { ProcessStoreLog } from "./store/log";
import { ProcessStoreProcessExecution } from "./store/processExecution";
import { ProcessStoreProcessGroup } from "./store/processGroup";
import { ProcessStoreProcessLifecycle } from "./store/processLifecycle";
import { ProcessStoreQueueResource } from "./store/queueResource";
import { ProcessStoreRunResource } from "./store/runResource";

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
 * Combined storage layer namespace.
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
} as const;

export declare namespace ProcessStorage {
  export type Services =
    | ProcessStoreLog
    | ProcessStoreQueueResource
    | ProcessStoreRunResource
    | ProcessStoreProcessExecution
    | ProcessStoreProcessLifecycle
    | ProcessStoreProcessGroup;
}
