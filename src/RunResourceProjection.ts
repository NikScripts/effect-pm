/**
 * RunResource live projection — in-memory gate snapshots from hub events.
 *
 * @remarks
 * Updated on {@link StateChanged} via {@link ProjectionSink}. Cold start uses
 * {@link RunResourceProjection.layerHydrateFromArchive} (one-shot archive read),
 * not store polling on the emit hot path.
 *
 * @module RunResourceProjection
 */

import { Context, Effect, HashMap, Layer, Option, Ref } from "effect";
import { ProjectionSink } from "./sink/ProjectionSink";
import { TelemetryHubState } from "./internal/telemetryHub/state";
import { TelemetryHub } from "./TelemetryHub";
import type { RuntimeStorageOperationalError } from "./RuntimeStorage";
import {
  RunResourceStore,
  type RunResourceState,
} from "./store/RunResourceStore";
import {
  StateChanged,
  type RunResourceStateChangedInput,
} from "./store/RunResourceTelemetry";

/** Live projection API for RunResource gate snapshots. @public */
export interface RunResourceProjectionService {
  readonly latestState: (
    resourceId: string,
  ) => Effect.Effect<Option.Option<RunResourceState>>;
  readonly applyStateChanged: (
    input: RunResourceStateChangedInput,
  ) => Effect.Effect<void>;
  readonly seedState: (
    resourceId: string,
    state: RunResourceState,
  ) => Effect.Effect<void>;
}

/** @public */
export class RunResourceProjection extends Context.Service<
  RunResourceProjection,
  RunResourceProjectionService
>()("@nikscripts/effect-pm/RunResourceProjection") {}

const projectionLegs = (
  projection: RunResourceProjectionService,
): ReadonlyArray<ProjectionSink.Leg> => [
  ProjectionSink.leg(StateChanged, (input) => projection.applyStateChanged(input)),
];

const makeRunResourceProjection = Effect.gen(function* () {
  const statesRef = yield* Ref.make(
    HashMap.empty<string, RunResourceState>(),
  );

  const latestState = (
    resourceId: string,
  ): Effect.Effect<Option.Option<RunResourceState>> =>
    Ref.get(statesRef).pipe(
      Effect.map((states) => HashMap.get(states, resourceId)),
    );

  const applyStateChanged = (
    input: RunResourceStateChangedInput,
  ): Effect.Effect<void> =>
    Ref.update(statesRef, (states) =>
      HashMap.set(states, input.current.resourceId, input.current),
    );

  const seedState = (
    resourceId: string,
    state: RunResourceState,
  ): Effect.Effect<void> =>
    Ref.update(statesRef, (states) => HashMap.set(states, resourceId, state));

  return RunResourceProjection.of({
    latestState,
    applyStateChanged,
    seedState,
  });
});

const projectionServiceLayer = Layer.effect(
  RunResourceProjection,
  makeRunResourceProjection,
);

const withProjectionSinkLayer: Layer.Layer<
  import("./TelemetryHub").TelemetryHub,
  never,
  RunResourceProjection
> = Layer.provideMerge(
  Layer.effectDiscard(
    Effect.gen(function* () {
      const projection = yield* RunResourceProjection;
      const registered = ProjectionSink.forLegs(
        "RunResourceProjection",
        projectionLegs(projection),
      );
      const { sinksRef } = yield* TelemetryHubState;
      yield* Ref.update(sinksRef, (sinks) => [...sinks, registered]);
    }),
  ),
  TelemetryHub.layer,
);

const liveLayerInternal = Layer.provideMerge(
  withProjectionSinkLayer,
  projectionServiceLayer,
);

const hydrateFromArchiveLayer = (
  resourceIds: ReadonlyArray<string>,
): Layer.Layer<
  never,
  RuntimeStorageOperationalError,
  RunResourceStore | RunResourceProjection
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const store = yield* RunResourceStore;
      const projection = yield* RunResourceProjection;
      yield* Effect.forEach(
        resourceIds,
        (resourceId) =>
          Effect.gen(function* () {
            const latest = yield* store.latestState({ resourceId });
            if (Option.isSome(latest)) {
              yield* projection.seedState(resourceId, latest.value);
            }
          }),
        { concurrency: "unbounded", discard: true },
      );
    }),
  );

/** @public */
export namespace RunResourceProjection {
  export type Service = RunResourceProjectionService;

  /** In-memory projection service only. */
  export const layer = projectionServiceLayer;

  /** Hub + projection reducers registered. */
  export const layerWithProjectionSink = withProjectionSinkLayer;

  /** Projection service + hub sink (default live compose). */
  export const layerLive = liveLayerInternal;

  /** One-shot cold start from archive `latestState` queries. */
  export const layerHydrateFromArchive = hydrateFromArchiveLayer;
}

/** @deprecated Use {@link RunResourceProjection.layer}. */
export const layer = projectionServiceLayer;

/** @deprecated Use {@link RunResourceProjection.layerWithProjectionSink}. */
export const projectionSinkLayer = withProjectionSinkLayer;

/** @deprecated Use {@link RunResourceProjection.layerLive}. */
export const liveLayer = liveLayerInternal;

/** @deprecated Use {@link RunResourceProjection.layerHydrateFromArchive}. */
export const layerHydrateFromArchive = hydrateFromArchiveLayer;
