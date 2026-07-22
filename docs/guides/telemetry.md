{#telemetry title="Telemetry" status="draft" done="api previews types verified" appliesTo=all}
# Telemetry

Every hyperlink-ts node already writes into Effect's `Metric` registry — queues, processes, HTTP
clients, runtime gauges. **Telemetry** serves that registry as a Hyperlink: leaf fields for this
node, fleet folds when the tag is meshed. OTEL stays the professional sink; Telemetry is for custom
glass (CLI, TUI, web) over the same tags.

## Declare the glass

One tag. Distribute it across the droplets you actually run — Context service keys, not nicknames.

{.twoslash}
``` ts
import * as Telemetry from "hyperlink-ts/Telemetry"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
// ---cut---
class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}
class DropletCentral extends Node.Tag<DropletCentral>()("app/DropletCentral") {}

class FleetMetrics extends Telemetry.Tag<FleetMetrics>()().pipe(
  Hyperlink.distributed([DropletEast, DropletWest, DropletCentral]),
) {}
```

## Serve it on a droplet

`Telemetry.serve` forks the sampler and mounts leaf + fleet handlers. Discharge the mesh with
`Hyperlink.peersLayer` so fleet fields can fold the other nodes' leaf `snapshot`s.

{.twoslash}
``` ts
import * as Telemetry from "hyperlink-ts/Telemetry"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Duration, Layer } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}
class DropletCentral extends Node.Tag<DropletCentral>()("app/DropletCentral") {}
class FleetMetrics extends Telemetry.Tag<FleetMetrics>()().pipe(
  Hyperlink.distributed([DropletEast, DropletWest, DropletCentral]),
) {}
const nodeServer = (port: number) => <A, E, R>(resource: Layer.Layer<A, E, R>) =>
  Node.httpServer(resource).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  )
// ---cut---
const east = Telemetry.serve(FleetMetrics, {
  interval: Duration.seconds(1),
}).pipe(
  Layer.provide(Hyperlink.peersLayer(FleetMetrics, DropletEast)),
  nodeServer(3001),
)
// east: Layer — this droplet samples its registry and reaches West + Central for fleet folds
```

A single-node app with no peers uses `Telemetry.alone` instead of `peersLayer`:

{.twoslash}
``` ts
import * as Telemetry from "hyperlink-ts/Telemetry"
import { Layer } from "effect"
class FleetTelemetry extends Telemetry.Tag<FleetTelemetry>()() {}
// ---cut---
const local = Telemetry.layer(FleetTelemetry).pipe(
  Layer.provide(Telemetry.alone(FleetTelemetry)),
)
// local: Layer — leaf snapshot/live + fleet fields that only see this node
```

## Read this node's registry

`snapshot` is point-in-time. `live` is a ~1s push of the same envelope. Same handle, local or remote.

{.twoslash}
``` ts
import * as Telemetry from "hyperlink-ts/Telemetry"
import { Effect } from "effect"
class FleetMetrics extends Telemetry.Tag<FleetMetrics>()() {}
const program = Effect.gen(function* () {
// ---cut---
const glass = yield* FleetMetrics
const snap = yield* glass.snapshot       // MetricsSnapshot { ts, metrics }
const probe = snap.metrics.find((m) => m.id === "queue_enqueued_total")
const mine = Telemetry.inFlightOf(snap)  // number — queue_in_flight on this node (0 if absent)
// ---cut-after---
})
```

## Show the fleet

Fleet fields fold each peer's **leaf** `snapshot` (peers never expose fleet fields, so a fold can't
recurse). One yield, columns + total:

{.twoslash}
``` ts
import * as Telemetry from "hyperlink-ts/Telemetry"
import { Effect } from "effect"
class FleetMetrics extends Telemetry.Tag<FleetMetrics>()() {}
const program = Effect.gen(function* () {
// ---cut---
const glass = yield* FleetMetrics

const columns = yield* glass.inFlightByNode
// columns: Record<string, number> — e.g. { "app/DropletEast": 5, "app/DropletWest": 3 }

const total = yield* glass.fleetInFlight
// total: number — sum of queue_in_flight across self + peers
// ---cut-after---
})
```

`Telemetry.inFlightMetricId` is `"queue_in_flight"` — the gauge queue engines already emit.

## OTEL stays the grown-up sink

Telemetry does not retain, alert, or query history. Wire `@effect/opentelemetry` when you need
collectors; keep Telemetry when you want the registry on a Hyperlink tag your CLI / TUI / web already
speak.

Runnable form: `pnpm run example:telemetry-fleet-glass`. For readiness across the same mesh
(Reachable / Unreachable, not metric skip-omit), see [Fleet Health](/docs/fleet-health). Also
[Fleets & Peers](/docs/fleets-and-peers).
