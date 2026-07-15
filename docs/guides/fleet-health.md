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
import * as FleetHealth from "@nikscripts/effect-pm/FleetHealth"
import * as Resource from "@nikscripts/effect-pm/Resource"
// ---cut---
class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}

class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Resource.distributed([DropletEast, DropletWest]),
) {}
```

## Serve with peers + optional readiness

Pass the same readiness rows `/health` uses when you want the leaf to match `NodeStatus`.
Discharge the mesh with `Resource.peersLayer` (or `FleetHealth.alone` for a single node).

{.twoslash}
``` ts
import * as FleetHealth from "@nikscripts/effect-pm/FleetHealth"
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Effect, Layer } from "effect"
class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}
class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Resource.distributed([DropletEast, DropletWest]),
) {}
// ---cut---
const readiness = Effect.succeed([
  { key: "app/Cache", kind: "@nikscripts/effect-pm/Resource", ready: true },
])

FleetHealth.serve(MeshHealth, { readiness }).pipe(
  Layer.provide(Resource.peersLayer(MeshHealth, DropletEast)),
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
import * as FleetHealth from "@nikscripts/effect-pm/FleetHealth"
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Effect } from "effect"
class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}
class MeshHealth extends FleetHealth.Tag<MeshHealth>()().pipe(
  Resource.distributed([DropletEast, DropletWest]),
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

Peers only expose the **leaf** (`local`). `byNode` / `status` are `Resource.fleet` — excluded from
fan-out so a fold can't re-aggregate an aggregate. When you need to keep every peer `Exit` yourself,
use `MultiNode.combineByNodeExit` (FleetHealth does); `combineByNode` / `Resource.fleetHealth` still
skip-omit for metric-style folds.

## What not to do

Do **not** fold peers inside `withReadiness` — that cascades one node's failure into neighbours'
`/health`. Standards forbid it; FleetHealth exists so the fold is explicit and client-shaped.

Runnable form: `pnpm run example:fleet-health-glass`. See also [Telemetry](/docs/telemetry) and
[Fleets & Peers](/docs/fleets-and-peers).
