{#telemetry title="Telemetry" appliesTo=all}
# Telemetry

Serve a node's Effect `Metric` registry as a Resource — leaf snapshots for this
runtime, fleet folds when the tag is meshed. The thin counterpart to OTEL export:
same source (the per-node registry), different sink. Use Telemetry for in-app
glass (dashboards, TUIs, a `pm metrics` command); use `@effect/opentelemetry` when
you want Grafana / Sentry / Honeycomb.

## Declare and serve

{.twoslash}
``` ts
import * as Telemetry from "@nikscripts/effect-pm/Telemetry"
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Duration, Layer } from "effect"

class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}

class FleetMetrics extends Telemetry.Tag<FleetMetrics>()().pipe(
  Resource.distributed([DropletEast, DropletWest]),
) {}

const onEast = Telemetry.serve(FleetMetrics, {
  interval: Duration.seconds(1),
}).pipe(Layer.provide(Resource.peersLayer(FleetMetrics, DropletEast)))
```
Leaf-only (no peers): discharge the mesh with `Telemetry.alone`.

{.twoslash}
``` ts
import * as Telemetry from "@nikscripts/effect-pm/Telemetry"
import { Layer } from "effect"
class FleetTelemetry extends Telemetry.Tag<FleetTelemetry>()() {}
// ---cut---
const local = Telemetry.layer(FleetTelemetry).pipe(
  Layer.provide(Telemetry.alone(FleetTelemetry)),
)
```

## Leaf fields

`snapshot` is a point-in-time reading of this node's registry.
`live` is a ~1s push of the same envelope (cadence via `{ interval }`).

{.twoslash}
``` ts
import * as Telemetry from "@nikscripts/effect-pm/Telemetry"
import { Effect } from "effect"
class FleetTelemetry extends Telemetry.Tag<FleetTelemetry>()() {}
const program = Effect.gen(function* () {
  const t = yield* FleetTelemetry
  // ---cut---
  const snap = yield* t.snapshot
  // MetricsSnapshot { ts, metrics: counter | gauge | histogram }
  const probe = snap.metrics.find((m) => m.id === "queue_enqueued_total")
  // ---cut-after---
})
```

## Fleet glass

When peers are provided, fleet fields fold each peer's **leaf** `snapshot`
(fleet fields are excluded from `Resource.peers`, so a fold cannot recurse):

- `inFlightByNode` — `queue_in_flight` gauge per node key
- `fleetInFlight` — sum across self + peers

{.twoslash}
``` ts
import * as Telemetry from "@nikscripts/effect-pm/Telemetry"
import { Effect } from "effect"
class FleetMetrics extends Telemetry.Tag<FleetMetrics>()() {}
const program = Effect.gen(function* () {
  const glass = yield* FleetMetrics
  // ---cut---
  const columns = yield* glass.inFlightByNode
  // { "app/DropletEast": 5, "app/DropletWest": 3, … }
  const total = yield* glass.fleetInFlight
  // ---cut-after---
})
```

Helpers: `Telemetry.inFlightMetricId` (`"queue_in_flight"`) and
`Telemetry.inFlightOf(snap)`.

## OTEL stays the grown-up sink

Telemetry does not retain, alert, or query history — that is OTEL's job. Wire
`@effect/opentelemetry` when you need collectors; keep Telemetry when you want the
same registry on a Resource tag your CLI / TUI / web already speak.

See also [Fleets & Peers](/docs/fleets-and-peers) and the runnable form
`pnpm run example:telemetry-fleet-glass`.
