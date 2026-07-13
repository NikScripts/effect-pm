import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Resource from "../src/Resource";
import * as Telemetry from "../src/Telemetry";
import { Combine, combineQuery } from "../src/MultiNode";

/**
 * Mirrors the homepage Telemetry-elevation prototype: leaf snapshot + fleet folds
 * via peers / selfNode (not client fan-out).
 */
class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}

class FleetMetrics extends Resource.Tag<FleetMetrics>()("app/FleetMetrics", {
  snapshot: Resource.effect(Telemetry.metricsSnapshot),
  fleetInFlight: Resource.effect(Schema.Number).pipe(Resource.fleet),
}) {}

const snap = (value: number): Telemetry.MetricsSnapshot => ({
  ts: 0,
  metrics: [
    {
      _tag: "gauge",
      id: "queue_in_flight",
      labels: {},
      value,
    },
  ],
});

const pickInFlight = (s: Telemetry.MetricsSnapshot): number => {
  const g = s.metrics.find(
    (m): m is Telemetry.GaugeDatum =>
      m._tag === "gauge" && m.id === "queue_in_flight",
  );
  return g?.value ?? 0;
};

describe("telemetry fleet glass prototype", () => {
  it.effect("peers + selfNode fold leaf Telemetry snapshots into fleetInFlight", () => {
    const live = Resource.layer(
      FleetMetrics,
      Effect.gen(function* () {
        const peers = yield* Resource.peers(FleetMetrics);
        const own = 5;
        return {
          snapshot: Effect.succeed(snap(own)),
          fleetInFlight: combineQuery(
            peers,
            (peer) => peer.snapshot.pipe(Effect.map(pickInFlight)),
            Combine.sum,
          ).pipe(Effect.map((others) => others + own)),
        };
      }),
    ).pipe(
      Layer.provide(Resource.selfNodeLayer(FleetMetrics, DropletEast)),
      Layer.provide(
        Resource.peersFrom(FleetMetrics, {
          [DropletWest.key]: {
            snapshot: Effect.succeed(snap(7)),
          },
        }),
      ),
    );

    return Effect.gen(function* () {
      const glass = yield* FleetMetrics;
      expect(yield* glass.fleetInFlight).toBe(12);
      expect((yield* glass.snapshot).metrics[0]).toMatchObject({ value: 5 });
    }).pipe(Effect.provide(live));
  });
});
