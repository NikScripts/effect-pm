/**
 * @module examples/forms/resource/fleet-health-glass
 *
 * **“Local /health stays local. Show the fleet.”**
 *
 * Elevated {@link FleetHealth} — leaf `local` for this node, fleet `byNode` / `status` via peers.
 * A down peer is `Unreachable`, not a silent omit.
 *
 * Run: `pnpm run example:fleet-health-glass`
 */

import { Effect, Layer } from "effect";
import * as FleetHealth from "../../../src/FleetHealth";
import * as Resource from "../../../src/Resource";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}
class DropletCentral extends Resource.Node<DropletCentral>("app/DropletCentral") {}

class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Resource.nodes([DropletEast, DropletWest, DropletCentral]),
) {}

const peerOk = {
  local: Effect.succeed(
    FleetHealth.LocalHealth.make({
      status: "ok",
      resources: [{ key: "app/Jobs", kind: "@nikscripts/effect-pm/QueueResource", ready: true }],
    }),
  ),
};

const peerDown = {
  // Defect keeps the leaf error channel `never` while Exit is Failure (Telemetry twin for unreachable).
  local: Effect.die("connect refused"),
};

const eastLayer = FleetHealth.layer(MeshHealth, {
  readiness: Effect.succeed([
    { key: "app/Cache", kind: "@nikscripts/effect-pm/Resource", ready: true },
  ]),
}).pipe(
  Layer.provide(
    Resource.peersFrom(MeshHealth, {
      [DropletWest.key]: peerOk,
      [DropletCentral.key]: peerDown,
    }),
  ),
  Layer.provide(Resource.selfNodeLayer(MeshHealth, DropletEast)),
);

/** Format one `byNode` row — exhausts `NodeReport` (`Reachable` | `Unreachable`). */
const formatRow = (node: string, row: FleetHealth.NodeReport): string => {
  switch (row._tag) {
    case "Reachable":
      return `${node}=${row.status}`;
    case "Unreachable":
      return `${node}=unreachable`;
  }
};

const program = Effect.gen(function* () {
  const glass = yield* MeshHealth;
  // Shapes: LocalHealth · Record<node, NodeReport> · "ok" | "degraded" | "partial"
  const local: FleetHealth.LocalHealth = yield* glass.local;
  const byNode: Readonly<Record<string, FleetHealth.NodeReport>> = yield* glass.byNode;
  const status: FleetHealth.FleetStatus = yield* glass.status;

  const columns = Object.entries(byNode)
    .map(([node, row]) => formatRow(node, row))
    .join(", ");

  yield* Effect.log("");
  yield* Effect.log('=== "Local /health stays local. Show the fleet." ===');
  yield* Effect.log("");
  yield* Effect.log(`  you are:     ${DropletEast.key}`);
  yield* Effect.log(`  local:       ${local.status} (${String(local.resources.length)} resources)`);
  yield* Effect.log(`  columns:     ${columns}`);
  yield* Effect.log(`  fleet:       ${status}`);
  yield* Effect.log("");
  yield* Effect.log("Caption: readiness is local · FleetHealth folds · Exit → Unreachable");
  yield* Effect.log("");
});

runNodeProgramWithLayer(
  program,
  eastLayer,
  "form:fleet-health-glass finished OK",
);
