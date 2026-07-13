# Telemetry fleet glass + ShardMap — usage & description (2026-07-13)

**Branch:** `cursor/telemetry-prototype-and-new-idea-ce05` off `integration`.  
**Agent:** 1 · prototype / research · not an approved implementation handoff.

---

## 1. Elevating Telemetry — what it is

**Today:** `Telemetry.Tag` is a small resource factory that serves **this node's** Effect `Metric`
registry over Resource RPC:

```ts
class FleetTelemetry extends Telemetry.Tag<FleetTelemetry>()() {}
// leaf only:
yield* (yield* FleetTelemetry).snapshot   // MetricsSnapshot
yield* Stream.runForEach((yield* FleetTelemetry).live, …)
```

Queues / HttpApiResource already **emit** into that registry (`queue_in_flight`,
`httpapi_endpoint_requests_total`, …). Telemetry is the **glass** — it does not invent counters.

**Pain:** to show a **fleet** view you must invent mesh yourself (WorkerPool-style), or fan out
`Resource.client(Telemetry, eachNode)` in the dashboard and stamp node ids in UI code.

**Elevation:** the Telemetry **factory** ships mesh from day one — leaf snapshot/live **plus**
`fleet`-marked folds built with `peers` / `selfNode` / MultiNode — so a homepage (or ops page) reads
one tag and gets overall + per-node panels without hand-rolling the fold.

### Prototype (runnable)

```bash
pnpm run example:telemetry-fleet-glass
```

Source: `examples/forms/resource/telemetry-fleet-glass.ts`  
Test: `test/telemetry-fleet-glass-prototype.test.ts`

The prototype uses a **hand-shaped** tag (`FleetMetrics`) that *shows* the elevated contract. Shipping
elevation means baking that into `Telemetry.Tag` + `Telemetry.serve` / `peersLayer` recipe — apps would
not redefine the folds.

### Usage — declare nodes + meshed Telemetry

```ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import * as Telemetry from "@nikscripts/effect-pm/Telemetry"
import * as QueueResource from "@nikscripts/effect-pm/QueueResource"

// Machines — Context service keys (same family as app/Emails), not "east" nicknames
class DropletEast extends Resource.Node<DropletEast>("app/DropletEast", {
  url: "https://east.example/rpc",
}) {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest", {
  url: "https://west.example/rpc",
}) {}
class DropletCentral extends Resource.Node<DropletCentral>("app/DropletCentral", {
  url: "https://central.example/rpc",
}) {}

// Elevated factory target (prototype today = custom Tag; tomorrow = Telemetry.Tag + mesh helpers)
class FleetMetrics extends Telemetry.Tag<FleetMetrics>()().pipe(
  Resource.distributed([DropletEast, DropletWest, DropletCentral]),
) {}

// App work still invents its own queues — separate service keys
class Mail extends QueueResource.Tag<Mail>()("app/Mail", Job) {}
```

### Usage — serve on each droplet

```ts
// east process
const east = Layer.mergeAll(
  QueueResource.serve(Mail, { effect: handleMail, autoStart: true }),
  Telemetry.serve(FleetMetrics, { interval: "1 second" }),
).pipe(
  Layer.provide(Resource.peersLayer(FleetMetrics, DropletEast)),
)
```

Same pattern on West / Central with their `Node`. Queues emit metrics on that process; Telemetry
samples the **local** registry; peer folds read **other** nodes' leaf `snapshot`.

### Usage — homepage / dashboard operator

```ts
const glass = yield* FleetMetrics          // via Resource.client(FleetMetrics, DropletEast)

const leaf = yield* glass.snapshot         // this droplet's registry
const byNode = yield* glass.inFlightByNode // Record<nodeKey, number>  — fleet-marked
const fleet = yield* glass.fleetInFlight   // number — sum across mesh

// Prototype logs today:
//   inFlightByNode: app/DropletWest=3, app/DropletCentral=4, app/DropletEast=5
//   fleetInFlight: 12
```

**Homepage panels that fall out of this:**

| Panel | Call | Meaning |
|-------|------|---------|
| Per-droplet in-flight | `inFlightByNode` | Three columns keyed by `app/Droplet*` |
| Fleet in-flight | `fleetInFlight` | One big number |
| Live sparkline | `live` (leaf) or stream fold | Motion without Grafana |
| Drill | pick gauges/counters from `snapshot.metrics` by `id` / labels | API RPS, rate-limit spikes |

**What elevation would remove from apps:** writing `combineQuery` / `Combine.sum` / `selfNode` for
metrics. Factory owns that; apps declare the Tag, serve + `peersLayer`, read fleet fields.

### What this is / is not

| Is | Is not |
|----|--------|
| Resource **factory** story (glass over existing emitters) | A new work engine |
| Mesh with `distributed` / `peers` / `fleet` | Multi-client “stamp host in UI” |
| Complements Queue / Process / RR | Replacement for OTEL export |

---

## 2. ShardMap — what it is

**A new toolkit resource factory** (like `QueueResource` / `Process`) for a **keyed partition map**:
one logical map across the fleet, each node owns a shard, routed ops go through **peers**.

It productizes the intro **“Working with peers”** Sessions example — today that is a hand-rolled
`Resource.Tag` + manual `ownerOf` + `peer.getLocal`. ShardMap would be the factory so apps only
declare **key/value schemas**.

### Why it is a headliner (vs Telemetry / Queue / Process)

| Factory | Job |
|---------|-----|
| QueueResource | Drain a backlog of work |
| Process | Tick / schedule long-running work |
| Telemetry | Observe Metric glass |
| RunResource | Local concurrency gate |
| **ShardMap** | **Own partitioned state across droplets** |

Mesh is the *default* story — not bolted on. Homepage claim: *“One map. Three droplets. Lookups
route to the owner.”*

### Usage — declare

```ts
import { Schema } from "effect"
import * as Resource from "@nikscripts/effect-pm/Resource"
import * as ShardMap from "@nikscripts/effect-pm/ShardMap" // proposed

const SessionId = Schema.String
const Session = Schema.Struct({
  id: SessionId,
  userId: Schema.String,
  lastSeen: Schema.Number,
})

class DropletEast extends Resource.Node<DropletEast>("app/DropletEast", {
  url: "https://east.example/rpc",
}) {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest", {
  url: "https://west.example/rpc",
}) {}
class DropletCentral extends Resource.Node<DropletCentral>("app/DropletCentral", {
  url: "https://central.example/rpc",
}) {}

// Factory: Tag = wire contract only (key + value schemas)
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  // error?: SessionErr   — optional failure channel
}).pipe(
  Resource.distributed([DropletEast, DropletWest, DropletCentral]),
) {}
```

### Usage — layer / serve (runtime, not schemas)

```ts
const partition = ShardMap.consistentHash // or app-supplied ownerOf

// each droplet process:
const east = ShardMap.serve(Sessions, {
  partition,           // how keys map to node keys — NOT wire schemas
  // optional: capacity, ttl, store journal via ShardMap.store(Sessions)
}).pipe(
  Layer.provide(Resource.peersLayer(Sessions, DropletEast)),
)
```

Internally (what the factory owns — apps do not write this):

```ts
get: (id) => Effect.gen(function* () {
  const self = yield* Resource.selfNode(Sessions)
  const peers = yield* Resource.peers(Sessions)
  const owner = partition(id, [self, ...Object.keys(peers)])
  if (owner === self) return yield* getLocal(id)
  const peer = peers[owner]
  if (peer === undefined) return Option.none() // degrade: miss, not /health hop
  return yield* peer.getLocal(id)
})
```

### Usage — call sites

```ts
const sessions = yield* Sessions

// Routed — anywhere in the fleet; factory forwards to the owning droplet
const s = yield* sessions.get("user-42")
yield* sessions.put({ id: "user-42", userId: "u1", lastSeen: Date.now() })
yield* sessions.delete("user-42")

// Leaf — this droplet's shard only (peers may call these; fleet fields exclude them from fan-out)
const local = yield* sessions.getLocal("user-42")
const n = yield* sessions.sizeLocal

// Fleet — mesh folds (Resource.fleet)
const sizes = yield* sessions.sizeByNode   // Record<nodeKey, number>
const total = yield* sessions.size         // sum
```

### Usage — homepage sketch

| Panel | Call | Story |
|-------|------|-------|
| “Sessions in flight” | `size` | One fleet number |
| Per droplet shard size | `sizeByNode` | Columns `app/DropletEast=…` |
| Live lookup | `get(id)` against any client | Shows peer forward |
| Partial mesh | kill West, `get` owned by West | Returns miss — readiness stays local |

### What apps invent vs what the factory invents

| App | Factory |
|-----|---------|
| Key/value schemas + tag key (`app/Sessions`) | Routed verbs + `*Local` leaves |
| Node set + urls | `peers` ownership + degrade policy |
| Optional store registration | Journal shapes for put/delete audit |
| Which droplet runs which process | `serve` + `peersLayer` recipe |

### Risks (stated loudly)

- Reads as “mini Dynamo/Redis” if scoped poorly — keep **in-fleet typed map**, not a database product
- Membership change / rebalance and hot keys need an explicit v1 policy
- Degradation (miss vs stall) must be part of the API docs, not folklore
- Do not drag in the deferred **coordinator** unless owner opens that checklist item

---

## Comparison (decision aid)

| | Telemetry elevation | ShardMap (new) |
|--|---------------------|----------------|
| Noun | Factory glass over Metrics | Factory for partitioned state |
| Exists today | Leaf `Telemetry.Tag` + emitters | Hand-rolled intro Sessions only |
| Mesh role | Fold observations | Route ownership |
| Homepage emotion | Live ops numbers | “Lookup finds its droplet” |
| Depends on | Peers recipe + optional fleet fields on Tag | New module + design brief |
| RR fleet rate-limits | Undercard later | Unrelated |

---

## Owner picks

1. Elevate Telemetry (bake prototype into factory) first?  
2. Open ShardMap implementation brief first?  
3. Both — Telemetry product polish + ShardMap design in parallel?
