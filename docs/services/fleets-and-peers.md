{#fleets-and-peers title="Fleets & Peers" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/fleets-and-peers>.
<!-- docs-site-link:end -->
# Fleets & Peers

Running one HyperService across many runtimes and having its instances coordinate.

**Fleets** — declare nodes with `Hyperlink.nodes([...])` (or bare `Hyperlink.distributed` for
directory discovery), mark fields with `Hyperlink.fleet` so peers don't recurse into them.
**Peers** — inside a layer, `Hyperlink.peers` / `Hyperlink.selfNode` (discharged by
`Hyperlink.peersLayer`) let an instance reach siblings.

Two shipped factories lean on this mesh:

- **[Telemetry](/docs/telemetry)** — leaf metric snapshots; fleet folds (`inFlightByNode`,
  `fleetInFlight`) for the stadium board.
- **[Fleet Health](/docs/fleet-health)** — leaf readiness aggregate; fleet `byNode` /
  `status` with Reachable / Unreachable (local `/health` stays local).
- **[ShardMap](/docs/shardmap)** — partitioned key/value; routed `get` / `put` / `delete`
  forward to the owning node; leaf `*Local` ops; fleet `size` / `sizeByNode`.

`Hyperlink.distributedOf(tag)` reads the declared node set (empty when undeclared) — partition
strategies use that fixed membership rather than remapping when a peer is briefly down.
