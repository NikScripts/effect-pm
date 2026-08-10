{#fleets-and-peers title="Fleets & Peers" status="stable" done="api" appliesTo=all}
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

Two membership styles:

| Style | Stamp | Peer dials |
|-------|-------|------------|
| **Fixed** | `Hyperlink.nodes([East, West, …])` | Stamped set; partition strategies use that membership |
| **Directory** | bare `Hyperlink.distributed` / `nodes([])` | `peersLayer` reads Directory; hot-rebinds on join / leave / dial move |

`Hyperlink.distributedOf(tag)` reads the declared node set (empty when undeclared) — fixed
partition strategies prefer that over remapping when a peer is briefly down.

## Shipped factories on the mesh

- **[Telemetry](/docs/telemetry)** — leaf metric snapshots; fleet folds (`inFlightByNode`,
  `fleetInFlight`) for the stadium board.
- **[Fleet Health](/docs/fleet-health)** — leaf readiness aggregate; fleet `byNode` /
  `status` with Reachable / Unreachable (local `/health` stays local).
- **[ShardMap](/docs/shardmap)** — partitioned key/value; routed `get` / `put` / `delete`
  forward to the owning node; leaf `*Local` ops; fleet `size` / `sizeByNode`.

## Directory peers (Lookup)

When membership is empty on the stamp, `Hyperlink.peersLayer(Tag, ThisNode)` discovers siblings
from Lookup’s Directory (pipe `Lookup.client` / `Lookup.layer` on the listen). Same Track D
parity as `Hyperlink.lookupClient`:

- **Build-then-swap** peer dials — prior stays until the next succeeds
- Effect peer RPCs that hit `RpcClientError` **retry once** after rebind
- Stable `peers[nodeKey]` facade identity across dial swaps
- Live streams follow dial generations (`Policy.StreamGap`)

Same `nodeKey`, new dial (A→B replacement): Directory updates the row; peersLayer rebinds.
Runnable: [`examples/node/peers-layer-rebind.ts`](../../examples/node/peers-layer-rebind.ts)
(`pnpm run example:node-peers-layer-rebind`).

Peer wire defaults to HTTP. A fleet whose Nodes serve WebSocket must set peer protocol too —
see [Managing Layers — Fleets and peers](/docs/managing-layers#fleets-and-peers).

## Clients without a named Node

Addressed clients name a Node (`Hyperlink.client(Tag, node)` / `Hyperlink.http(node)`). When
Lookup owns placement, dial with **`Hyperlink.lookupClient(Tag)`** instead — Directory +
Advice + [Policy](/docs/policy) sticky / cold / stream gap. Recipe:
[Identity coordinator](/docs/identity-coordinator).

```ts
import * as Policy from "hyperlink-ts/Policy"
import * as Lookup from "hyperlink-ts/Lookup"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Layer } from "effect"

Hyperlink.lookupClient(Jobs).pipe(
  Policy.provide(Policy.Sticky(true), Policy.StreamGap("stall")),
  Layer.provide(Lookup.layer),
)
```

Sibling Tags (not under Lookup): `import * as Advice from "hyperlink-ts/Advice"`,
`Directory`, `Identity` — never `Lookup.Advice.*`.

## Advertise conflict & yield

Directory-row replace uses [Policy](/docs/policy) conflict / yield fragments
(`askIncumbent`, `yieldAccept` / `yieldRefuse`) or Node / `ListenOptions` stamps.
While `Node.drain` / `shutdown` has set `phase: "draining"`, yield **always refuses**.

## See also

- [Identity coordinator](/docs/identity-coordinator) — Lookup planes + A→B cutover
- [Policy](/docs/policy) — dial sticky, stream gap, verify, conflict, yield
- [Launcher](/docs/launcher) — OS custody bring-up (not membership)
- [Client verify](/docs/client-verify) — addressed-client probe ladder
- [Managing Layers](/docs/managing-layers) — listen / client / peersLayer vocabulary
