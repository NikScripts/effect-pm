{#shardmap title="ShardMap" status="draft" done="api previews types verified" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/shardmap>.
<!-- docs-site-link:end -->
# ShardMap

The intro's Sessions beat — a key lives on *someone's* node; `get` forwards to the owner via
`Hyperlink.peers` — is a pattern every multi-droplet app reinvents. **ShardMap** is that pattern as a
Hyperlink factory: declare `key` / `value`, distribute across `app/Droplet*` nodes, and every routed
`get` / `put` / `delete` finds the owner. Leaf `*Local` ops stay on this shard. Fleet folds report
sizes. An unreachable owner degrades to a miss — never a silent write on the wrong droplet.

## Declare the map

Schemas on the Tag. `keyOf` extracts the partition key from a value (routed `put`). Partition strategy
is a runtime option on `serve` / `layer` (default: `ShardMap.consistentHash`).

{.twoslash}
``` ts
import * as ShardMap from "hyperlink-ts/ShardMap"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Schema } from "effect"
// ---cut---
class DropletEast extends Node.Service<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Service<DropletWest>()("app/DropletWest") {}
class DropletCentral extends Node.Service<DropletCentral>()("app/DropletCentral") {}

const SessionId = Schema.String
const Session = Schema.Struct({
  id: SessionId,
  userId: Schema.String,
  seat: Schema.optionalKey(Schema.String),
})

class Sessions extends ShardMap.Service<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(
  Hyperlink.nodes([DropletEast, DropletWest, DropletCentral]),
) {}
```

## Bring a droplet online

One materialization — local shard + RPC handlers + peer clients. Swap `DropletEast` for West /
Central on the other machines; the caller's program does not change.

{.twoslash}
``` ts
import * as ShardMap from "hyperlink-ts/ShardMap"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Layer, Schema } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
class DropletEast extends Node.Service<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Service<DropletWest>()("app/DropletWest") {}
class DropletCentral extends Node.Service<DropletCentral>()("app/DropletCentral") {}
const SessionId = Schema.String
const Session = Schema.Struct({
  id: SessionId,
  userId: Schema.String,
  seat: Schema.optionalKey(Schema.String),
})
class Sessions extends ShardMap.Service<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(
  Hyperlink.nodes([DropletEast, DropletWest, DropletCentral]),
) {}
const nodeServer = (port: number) => <A, E, R>(serviceKey: Layer.Layer<A, E, R>) =>
  Node.httpServer(serviceKey).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  )
// ---cut---
const east = ShardMap.serve(Sessions).pipe(
  Layer.provide(Hyperlink.peersLayer(Sessions, DropletEast)),
  nodeServer(3001),
)
// east: Layer — this droplet owns its shard and forwards the rest through peers
```

## Put and get from anywhere

From East's HTTP edge or West's poller — same handle. Ownership + the hop stay inside the Hyperlink.

{.twoslash}
``` ts
import * as ShardMap from "hyperlink-ts/ShardMap"
import { Effect, Schema } from "effect"
const SessionId = Schema.String
const Session = Schema.Struct({
  id: SessionId,
  userId: Schema.String,
  seat: Schema.optionalKey(Schema.String),
})
class Sessions extends ShardMap.Service<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}) {}
const program = Effect.gen(function* () {
// ---cut---
const sessions = yield* Sessions

const wrote = yield* sessions.put({
  id: "fan-90210",
  userId: "u_nik",
  seat: "124-A",
})
// wrote: boolean — true when the owning node accepted the write

const session = yield* sessions.get("fan-90210")
// session: Option<Session> — from whoever owns the key; none on miss

const dropped = yield* sessions.delete("fan-90210")
// dropped: boolean — true when an entry was removed on the owner
// ---cut-after---
})
```

Leaf ops (`getLocal` / `putLocal` / `deleteLocal` / `sizeLocal`) stay on **this** shard — that is what
peers fold and what routed ops forward to.

## Fleet sizes

Ops across the pack without inventing a second dashboard tag:

{.twoslash}
``` ts
import * as ShardMap from "hyperlink-ts/ShardMap"
import { Effect, Schema } from "effect"
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String })
class Sessions extends ShardMap.Service<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}) {}
const program = Effect.gen(function* () {
// ---cut---
const sessions = yield* Sessions

const shards = yield* sessions.sizeByNode
// shards: Record<string, number> — e.g. { "app/DropletEast": 14202, "app/DropletWest": 13880 }

const fleet = yield* sessions.size
// fleet: number — sum across self + peers
// ---cut-after---
})
```

## Persist the shard

Local keys are **SQLite SSOT** — one row per live `(scope, key)`, not an event log.
`ShardMap.layer` / `serve` open `:memory:` by default (always on); pass `{ filename }` for a
durable file. Boot loads rows once; mutations `UPSERT` / `DELETE`.

{.twoslash}
``` ts
import * as ShardMap from "hyperlink-ts/ShardMap"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Layer, Schema } from "effect"
class DropletEast extends Node.Service<DropletEast>()("app/DropletEast") {}
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String })
class Sessions extends ShardMap.Service<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(Hyperlink.nodes([DropletEast])) {}
// ---cut---
const live = ShardMap.serve(Sessions, {
  filename: ".hyperlink-ts/sessions.sqlite",
}).pipe(Layer.provide(Hyperlink.peersLayer(Sessions, DropletEast)))
// omit filename → in-memory SQLite (default)
```

## Partition ethic (v1)

`ShardMap.consistentHash` sorts node keys and picks with `Hash.string` modulo — stable for a
**fixed** fleet. Membership change remaps keys; treat that as intentional. Unreachable owner →
`get` is `none`, `put` returns `false` — miss beats silent wrong answer.

Runnable form: `pnpm run example:fleet-shardmap-sessions`. See also
[Fleets & Peers](/docs/fleets-and-peers).
