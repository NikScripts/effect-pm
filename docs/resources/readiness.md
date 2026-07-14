{#readiness title="Readiness & Health" status="draft" done="api" appliesTo=all}
# Readiness & Health

Whether a served resource is actually able to do its job — beyond “the process is up.” A node folds every served resource’s readiness into one aggregate with two faces (same SSOT):

- **`GET /health`** — `200` when all ready, `503` when any is not (`status: "degraded"`), body lists each resource’s `{ key, kind, ready, detail? }`
- **`NodeStatus`** — the same aggregate for the dashboard health board

Readiness is **per-node and local**. It never hops to peers; a down neighbour must not cascade through `/health`. Fleet-wide health is a separate monitor that *reads* a `fleet` field as a client, not a readiness gate.

{.note}
Acquisition vs readiness: get hard dependencies ready by acquiring them eagerly with `Layer` (failures surface at boot). Readiness covers runtime health `Layer` can’t see — a connection that drops after the process started.

## Attach readiness to a tag

`Resource.withReadiness` is dual — **data-first** `withReadiness(tag, fn)` or **data-last**
`.pipe(withReadiness(fn))`. Both are supported on node-bound tags (including many sites in one
program); prefer whichever reads cleaner. The derivation reads the **materialized service** and
returns `{ ready, detail? }`. Prefer an **inferred** `svc` (or a minimal structural type of the
fields you read) over annotating `Resource.ServiceOf<typeof spec>` — the tag already carries the
spec. A tag with no derivation is **ready by default**, so unaware resources never falsely fail a
gate.

``` ts
import { Effect, Schema } from "effect"
import * as Resource from "@nikscripts/effect-pm/Resource"

class Cache extends Resource.Tag<Cache>()("app/Cache", {
  warm: Resource.effect(Schema.Boolean),
}).pipe(
  Resource.withReadiness((svc) =>
    Effect.map(svc.warm, (warm) =>
      warm ? { ready: true as const } : { ready: false as const, detail: "cold" },
    ),
  ),
) {}
```

Derivations **stack**. A later `withReadiness` receives the previous check as `base` — `yield* base` to extend it, or ignore `base` to replace it. Built-in contracts already attach one from their own status (e.g. a queue is ready while its pool is `running`).

## Depend on another resource

`Resource.readinessOf(tag)` yields that tag’s service and runs *its* derivation. The dependency lands in the Effect’s requirements — compile-time checked — and works whether the dependency is local or reached over RPC. `Resource.allReady([...])` AND-combines checks (first not-ready wins, with its `detail`).

``` ts
import { Effect, Schema } from "effect"
import * as QueueResource from "@nikscripts/effect-pm/QueueResource"
import * as Resource from "@nikscripts/effect-pm/Resource"

const Job = Schema.Struct({ id: Schema.String })
// Database — some other resource on this node that already has withReadiness

class Jobs extends QueueResource.Tag<Jobs>()("app/Jobs", Job).pipe(
  Resource.withReadiness((_svc, base) =>
    Resource.allReady([base, Resource.readinessOf(Database)]),
  ),
) {}
```

When `Database` reports not ready, `Jobs` degrades too — one readiness pass, still local to the node.

## Monitored dependencies

Many operational deps share the same contract shape: a `status` read, a live `changes` stream, and readiness derived from status. `Resource.monitoredDependency` builds that pair so you don’t re-hand-roll it per league or per dep type. Still a plain `Resource.Tag` — **not** a new kind.

``` ts
import { Schema } from "effect"
import * as Resource from "@nikscripts/effect-pm/Resource"

const DbStatus = Schema.Struct({
  connected: Schema.Boolean,
  latencyMs: Schema.Number,
})

const { spec, readiness } = Resource.monitoredDependency({
  status: DbStatus,
  changes: DbStatus,
  readyWhen: (s) => s.connected,
  detail: (s) => `${s.latencyMs}ms`,
})

export class WnbaDatabase extends Resource.withReadiness(
  Resource.Tag<WnbaDatabase>()("@app/wnba/Database", spec, { node: WnbaNode }),
  readiness,
) {}
```

Options field names match the produced spec (`status` / `changes`). `changes` is the **element** schema of the stream. Serve an impl with those fields as usual (`Resource.serve` / `Resource.httpServer`); `/health` picks up the attached readiness automatically.

## Shared majority + one outlier on one port

`serveAllHttp` is retired — every host is `Resource.httpServer([...serve layers])`. When **most** resources share a dependency but **one** needs a private implementation of the same tag, do **not** provide the shared layer around the whole server (that would also feed the outlier). Group the majority with `Resource.provide`, isolate the outlier on its own `serve`:

``` ts
import { Layer } from "effect"
import * as Resource from "@nikscripts/effect-pm/Resource"

const Host = Resource.httpServer([
  Resource.provide(SharedHandlers.layer, [
    Resource.serve(Database, dbImpl),
    Resource.serve(Workers, workersImpl),
  ]),
  Resource.serve(Outlier, outlierImpl).pipe(Layer.provide(HookedHandlers.layer)),
])
```

One `/rpc`, one `/health`, no second port, no rewrite onto a second host API.
