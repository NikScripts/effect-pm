/**
 * @module examples/forms/resource/telemetry-fleet-glass
 *
 * **Prototype — elevated Telemetry as mesh glass** (not production Telemetry.Tag yet).
 *
 * Shows the homepage shape: one factory-shaped tag, leaf registry snapshot +
 * `fleet`-marked folds via `Resource.peers` / `selfNode` / MultiNode — Node ids are
 * Context **service keys** (`app/Droplet…`), never app resource nicknames.
 *
 * Today's `Telemetry.Tag` is leaf-only (`snapshot` / `live`). Elevation would bake this
 * mesh recipe into the factory so apps stop hand-rolling WorkerPool-style folds for metrics.
 *
 * Run: `pnpm run example:telemetry-fleet-glass`
 */

import { Effect, Layer, Schema } from "effect";
import * as Resource from "../../../src/Resource";
import * as Telemetry from "../../../src/Telemetry";
import { Combine, combineQuery } from "../../../src/MultiNode";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

// ── Nodes = Context service keys (machines), same family as resource keys ─────

class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}
class DropletCentral extends Resource.Node<DropletCentral>("app/DropletCentral") {}

const fleetNodes = [DropletEast, DropletWest, DropletCentral] as const;

// ── Prototype contract: leaf Telemetry wire + fleet folds (elevation target) ─

/**
 * Prototype of what an elevated `Telemetry.Tag` would expose when meshed:
 * - `snapshot` — this node's Metric registry (Telemetry's existing leaf)
 * - `inFlightByNode` / `fleetInFlight` — peers + self, MultiNode folds
 */
class FleetMetrics extends Resource.Tag<FleetMetrics>()("app/FleetMetrics", {
  snapshot: Resource.effect(Telemetry.metricsSnapshot).annotate({
    description: "This node's Effect Metric registry (Telemetry leaf).",
  }),
  inFlightByNode: Resource.effect(
    Schema.Record(Schema.String, Schema.Number),
  ).pipe(Resource.fleet).annotate({
    description: "queue_in_flight gauge per node — peers + self.",
  }),
  fleetInFlight: Resource.effect(Schema.Number).pipe(Resource.fleet).annotate({
    description: "Sum of queue_in_flight across the mesh.",
  }),
}).pipe(Resource.distributed([...fleetNodes])) {}

const IN_FLIGHT = "queue_in_flight";

/** Pick a gauge from a Telemetry-shaped snapshot (homepage panel helper). */
const gaugeValue = (
  snap: Telemetry.MetricsSnapshot,
  id: string,
): number => {
  const hit = snap.metrics.find(
    (m): m is Telemetry.GaugeDatum => m._tag === "gauge" && m.id === id,
  );
  return hit?.value ?? 0;
};

/** One droplet's leaf registry — stamped gauge for the demo fold. */
const leafSnapshot = (nodeKey: string, inFlight: number) =>
  Effect.succeed({
    ts: 0,
    metrics: [
      {
        _tag: "gauge" as const,
        id: IN_FLIGHT,
        labels: { node: nodeKey },
        value: inFlight,
      },
    ],
  } satisfies Telemetry.MetricsSnapshot);

const fleetMetricsImpl = (ownInFlight: number) =>
  Effect.gen(function* () {
    const peers = yield* Resource.peers(FleetMetrics);
    const self = yield* Resource.selfNode(FleetMetrics);
    return {
      snapshot: leafSnapshot(self, ownInFlight),
      inFlightByNode: Effect.gen(function* () {
        const byNode = yield* combineQuery(
          peers,
          (peer) =>
            peer.snapshot.pipe(Effect.map((s) => gaugeValue(s, IN_FLIGHT))),
          Combine.byNode,
        );
        return { ...byNode, [self]: ownInFlight };
      }),
      fleetInFlight: combineQuery(
        peers,
        (peer) =>
          peer.snapshot.pipe(Effect.map((s) => gaugeValue(s, IN_FLIGHT))),
        Combine.sum,
      ).pipe(Effect.map((others) => others + ownInFlight)),
    };
  });

// Single-process mesh — same discharge order as multi-host-selfhost tests
const eastLayer = Resource.layer(FleetMetrics, fleetMetricsImpl(5)).pipe(
  Layer.provide(
    Resource.peersFrom(FleetMetrics, {
      [DropletWest.key]: {
        snapshot: leafSnapshot(DropletWest.key, 3),
      },
      [DropletCentral.key]: {
        snapshot: leafSnapshot(DropletCentral.key, 4),
      },
    }),
  ),
  Layer.provide(Resource.selfNodeLayer(FleetMetrics, DropletEast)),
);

const formatByNode = (byNode: Readonly<Record<string, number>>): string =>
  Object.entries(byNode)
    .map(([node, n]) => `${node}=${String(n)}`)
    .join(", ");

const program = Effect.gen(function* () {
  const glass = yield* FleetMetrics;
  const leaf = yield* glass.snapshot;
  const byNode = yield* glass.inFlightByNode;
  const fleet = yield* glass.fleetInFlight;

  yield* Effect.log("");
  yield* Effect.log("=== Telemetry fleet glass (prototype) ===");
  yield* Effect.log(`leaf metrics: ${String(leaf.metrics.length)} row(s)`);
  yield* Effect.log(`inFlightByNode: ${formatByNode(byNode)}`);
  yield* Effect.log(`fleetInFlight: ${String(fleet)}  (expect 5+3+4 = 12)`);
  yield* Effect.log("");
});

runNodeProgramWithLayer(
  program,
  eastLayer,
  "form:telemetry-fleet-glass finished OK",
);
