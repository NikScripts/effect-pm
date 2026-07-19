/**
 * @module examples/forms/resource/shardmap-sessions
 *
 * **“One map. The key finds its droplet.”**
 *
 * {@link ShardMap} routes get/put to the owning node via peers; leaf ops stay local;
 * fleet folds report shard sizes.
 *
 * Run: `pnpm run example:shardmap-sessions`
 */

import { Effect, Layer, Option, Schema } from "effect";
import * as Resource from "../../../src/Resource";
import * as ShardMap from "../../../src/ShardMap";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}
class DropletCentral extends Resource.Node<DropletCentral>(
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
  Resource.nodes([DropletEast, DropletWest, DropletCentral]),
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
    Resource.peersFrom(Sessions, {
      [DropletWest.key]: westPeer,
      [DropletCentral.key]: centralPeer,
    }),
  ),
  Layer.provide(Resource.selfNodeLayer(Sessions, DropletEast)),
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

runNodeProgramWithLayer(
  program,
  eastLayer,
  "form:shardmap-sessions finished OK",
);
