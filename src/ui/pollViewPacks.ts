/**
 * Polled fleet observe packs — FleetHealth / Telemetry / ShardMap.
 * @internal
 */
import { Effect } from "effect";
import * as Observe from "../Observe";
import type { FleetStatus, NodeReport } from "../FleetHealth";
import type { MetricDatum } from "../Telemetry";

type FleetHealth = {
  readonly byNode: Effect.Effect<Record<string, NodeReport>>;
  readonly status: Effect.Effect<FleetStatus>;
};

type Telemetry = {
  readonly snapshot: Effect.Effect<{ readonly metrics: ReadonlyArray<MetricDatum> }>;
  readonly inFlightByNode: Effect.Effect<Record<string, number>>;
  readonly fleetInFlight: Effect.Effect<number>;
};

type ShardMap = {
  readonly size: Effect.Effect<number>;
  readonly sizeByNode: Effect.Effect<Readonly<Record<string, number>>>;
  readonly sizeLocal: Effect.Effect<number>;
};

const fleetPoll = Observe.poll(
  (h: FleetHealth) => Effect.all({ byNode: h.byNode, status: h.status }),
  "2 seconds",
);

/** @public */
export const fleetHealthPack = Observe.named(
  "fleetHealth",
  Observe.struct({
    byNode: Observe.map(fleetPoll, (a) => a.byNode),
    status: Observe.map(fleetPoll, (a) => a.status),
  }),
);

const telemetryPoll = Observe.poll(
  (t: Telemetry) =>
    Effect.all({
      snapshot: t.snapshot,
      inFlightByNode: t.inFlightByNode,
      fleetInFlight: t.fleetInFlight,
    }),
  "2 seconds",
);

/** @public */
export const telemetryPack = Observe.named(
  "telemetry",
  Observe.struct({
    metricCount: Observe.map(telemetryPoll, (a) => a.snapshot.metrics.length),
    inFlightByNode: Observe.map(telemetryPoll, (a) => a.inFlightByNode),
    fleetInFlight: Observe.map(telemetryPoll, (a) => a.fleetInFlight),
    metrics: Observe.map(telemetryPoll, (a) => a.snapshot.metrics),
  }),
);

const shardPoll = Observe.poll(
  (m: ShardMap) =>
    Effect.all({ size: m.size, sizeByNode: m.sizeByNode, sizeLocal: m.sizeLocal }),
  "2 seconds",
);

/** @public */
export const shardMapPack = Observe.named(
  "shardMap",
  Observe.struct({
    size: Observe.map(shardPoll, (a) => a.size),
    sizeByNode: Observe.map(shardPoll, (a) => ({ ...a.sizeByNode })),
    sizeLocal: Observe.map(shardPoll, (a) => a.sizeLocal),
  }),
);
