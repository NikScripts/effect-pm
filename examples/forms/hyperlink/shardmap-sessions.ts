/**
 * @module examples/forms/hyperlink/shardmap-sessions
 *
 * **“One map. The key finds its droplet.”**
 *
 * {@link ShardMap} routes get/put to the owning node via peers; leaf ops stay local;
 * fleet folds report shard sizes.
 *
 * Run: `pnpm run example:shardmap-sessions`
 *
 * Docs: `docs/examples/hyperlink/shardmap-sessions.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramWithLayer } from "../../shared/demo-harness";

// ---cut---
import { Effect, Layer, Option, Schema } from "effect";
import * as Hyperlink from "../../../src/Hyperlink";
import * as ShardMap from "../../../src/ShardMap";
import * as Node from "../../../src/Node";

class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}
class DropletCentral extends Node.Tag<DropletCentral>()(
  "app/DropletCentral",
) {}

const SessionId = Schema.String;
const Session = Schema.Struct({
  id: SessionId,
  userId: Schema.String,
  seat: Schema.optionalKey(Schema.String),
});

class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(
  Hyperlink.nodes([DropletEast, DropletWest, DropletCentral]),
) {}

/** Sticky partition so the demo always lands seat traffic on East / West visibly. */
const demoPartition: ShardMap.PartitionFn = (key, nodes) => {
  if (key.startsWith("fan-e")) return DropletEast.key;
  if (key.startsWith("fan-w")) return DropletWest.key;
  return ShardMap.consistentHash(key, nodes);
};

const formatByNode = (byNode: Readonly<Record<string, number>>): string =>
  Object.entries(byNode)
    .map(([node, n]) => `${node}=${String(n)}`)
    .join(", ");

const westPeer = {
  get: () => Effect.succeed(Option.none()),
  put: () => Effect.succeed(false),
  delete: () => Effect.succeed(false),
  getLocal: (id: string) =>
    Effect.succeed(
      id === "fan-w-1"
        ? Option.some({
            id: "fan-w-1",
            userId: "u_west",
            seat: "220-B",
          })
        : Option.none(),
    ),
  putLocal: () => Effect.void,
  deleteLocal: () => Effect.succeed(false),
  sizeLocal: Effect.succeed(1),
};

const centralPeer = {
  get: () => Effect.succeed(Option.none()),
  put: () => Effect.succeed(false),
  delete: () => Effect.succeed(false),
  getLocal: () => Effect.succeed(Option.none()),
  putLocal: () => Effect.void,
  deleteLocal: () => Effect.succeed(false),
  sizeLocal: Effect.succeed(0),
};

const eastLayer = ShardMap.layer(Sessions, { partition: demoPartition }).pipe(
  Layer.provide(
    Hyperlink.peersFrom(Sessions, {
      [DropletWest.key]: westPeer,
      [DropletCentral.key]: centralPeer,
    }),
  ),
  Layer.provide(Hyperlink.selfNodeLayer(Sessions, DropletEast)),
);

const program = Effect.gen(function* () {
  const sessions = yield* Sessions;

  yield* sessions.put({
    id: "fan-e-90210",
    userId: "u_nik",
    seat: "124-A",
  });

  const mine = yield* sessions.get("fan-e-90210");
  const west = yield* sessions.get("fan-w-1");
  const miss = yield* sessions.get("fan-missing");
  const byNode = yield* sessions.sizeByNode;
  const fleet = yield* sessions.size;

  yield* Effect.log("");
  yield* Effect.log('=== "One map. The key finds its droplet." ===');
  yield* Effect.log("");
  yield* Effect.log(
    `  put fan-e-90210 → East local: ${Option.isSome(mine) ? mine.value.seat : "miss"}`,
  );
  yield* Effect.log(
    `  get fan-w-1 → West peer:      ${Option.isSome(west) ? west.value.seat : "miss"}`,
  );
  yield* Effect.log(
    `  get missing → miss:           ${Option.isNone(miss) ? "none" : "hit?"}`,
  );
  yield* Effect.log(
    `  sizeByNode:                   ${formatByNode(byNode)}`,
  );
  yield* Effect.log(`  fleet size:                   ${String(fleet)}`);
  yield* Effect.log("");
  yield* Effect.log("Caption: one map · the key finds its droplet");
  yield* Effect.log("");
});
// ---cut-after---

runNodeProgramWithLayer(
  program,
  eastLayer,
  "form:shardmap-sessions finished OK",
);
