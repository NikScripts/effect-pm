{#readiness title="Readiness & Health" status="draft" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/readiness>.
<!-- docs-site-link:end -->
# Readiness & Health

Whether a served HyperService is actually able to do its job — beyond “the process is up.” A node folds every served service’s readiness into one aggregate with two faces (same SSOT):

- **`GET /health`** — `200` when all ready, `503` when any is not (`status: "degraded"`), body lists each HyperService’s `{ key, kind, ready, detail? }`
- **`(yield* MyNode).status`** — the same aggregate on the connected node handle (dashboard health board)

Readiness is **per-node and local**. It never hops to peers; a down neighbour must not cascade through `/health`. Fleet-wide health is a separate monitor — see [Fleet Health](/docs/fleet-health) (`FleetHealth` folds peer `local` with Reachable / Unreachable).

{.note}
Acquisition vs readiness: get hard dependencies ready by acquiring them eagerly with `Layer` (failures surface at boot). Readiness covers runtime health `Layer` can’t see — a connection that drops after the process started.

## Attach readiness to a tag

`Hyperlink.withReadiness` is dual — **data-first** `withReadiness(tag, fn)` or **data-last**
`.pipe(withReadiness(fn))`. Both are supported on node-bound tags (including many sites in one
program); prefer whichever reads cleaner. The derivation reads the **materialized service** and
returns `{ ready, detail? }`. Prefer an **inferred** `svc` (or a minimal structural type of the
fields you read) over annotating `Hyperlink.ServiceOf<typeof spec>` — the tag already carries the
spec. A tag with no derivation is **ready by default**, so unaware HyperServices never falsely fail a
gate.

``` ts
import { Effect, Schema } from "effect"
import * as Hyperlink from "hyperlink-ts/Hyperlink"

class Cache extends Hyperlink.Tag<Cache>()("app/Cache", {
  warm: Hyperlink.effect(Schema.Boolean),
}).pipe(
  Hyperlink.withReadiness((svc) =>
    Effect.map(svc.warm, (warm) =>
      warm ? { ready: true as const } : { ready: false as const, detail: "cold" },
    ),
  ),
) {}
```

Derivations **stack**. A later `withReadiness` receives the previous check as `base` — `yield* base` to extend it, or ignore `base` to replace it. Built-in contracts already attach one from their own status (e.g. a queue is ready while its pool is `running`).

## Depend on another service

`Hyperlink.readinessOf(tag)` yields that tag’s service and runs *its* derivation. The dependency lands in the Effect’s requirements — compile-time checked — and works whether the dependency is local or reached over RPC. `Hyperlink.allReady([...])` AND-combines checks (first not-ready wins, with its `detail`).

``` ts
import { Effect, Schema } from "effect"
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Hyperlink from "hyperlink-ts/Hyperlink"

const Job = Schema.Struct({ id: Schema.String })
// Database — some other HyperService on this node that already has withReadiness

class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", Job).pipe(
  Hyperlink.withReadiness((_svc, base) =>
    Hyperlink.allReady([base, Hyperlink.readinessOf(Database)]),
  ),
) {}
```

When `Database` reports not ready, `Jobs` degrades too — one readiness pass, still local to the node.

## Monitored dependencies

Many operational deps share the same contract shape: a `status` read, a live `changes` stream, and readiness derived from status. `Hyperlink.monitoredDependency` builds that pair so you don’t re-hand-roll it per league or per dep type. Still a plain `Hyperlink.Tag` — **not** a new kind.

``` ts
import { Schema } from "effect"
import * as Hyperlink from "hyperlink-ts/Hyperlink"

const DbStatus = Schema.Struct({
  connected: Schema.Boolean,
  latencyMs: Schema.Number,
})

const { spec, readiness } = Hyperlink.monitoredDependency({
  status: DbStatus,
  changes: DbStatus,
  readyWhen: (s) => s.connected,
  detail: (s) => `${s.latencyMs}ms`,
})

export class WnbaDatabase extends Hyperlink.withReadiness(
  Hyperlink.Tag<WnbaDatabase>()("@app/wnba/Database", spec, { node: WnbaNode }),
  readiness,
) {}
```

Options field names match the produced spec (`status` / `changes`). `changes` is the **element** schema of the stream. Serve an impl with those fields as usual (`Hyperlink.serve` / `Node.httpServer`); `/health` picks up the attached readiness automatically.

## Shared majority + one outlier on one port

`serveAllHttp` is retired — every host is `Node.httpServer([...serve layers])`. When **most** HyperServices share a dependency but **one** needs a private implementation of the same tag, do **not** provide the shared layer around the whole server (that would also feed the outlier). Group the majority with `Hyperlink.provide`, isolate the outlier on its own `serve`:

``` ts
import { Layer } from "effect"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"

const Host = Node.httpServer([
  Hyperlink.provide(SharedHandlers.layer, [
    Hyperlink.serve(Database, dbImpl),
    Hyperlink.serve(Workers, workersImpl),
  ]),
  Hyperlink.serve(Outlier, outlierImpl).pipe(Layer.provide(HookedHandlers.layer)),
])
```

One `/rpc`, one `/health`, no second port, no rewrite onto a second host API.
