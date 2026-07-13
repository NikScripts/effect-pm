/**
 * **ProcessStorage** — combined layer for legacy {@link ProcessLifecycleStore} facet.
 *
 * @remarks
 * {@link LogStore} now uses the {@link Store} bridge directly (`LogStore.layer` /
 * `LogStore.layerMemory`) — not `RuntimeStorage` facets.
 *
 * @module ProcessStorage
 */

import { Layer } from "effect";
import { RuntimeStorage } from "./RuntimeStorage";
import { LogStore } from "./store/log";
import { ProcessLifecycleStore } from "./store/processLifecycle";

const processLifecycleLayer = ProcessLifecycleStore.layerRuntimeStorage;

const facetLayers = Layer.mergeAll(LogStore.layerMemory, processLifecycleLayer);

/**
 * Combined facet layer; requires the caller to provide {@link RuntimeStorage} for lifecycle only.
 *
 * @public
 */
export const layerRuntimeStorage = facetLayers;

/**
 * In-memory combined storage layer for tests, examples, and short-lived dev programs.
 *
 * @public
 */
export const layer = Layer.provide(facetLayers, RuntimeStorage.layer);

/**
 * Facet class aliases under shorter names.
 *
 * @public
 */
export {
  LogStore as Log,
  ProcessLifecycleStore as ProcessLifecycle,
};

/** Union of every service composed by {@link layerRuntimeStorage}. @public */
export type Services = LogStore | ProcessLifecycleStore;
