{#shardmap title="ShardMap" appliesTo=all}
# ShardMap

A partitioned key/value Resource factory. Declare `key` / `value` schemas, distribute
across nodes, and every routed `get` / `put` / `delete` forwards to the owning shard via
`Resource.peers`. Leaf `*Local` ops stay on this node. Fleet folds report shard sizes.
An unreachable owner degrades to a miss — never a silent write on the wrong shard.

This is the toolkit noun for the intro's "Working with peers" Sessions beat.

## Declare the map

Schemas live on the Tag. `keyOf` extracts the partition key from a value (routed `put`).
Partition strategy is a runtime option on `layer` / `serve` (default: `consistentHash`).

{.twoslash}
``` ts
import * as ShardMap from "@nikscripts/effect-pm/ShardMap"
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Schema } from "effect"

class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}
class DropletCentral extends Resource.Node<DropletCentral>("app/DropletCentral") {}

const SessionId = Schema.String
const Session = Schema.Struct({
  id: SessionId,
  userId: Schema.String,
  seat: Schema.optionalKey(Schema.String),
})

class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(
  Resource.distributed([DropletEast, DropletWest, DropletCentral]),
) {}
```

## Serve on a node

`.pipe(Layer.provide(Resource.peersLayer(...)))` is the mesh discharge — same recipe as
Telemetry / any fleet-aware Resource.

{.twoslash}
``` ts
import * as ShardMap from "@nikscripts/effect-pm/ShardMap"
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Layer, Schema } from "effect"
class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String })
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(Resource.distributed([DropletEast, DropletWest])) {}
// ---cut---
const onEast = ShardMap.serve(Sessions, {
  partition: ShardMap.consistentHash, // default
}).pipe(Layer.provide(Resource.peersLayer(Sessions, DropletEast)))
```

## Routed ops

From any node in the pack, callers use the same handle — routing stays inside the Resource.

{.twoslash}
``` ts
import * as ShardMap from "@nikscripts/effect-pm/ShardMap"
import { Effect, Option, Schema } from "effect"
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String, seat: Schema.optionalKey(Schema.String) })
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}) {}
const program = Effect.gen(function* () {
  const sessions = yield* Sessions
  // ---cut---
  const wrote = yield* sessions.put({
    id: "fan-90210",
    userId: "u_nik",
    seat: "124-A",
  })
  // true when the owning node accepted the write; false if that owner is unreachable

  const seat = yield* sessions.get("fan-90210")
  // Option<Session> — from whoever owns the key; none on miss

  const dropped = yield* sessions.delete("fan-90210")
  // ---cut-after---
})
```

## Leaves and fleet folds

- **Routed** — `get` / `put` / `delete` — ownership forward (or local when you own the key)
- **Leaf** — `getLocal` / `putLocal` / `deleteLocal` / `sizeLocal` — this node's shard only;
  peers fold these
- **Fleet** — `sizeByNode` / `size` — per-node counts and their sum

{.twoslash}
``` ts
import * as ShardMap from "@nikscripts/effect-pm/ShardMap"
import { Effect, Schema } from "effect"
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String })
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}) {}
const program = Effect.gen(function* () {
  const sessions = yield* Sessions
  // ---cut---
  const shards = yield* sessions.sizeByNode
  // { "app/DropletEast": 14_202, "app/DropletWest": 13_880, … }
  const fleet = yield* sessions.size
  // ---cut-after---
})
```

## Partition ethic (v1)

`ShardMap.consistentHash` sorts the node keys and picks with `Hash.string` modulo — stable for a
**fixed** node set. Membership change remaps keys; treat that as intentional. Hot keys and
rebalance are not reinvented here yet — v1 prioritizes loud miss over silent wrong answer.

See also [Fleets & Peers](/docs/fleets-and-peers) and `pnpm run example:shardmap-sessions`.
