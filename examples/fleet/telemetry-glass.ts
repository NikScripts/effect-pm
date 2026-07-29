/**
 * @module examples/fleet/telemetry-glass
 *
 * **“The pack already instruments itself. Show the fleet.”**
 *
 * Elevated {@link Telemetry} — leaf snapshot for this node, fleet folds via peers.
 * Node ids are Context service keys (`app/Droplet…`).
 *
 * Run: `pnpm run example:telemetry-fleet-glass`
 *
 * Docs: `docs/examples/fleet/telemetry-glass.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramWithLayer } from "../shared/demo-harness";

// ---cut---
import { Effect, Layer, Metric, Stream } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Telemetry from "../../src/Telemetry";
import * as Node from "../../src/Node";

// ── Nodes = Context service keys (machines) ───────────────────────────────────

class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}
class DropletCentral extends Node.Tag<DropletCentral>()("app/DropletCentral") {}

const fleetNodes = [DropletEast, DropletWest, DropletCentral] as const;

class FleetMetrics extends Telemetry.Tag<FleetMetrics>()().pipe(
  Hyperlink.nodes([...fleetNodes]),
) {}

/** Stamp this node's registry with a demo in-flight gauge. */
const stampInFlight = (value: number) =>
  Effect.sync(() =>
    Metric.update(
      Metric.gauge(Telemetry.inFlightMetricId, {
        description: "demo queue in-flight",
      }),
      value,
    ),
  ).pipe(Effect.flatten);

const formatByNode = (byNode: Readonly<Record<string, number>>): string =>
  Object.entries(byNode)
    .map(([node, n]) => `${node}=${String(n)}`)
    .join(", ");

/** Peer leaves — Telemetry PeerService shape (fleet fields excluded). */
const peerLeaf = (inFlight: number) => ({
  snapshot: Effect.succeed({
    ts: 0,
    metrics: [
      {
        _tag: "Gauge" as const,
        id: Telemetry.inFlightMetricId,
        labels: {},
        value: inFlight,
      },
    ],
  } satisfies Telemetry.MetricsSnapshot),
  live: Stream.empty as Stream.Stream<Telemetry.MetricsSnapshot>,
});

const eastLayer = Telemetry.layer(FleetMetrics).pipe(
  Layer.provide(
    Hyperlink.peersFrom(FleetMetrics, {
      [DropletWest.key]: peerLeaf(3),
      [DropletCentral.key]: peerLeaf(4),
    }),
  ),
  Layer.provide(Hyperlink.selfNodeLayer(FleetMetrics, DropletEast)),
);

const program = Effect.gen(function* () {
  yield* stampInFlight(5);
  const glass = yield* FleetMetrics;

  const leaf = yield* glass.snapshot;
  const localInFlight = Telemetry.inFlightOf(leaf);
  const byNode = yield* glass.inFlightByNode;
  const fleet = yield* glass.fleetInFlight;

  yield* Effect.log("");
  yield* Effect.log(
    '=== "The pack already instruments itself. Show the fleet." ===',
  );
  yield* Effect.log("");
  yield* Effect.log("Stadium board — three droplets, one glass");
  yield* Effect.log(`  you are:           ${DropletEast.key}`);
  yield* Effect.log(`  local in-flight:   ${String(localInFlight)}`);
  yield* Effect.log(`  columns:           ${formatByNode(byNode)}`);
  yield* Effect.log(`  fleet total:       ${String(fleet)}`);
  yield* Effect.log("");
  yield* Effect.log(
    "Caption: queues emit · Telemetry shows · peers fold the pack",
  );
  yield* Effect.log("");
});
// ---cut-after---

runNodeProgramWithLayer(
  program,
  eastLayer,
  "form:telemetry-fleet-glass finished OK",
);
