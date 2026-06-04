/**
 * **ProjectionSink** — optional {@link TelemetryHub} in-memory projection leg.
 *
 * @module sink/ProjectionSink
 */

import { Effect, Layer, Ref } from "effect";
import * as Schema from "effect/Schema";
import { TelemetryHubState } from "../internal/telemetryHub/state";
import {
  sink,
  TelemetryHub,
  type TelemetryEventDefinition,
  type TelemetryHubEmitted,
  type TelemetrySink,
} from "../TelemetryHub";

/** Projection reducer for one hub event definition. @public */
export interface ProjectionSinkLeg {
  readonly event: TelemetryEventDefinition<any, any>;
  readonly apply: (payload: unknown) => Effect.Effect<void>;
}

const makeForLegs = (
  tag: string,
  legs: ReadonlyArray<ProjectionSinkLeg>,
): TelemetrySink => {
  const byWire = new Map(legs.map((entry) => [entry.event.wire, entry] as const));
  return sink({
    tag,
    wires: legs.map((entry) => entry.event.wire),
    policy: "bestEffort",
    handle: (emitted: TelemetryHubEmitted) => {
      const entry = byWire.get(emitted.wire);
      return entry === undefined ? Effect.void : entry.apply(emitted.payload);
    },
  });
};

const makeLayerForLegs = (
  tag: string,
  legs: ReadonlyArray<ProjectionSinkLeg>,
): Layer.Layer<import("../TelemetryHub").TelemetryHub> =>
  Layer.provideMerge(
    Layer.effectDiscard(
      Effect.gen(function* () {
        const registered = makeForLegs(tag, legs);
        const { sinksRef } = yield* TelemetryHubState;
        yield* Ref.update(sinksRef, (sinks) => [...sinks, registered]);
      }),
    ),
    TelemetryHub.layer,
  );

/** @public */
export namespace ProjectionSink {
  export type Leg = ProjectionSinkLeg;

  export const leg = <A, I>(
    event: TelemetryEventDefinition<A, I>,
    apply: (payload: A) => Effect.Effect<void>,
  ): ProjectionSinkLeg => ({
    event,
    apply: (payload) =>
      Schema.decodeUnknownEffect(event.schema)(payload).pipe(
        Effect.flatMap(apply),
        Effect.orDie,
      ),
  });

  export const forLegs = makeForLegs;
  export const layerForLegs = makeLayerForLegs;
}
