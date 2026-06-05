/**
 * RunResource storage facet — telemetry, archive, and projection exports.
 *
 * @module store/RunResource
 */

export {
  RunResourceStore,
  archiveLegs,
  type RunResourceArchiveLegs,
  type RunResourceByRunQuery,
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
} from "./RunResourceStore";

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
} from "./RunResourceTelemetry";

export {
  RunResourceProjection,
  type RunResourceProjectionService,
} from "../RunResourceProjection";

import { Layer } from "effect";
import { ArchiveSink } from "../sink/ArchiveSink";
import { RuntimeStorage } from "../RuntimeStorage";
import { archiveLegs, RunResourceStore } from "./RunResourceStore";
import { RunResourceProjection } from "../RunResourceProjection";

/** RunResource hub compose helpers. @public */
export namespace RunResourceCompose {
  /** Hub + archive persist sink (requires {@link RuntimeStorage} at compose). */
  export const layerArchiveSink = ArchiveSink.layerForStore(
    RunResourceStore,
    archiveLegs,
  );

  /** Archive queries + hub + optional persist over in-memory storage. */
  export const layerPersist = Layer.provide(
    Layer.mergeAll(RunResourceStore.layerRuntimeStorage, layerArchiveSink),
    RuntimeStorage.layer,
  );

  /** Projection service + hub sink (default live compose). */
  export const layerProjectionLive = RunResourceProjection.layerLive;
}

/** @deprecated Use {@link RunResourceCompose.layerArchiveSink}. */
export const RunResourceArchiveSinkLayer = RunResourceCompose.layerArchiveSink;

/** @deprecated Use {@link RunResourceCompose.layerPersist}. */
export const runResourcePersistLayer = RunResourceCompose.layerPersist;

/** @deprecated Use {@link RunResourceProjection.layer}. */
export const RunResourceProjectionLayer = RunResourceProjection.layer;

/** @deprecated Use {@link RunResourceProjection.layerHydrateFromArchive}. */
export const RunResourceProjectionHydrateLayer =
  RunResourceProjection.layerHydrateFromArchive;

/** @deprecated Use {@link RunResourceProjection.layerLive}. */
export const RunResourceProjectionLiveLayer = RunResourceProjection.layerLive;

/** @deprecated Use {@link RunResourceProjection.layerWithProjectionSink}. */
export const RunResourceProjectionSinkLayer =
  RunResourceProjection.layerWithProjectionSink;
