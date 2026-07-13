# Telemetry & ShardMap — compelling pitches (2026-07-13)

**Branch:** `cursor/telemetry-prototype-and-new-idea-ce05` · off `integration`  
**Status:** **implemented** — Telemetry elevated + ShardMap factory on this branch (PR)

---

## Pitch A — Telemetry: “The pack already instruments itself. Show the fleet.”

### The feeling

You bring up three droplets for a weekend league. Mail is chewing, the live poller is ticking,
HTTP clients are hitting Scores. Effect’s Metric registry on each box is already full of
`queue_in_flight`, completes, latency histograms, rate-limit spikes.

**Nothing is wrong with the engines.** What’s missing is the *glass that admits there are three of you.*

Today Telemetry is honest but lonely: one node’s registry, one RPC. To put East / West / Central on
a homepage you either open Grafana or write WorkerPool-style peer folds yourself and teach every
dashboard to invent node stamps.

**Elevated Telemetry is the glass that already knows about peers.** One factory tag. Leaf snapshots
for this droplet. Fleet fields for the pack. The same Resource that feeds CLI and web — metrics are
first-class citizens of the toolkit, not a side quest into OTEL.

### Why it’s a headliner (not “finish Run”)

- **It sells everything else.** Queue and Process stop being “engines that happen to emit counters”
  and become *visible* across the fleet — which is what a homepage has to prove in ten seconds.
- **It reuses blood already spilled.** Emitters exist. Tag / layer / serve / `./Telemetry` exist.
  Mesh primitives exist. Elevation is product composition, not a science project.
- **OTEL stays the grown-up sink.** Telemetry is the built-in Resource path: demos, TUIs, and apps
  that refuse a sidecar for week one.

### Usage that earns the pitch

**Declare the pack (Context service keys — machines, not nicknames)**

```ts
class DropletEast extends Resource.Node<DropletEast>("app/DropletEast", {
  url: "https://east.example/rpc",
}) {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest", {
  url: "https://west.example/rpc",
}) {}
class DropletCentral extends Resource.Node<DropletCentral>("app/DropletCentral", {
  url: "https://central.example/rpc",
}) {}

class FleetMetrics extends Telemetry.Tag<FleetMetrics>()().pipe(
  Resource.distributed([DropletEast, DropletWest, DropletCentral]),
) {}

class Mail extends QueueResource.Tag<Mail>()("app/Mail", Job) {}
class LiveScores extends Process.Tag<LiveScores>()("app/LiveScores", { success: Score }) {}
```

**Wire a droplet (engines + glass + mesh in one breathe)**

```ts
Layer.mergeAll(
  QueueResource.serve(Mail, { effect: deliver, autoStart: true }),
  Process.serve(LiveScores, { effect: pollScoreboard }),
  Telemetry.serve(FleetMetrics, { interval: "1 second" }),
).pipe(Layer.provide(Resource.peersLayer(FleetMetrics, DropletEast)))
```

Mail and LiveScores keep doing their jobs. Telemetry samples **this** registry. Peers bring the
other droplets’ leaves. Fleet fields fold them.

**Homepage — one yield, the whole pack**

```ts
const glass = yield* FleetMetrics // client pinned to any live droplet

const mine = yield* glass.snapshot
const columns = yield* glass.inFlightByNode
// → { "app/DropletEast": 5, "app/DropletWest": 3, "app/DropletCentral": 4 }

const total = yield* glass.fleetInFlight
// → 12

// Live: Stream from glass.live — sparkline that moves while the talk track runs
```

**What the visitor feels in the first viewport**

1. Three columns breathe — real `app/Droplet*` service keys, not fake “host-1”.
2. One fat fleet total syncs with the sum.
3. A rate-limit spike on West shows up as *West*, then in the fleet number — without opening another product.
4. Caption: *Queues and processes already instrument. Telemetry shows the fleet.*

### Runnable proof (prototype today)

```bash
pnpm run example:telemetry-fleet-glass
```

Hand-shaped `FleetMetrics` tag demonstrates the elevated contract. Shipping elevation = bake those
fleet fields + peers recipe into the Telemetry factory so nobody reimplements WorkerPool for gauges.

### Undercard (not the poster)

Fleet-aware RunResource + fleet rate-limits become a *supporting* reel under this glass
(“gates honor fleet budget”) — they don’t carry the homepage alone.

---

## Pitch B — ShardMap: “One map. The key finds its droplet.”

### The feeling

Your intro already sells the magic beat: a session lives on *someone’s* node; `get` forwards to the
owner via `Resource.peers`. Every multi-droplet app reinvents that pattern — sticky sessions, score
caches, per-region feature flags, “which machine holds this user’s inbox cursor.”

**They shouldn’t.** That pattern is a **resource factory**, the same way “drain jobs” is
`QueueResource` and “tick on a schedule” is `Process`.

**ShardMap** is the factory where **partitioned state** is the product: declare key + value, distribute
across `app/Droplet*` nodes, and every `get` / `put` routes through peers to the owner. Leaf ops stay
for the shard itself. Fleet folds tell you how big each shard is. Kill a droplet — miss, not a
cascading `/health` failure.

### Why it’s a headliner (and not “Telemetry but for data”)

- **Different verb.** Telemetry *observes*. Queue *drains*. Process *ticks*. ShardMap **owns**.
- **The intro already wrote the demo.** Elevating that hand-roll into `@nikscripts/effect-pm/ShardMap`
  turns a docs parable into a toolkit noun.
- **Mesh by nature.** A single-node ShardMap is just a Map. The interesting product *requires* peers —
  so day-one fleet isn’t marketing; it’s load-bearing.

### Usage that earns the pitch

**Declare the empire’s sessions (schemas only on the Tag)**

```ts
const SessionId = Schema.String
const Session = Schema.Struct({
  id: SessionId,
  userId: Schema.String,
  lastSeen: Schema.Number,
  seat: Schema.optional(Schema.String), // "section-12-row-A" for the sports story
})

class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
}).pipe(
  Resource.distributed([DropletEast, DropletWest, DropletCentral]),
) {}
```

**Bring a droplet online**

```ts
ShardMap.serve(Sessions, {
  partition: ShardMap.consistentHash, // or your sticky ownerOf
}).pipe(Layer.provide(Resource.peersLayer(Sessions, DropletEast)))
```

No payloads in the layer. Partition strategy is runtime. Wire schemas stay on the Tag.

**Talk to the map from anywhere in the pack**

```ts
const sessions = yield* Sessions

// Fan walks in at the edge — East takes the HTTP hit
yield* sessions.put({
  id: "fan-90210",
  userId: "u_nik",
  lastSeen: Date.now(),
  seat: "124-A",
})

// West answers a live-update poll for the same fan —
// factory forwards to whoever owns "fan-90210"
const seat = yield* sessions.get("fan-90210")

// Ops: who is holding what?
const shards = yield* sessions.sizeByNode
// → { "app/DropletEast": 14_202, "app/DropletWest": 13_880, "app/DropletCentral": 12_104 }

const fleet = yield* sessions.size // → 40_186
```

**What the visitor feels in the first viewport**

1. Type a session id → **owner droplet lights up** (peer forward, visible).
2. Shard size histogram across `app/Droplet*` updates as traffic lands.
3. Flip West offline → that shard’s keys return miss; East and Central keep answering; local
   readiness dots stay green (fleet health ≠ `/health`).
4. Caption: *One map. The key finds its droplet.*

### Distinction that keeps it honest

| Temptation | How we refuse it |
|------------|------------------|
| “It’s Redis” | In-fleet typed Resource — schemas, RPC, CLI/TUI/web over the **same tag** |
| “It’s Dynamo” | No claim of cross-region consensus product; v1 = ownership + peer forward + loud miss |
| “Use a Queue” | Queue holds *work*; ShardMap holds *state the pack must find again* |

### Risks we put on the poster (trust)

- Rebalance / membership change needs an explicit v1 answer or “fixed node set” lock
- Hot keys need a story (steal? sticky? scream in docs?)
- Split-brain: miss beats silent wrong answer — document that as the product ethic

---

## Homepage shootout (same three droplets)

| Beat | Telemetry elevation | ShardMap |
|------|---------------------|----------|
| One-liner | The pack already instruments — show the fleet | One map — the key finds its droplet |
| First second | Columns + fleet total breathe | Typed id → owning droplet lights |
| Hero object | Live ops glass | Partitioned live state |
| Feeds | Existing Metric emitters | App puts/gets |
| Mesh role | Fold leaves | Route ownership |
| Undercard | RR fleet rate-limits | Persistence via `ShardMap.store` |

**Emotional test:** if you mute the code and leave only motion on screen, Telemetry feels like
*watching the stadium*; ShardMap feels like *finding your seat*.

---

## Owner call

1. **Telemetry first** — elevate the factory; homepage glass shipping now-ish.  
2. **ShardMap first** — design brief + factory; intro peers beat becomes a noun.  
3. **Both** — Telemetry as glass undercard while ShardMap takes the headline engine slot.

Full runnable Telemetry prototype: `pnpm run example:telemetry-fleet-glass`.
