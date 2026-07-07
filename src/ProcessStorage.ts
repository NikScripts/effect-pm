/**
 * **ProcessStorage** — combined layer for every built-in
 * {@link ProcessStore} facet.
 *
 * @remarks
 * One-stop shop for apps that want all built-in facets at once. Compose
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
 * Each property is a **facet store class** (`RunResourceStore`, …) under a
 * shorter import path: **`ProcessStorage.RunResource`** === **`RunResourceStore`**.
 * Layers and **`Effect.serviceOption`** work the same from here or
 * **`@nikscripts/effect-pm/store/*`**.
 *
 * @module ProcessStorage
 */

import { Layer } from "effect";
import { RuntimeStorage } from "./RuntimeStorage";
import { LogStore } from "./store/log";
import { ProcessExecutionStore } from "./store/processExecution";
import { ProcessLifecycleStore } from "./store/processLifecycle";
import { RunResourceStore } from "./store/runResource";

const processLifecycleLayer = ProcessLifecycleStore.layerRuntimeStorage;

const facetLayers = Layer.mergeAll(
  LogStore.layerRuntimeStorage,
  RunResourceStore.layerRuntimeStorage,
  ProcessExecutionStore.layerRuntimeStorage,
  processLifecycleLayer,
);

// Combined storage layers plus facet class aliases. The module is the namespace
// (`import * as ProcessStorage`): the layers are flat exports and the facet aliases
// re-export the public `*Store` facet tags under shorter names.

/**
 * Combined facet layer; requires the caller to provide {@link RuntimeStorage}. Use
 * this for durable backends.
 *
 * @public
 */
export const layerRuntimeStorage = facetLayers;

/**
 * In-memory combined storage layer for tests, examples, and short-lived dev programs.
 * Wraps {@link layerRuntimeStorage} with {@link RuntimeStorage.layer}.
 *
 * @public
 */
export const layer = Layer.provide(facetLayers, RuntimeStorage.layer);

/**
 * Facet class aliases (same tags as the public `*Store` facet services) under shorter
 * names: `ProcessStorage.RunResource` === {@link RunResourceStore}, etc.
 *
 * @public
 */
export {
  LogStore as Log,
  RunResourceStore as RunResource,
  ProcessExecutionStore as ProcessExecution,
  ProcessLifecycleStore as ProcessLifecycle,
};

/** Union of every service composed by {@link layerRuntimeStorage}. @public */
export type Services =
  | LogStore
  | RunResourceStore
  | ProcessExecutionStore
  | ProcessLifecycleStore;
