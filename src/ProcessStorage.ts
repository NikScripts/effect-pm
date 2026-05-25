/**
 * Combined storage layers for all built-in process-store facets.
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
   * Combined facet layer backed by an injected {@link RuntimeStorage}.
   */
  layerRuntimeStorage: facetLayers,

  /**
   * In-memory combined storage layer for tests, examples, and ephemeral dev.
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
