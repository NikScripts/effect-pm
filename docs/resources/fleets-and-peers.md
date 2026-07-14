{#fleets-and-peers title="Fleets & Peers" status="draft" appliesTo=all}
# Fleets & Peers

Running one resource across many runtimes and having its instances coordinate.

**Fleets** — declare nodes, pipe `Resource.distributed([...])` onto a tag, mark fields with
`Resource.fleet` so peers don't recurse into them. **Peers** — inside a layer,
`Resource.peers` / `Resource.selfNode` (discharged by `Resource.peersLayer`) let an instance
reach siblings.

Two shipped factories lean on this mesh:

- **[Telemetry](/docs/telemetry)** — leaf metric snapshots; fleet folds (`inFlightByNode`,
  `fleetInFlight`) for the stadium board.
- **[Fleet Health](/docs/fleet-health)** — leaf readiness aggregate; fleet `byNode` /
  `status` with Reachable / Unreachable (local `/health` stays local).
- **[ShardMap](/docs/shardmap)** — partitioned key/value; routed `get` / `put` / `delete`
  forward to the owning node; leaf `*Local` ops; fleet `size` / `sizeByNode`.

`Resource.distributedOf(tag)` reads the declared node set (empty when undeclared) — partition
strategies use that fixed membership rather than remapping when a peer is briefly down.
