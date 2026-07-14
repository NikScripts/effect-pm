---
"@nikscripts/effect-pm": minor
---

**Telemetry fleet glass + ShardMap factory.**

### Telemetry elevation

`Telemetry.Tag` now includes fleet fields folded via `Resource.peers` /

`Resource.selfNode`:

- **Leaves (unchanged):** `snapshot`, `live`
- **Fleet:** `inFlightByNode` (`Record<node, number>`), `fleetInFlight` (`number`) —
  sum/`byNode` of the `queue_in_flight` gauge across the mesh

Helpers: `Telemetry.inFlightMetricId`, `Telemetry.inFlightOf`, `Telemetry.alone(tag)` (empty
peer set for single-node serve/layer). Mesh discharge:

```ts
Telemetry.serve(FleetMetrics).pipe(
  Layer.provide(Resource.peersLayer(FleetMetrics, DropletEast)),
)
// or leaf-only:
Telemetry.layer(FleetMetrics).pipe(Layer.provide(Telemetry.alone(FleetMetrics)))
```

### ShardMap (new)

`@nikscripts/effect-pm/ShardMap` — partitioned key/value Resource factory:

```ts
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(Resource.distributed([DropletEast, DropletWest, DropletCentral])) {}

ShardMap.serve(Sessions).pipe(
  Layer.provide(Resource.peersLayer(Sessions, DropletEast)),
)
```

Routed `get` / `put` / `delete`, leaf `*Local` / `sizeLocal`, fleet `size` / `sizeByNode`.
Default partition: `ShardMap.consistentHash` (fixed node set). Unreachable owner → miss /
`put` returns `false` (never a silent write on the wrong shard).

### Docs

Djot guides: `docs/guides/telemetry.md`, `docs/guides/shardmap.md` (nav + Metrics / Fleets & Peers
pointers). `Resource.distributedOf(tag)` reads a tag's declared fleet.
