# Prototype notes — Telemetry fleet glass + new factory idea (2026-07-13)

**Branch:** `cursor/telemetry-prototype-and-new-idea-ce05` off `integration`.  
**Agent:** 1 · research / prototype · not an implementation handoff yet.

## Telemetry prototype

Runnable: `examples/forms/resource/telemetry-fleet-glass.ts`  
Test: `test/telemetry-fleet-glass-prototype.test.ts`

Elevated **shape** (what a meshed `Telemetry.Tag` factory would bake in):

- Leaf uses Telemetry wire (`metricsSnapshot`) — same as today's Tag
- `fleet`-marked folds via `Resource.peers` + `selfNode` + MultiNode (`byNode` / `sum`)
- Nodes are Context **service keys** (`app/DropletEast`, …)
- `Resource.distributed` + `Resource.fleetHealth` in the demo path

Today's `Telemetry.Tag` stays leaf-only (`snapshot` / `live`). This prototype is the homepage
recipe; elevating the factory means shipping those fleet fields + peers recipe so apps do not
hand-roll WorkerPool-style folds for metrics.

## Completely new factory idea — ShardMap

Not Telemetry, not Run upgrade, not WorkerPool-as-product, not FleetStatus-as-health-clone.

**`ShardMap`** — resource **factory** for a keyed partition map: one logical map, N node-local
shards, ownership routed through **peers** (productizes the intro “Working with peers” Sessions
beat).

```ts
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
}).pipe(Resource.distributed([DropletEast, DropletWest, DropletCentral])) {}

ShardMap.layer(Sessions, { /* partition strategy — not wire schemas */ })
// serve + peersLayer on every droplet
```

- Tag: key/value (+ optional error) schemas — apps invent domain
- Handle: routed `get`/`put`/`delete` + leaf `*Local` + fleet `size` / `sizeByNode`
- Mesh from day one: `selfNode` + `peers` ownership; missing peer → miss/degrade (not `/health`)
- Homepage: the Sessions demo stops being a custom `Resource.Tag` and becomes a toolkit factory

Distinct from Queue (drain) / Process (schedule) / Telemetry (metrics glass) / Run (local gate).

**Risks:** mini-Dynamo perception; rebalance/hot-key; degradation policy must be loud.

Owner still picks: elevate Telemetry first vs open a ShardMap design brief.
