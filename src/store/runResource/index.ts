/**
 * RunResource domain namespace — telemetry, archive, and projection co-location.
 *
 * @module store/runResource
 */

export {
  RunResourceStore,
  archiveLegs,
  type RunResourceArchiveLegs,
  type RunResourceFact,
  type RunResourceFactQuery,
  type RunResourceFactType,
  type RunResourceRef,
  type RunResourceRun,
  type RunResourceRunCompletedFact,
  type RunResourceRunCompletedPayload,
  type RunResourceRunFailedFact,
  type RunResourceRunFailedPayload,
  type RunResourceRunStartedFact,
  type RunResourceRunStartedPayload,
  type RunResourceScopedByRunQuery,
  type RunResourceScopedFactQuery,
  type RunResourceScopedStateHistoryQuery,
  type RunResourceState,
  type RunResourceStateChange,
  type RunResourceStateChangeReason,
  type RunResourceStateHistoryQuery,
} from "./archive";

export {
  RunResourceHubTelemetry,
  RUN_COMPLETED_WIRE,
  RUN_FAILED_WIRE,
  RUN_RESOURCE_PROCESS_TYPE,
  RUN_STARTED_WIRE,
  RunCompleted,
  RunFailed,
  RunResourceRunCompletedInputSchema,
  RunResourceRunFailedInputSchema,
  RunResourceRunStartedInputSchema,
  RunResourceStateChangedInputSchema,
  RunResourceStateSchema,
  RunStarted,
  STATE_CHANGED_WIRE,
  STATE_CHANGE_REASONS,
  StateChanged,
  runCompleted,
  runFailed,
  runStarted,
  stateChanged,
  type RunResourceRunCompletedInput,
  type RunResourceRunFailedInput,
  type RunResourceRunStartedInput,
  type RunResourceStateChangedInput,
} from "./telemetry";

export { RunResourceProjectionStub } from "./projection";

import { Layer } from "effect";
import { layerForStore } from "../../ArchiveSink";
import { RuntimeStorage } from "../../RuntimeStorage";
import { archiveLegs, RunResourceStore } from "./archive";

/** Hub + archive persist sink (requires {@link RuntimeStorage} at compose). @public */
export const RunResourceArchiveSinkLayer = layerForStore(
  RunResourceStore,
  archiveLegs,
);

/** Archive queries + hub + optional persist over in-memory storage. @public */
export const runResourcePersistLayer = Layer.provide(
  Layer.mergeAll(RunResourceStore.layerRuntimeStorage, RunResourceArchiveSinkLayer),
  RuntimeStorage.layer,
);
