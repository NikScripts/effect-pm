{#fleet-health title="Fleet Health" status="draft" done="api" appliesTo=all}
# Fleet Health

Stadium-board health across a **meshed** pack of nodes — without letting a down neighbour take
your local `/health` with it.

Per-node readiness (`withReadiness` → `GET /health` / `NodeStatus`) stays **local**. FleetHealth is
a separate glass on the same mesh Telemetry uses: leaf for this node, fleet fields that fold peers
with Effect `Exit` kept so silence never lies.

## Declare the glass

One tag. Distribute it across the droplets you actually run.

{.twoslash}
``` ts
import * as FleetHealth from "hyperlink-ts/FleetHealth"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
// ---cut---
class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}

class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Hyperlink.distributed([DropletEast, DropletWest]),
) {}
```

## Serve with peers + optional readiness

Pass the same readiness rows `/health` uses when you want the leaf to match `NodeStatus`.
Discharge the mesh with `Hyperlink.peersLayer` (or `FleetHealth.alone` for a single node).

{.twoslash}
``` ts
import * as FleetHealth from "hyperlink-ts/FleetHealth"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Effect, Layer } from "effect"
class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}
class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Hyperlink.distributed([DropletEast, DropletWest]),
) {}
// ---cut---
const readiness = Effect.succeed([
  { key: "app/Cache", kind: "hyperlink-ts/Hyperlink", ready: true },
])

FleetHealth.serve(MeshHealth, { readiness }).pipe(
  Layer.provide(Hyperlink.peersLayer(MeshHealth, DropletEast)),
)
```

## Read the board

| Field | Scope | Meaning |
|-------|--------|---------|
| `local` | leaf | This node's `ok` / `degraded` + resource rows |
| `byNode` | fleet | `Reachable` (peer's local) or `Unreachable` (Exit failure) |
| `status` | fleet | `ok` · `degraded` · `partial` (any unreachable) |

`Unreachable` ≠ `ready: false`. A cold cache is degraded; a dead peer is unreachable.

{.twoslash}
``` ts
import * as FleetHealth from "hyperlink-ts/FleetHealth"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Effect } from "effect"
class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}
class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Hyperlink.distributed([DropletEast, DropletWest]),
) {}
const program = Effect.gen(function* () {
// ---cut---
const glass = yield* MeshHealth

const local = yield* glass.local
// local: FleetHealth.LocalHealth — { status: "ok" | "degraded", resources: … }

const byNode = yield* glass.byNode
// byNode: Record<string, FleetHealth.NodeReport>
//   Reachable  → { _tag: "Reachable", status, resources }
//   Unreachable → { _tag: "Unreachable" }

const status = yield* glass.status
// status: "ok" | "degraded" | "partial"
// ---cut-after---
})
```

Peers only expose the **leaf** (`local`). `byNode` / `status` are `Hyperlink.fleet` — excluded from
fan-out so a fold can't re-aggregate an aggregate. When you need to keep every peer `Exit` yourself,
use `MultiNode.combineByNodeExit` (FleetHealth does); `combineByNode` / `Hyperlink.fleetHealth` still
skip-omit for metric-style folds.

## What not to do

Do **not** fold peers inside `withReadiness` — that cascades one node's failure into neighbours'
`/health`. Standards forbid it; FleetHealth exists so the fold is explicit and client-shaped.

Runnable form: `pnpm run example:fleet-health-glass`. See also [Telemetry](/docs/telemetry) and
[Fleets & Peers](/docs/fleets-and-peers).
