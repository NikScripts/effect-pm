/**
 * @module examples/fleet/health-glass
 *
 * **“Local /health stays local. Show the fleet.”**
 *
 * Elevated {@link FleetHealth} — leaf `local` for this node, fleet `byNode` / `status` via peers.
 * A down peer is `Unreachable`, not a silent omit.
 *
 * Run: `pnpm run example:fleet-health-glass`
 *
 * Docs: `docs/examples/fleet/health-glass.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramWithLayer } from "../../shared/demo-harness";

// ---cut---
import { Effect, Layer } from "effect";
import * as FleetHealth from "../../src/FleetHealth";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";

class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}
class DropletCentral extends Node.Tag<DropletCentral>()("app/DropletCentral") {}

class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Hyperlink.nodes([DropletEast, DropletWest, DropletCentral]),
) {}

const peerOk = {
  local: Effect.succeed(
    FleetHealth.LocalHealth.make({
      status: "ok",
      services: [{ key: "app/Jobs", kind: "hyperlink-ts/WorkPool", ready: true }],
    }),
  ),
};

const peerDown = {
  // Defect keeps the leaf error channel `never` while Exit is Failure (Telemetry twin for unreachable).
  local: Effect.die("connect refused"),
};

const eastLayer = FleetHealth.layer(MeshHealth, {
  readiness: Effect.succeed([
    { key: "app/Cache", kind: "hyperlink-ts/Hyperlink", ready: true },
  ]),
}).pipe(
  Layer.provide(
    Hyperlink.peersFrom(MeshHealth, {
      [DropletWest.key]: peerOk,
      [DropletCentral.key]: peerDown,
    }),
  ),
  Layer.provide(Hyperlink.selfNodeLayer(MeshHealth, DropletEast)),
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
  yield* Effect.log(`  local:       ${local.status} (${String(local.services.length)} resources)`);
  yield* Effect.log(`  columns:     ${columns}`);
  yield* Effect.log(`  fleet:       ${status}`);
  yield* Effect.log("");
  yield* Effect.log("Caption: readiness is local · FleetHealth folds · Exit → Unreachable");
  yield* Effect.log("");
});
// ---cut-after---

runNodeProgramWithLayer(
  program,
  eastLayer,
  "form:fleet-health-glass finished OK",
);
