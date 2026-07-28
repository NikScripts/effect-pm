{#stores title="Stores" status="draft" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/stores>.
<!-- docs-site-link:end -->
# Stores

Durable storage for HyperServices — one composition recipe so Soft unwrap captures your
app journal when you override, and bare toolkit layers still work (in-memory baked in).

This guide is the SSOT for wiring. Persistence *shapes* (append/read vs custom store vs
engine-owned SQL) live in [`docs/standards/storage.md`](../standards/storage.md). Log fans and
`_logs` tails live in [`docs/guides/logs.md`](./logs.md).

## The recipe (Effect-true)

Toolkit engines (`Daemon.layer` / `serve` / `serveRemote`, and the WorkPool /
Gate counterparts) **soft-default** `Store.layerDefaultMemory` via
`Store.withDefaultStorage` — **R is fulfilled** out of the box. `*Memory` variants are
aliases of the same soft-default (ephemeral engine journal — **no** Logs platform).

Override by providing your app store **into** the toolkit layer so Soft unwrap sees ambient
`Storage` before the default:

```ts
import { Layer } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
import * as Daemon from "hyperlink-ts/Daemon"
import * as Store from "hyperlink-ts/Store"
import * as Node from "hyperlink-ts/Node"

class BillingNode extends Node.Tag<BillingNode>()("billing/scores") {}
class Daily extends Daemon.Tag<Daily>()("app/Daily") {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  BillingNode.logs,
  Daemon.store(Daily),
) {}

// Soft unwrap sees AppStore.Storage — engines write the SQLite journal.
const live = Daemon.layer(Daily, { effect: poll }).pipe(
  Layer.provideMerge(AppStore.layer({ filename: ".hyperlink-ts/data.sqlite" })),
)

// httpServer form — Layer.provide is fine when you do not `yield* AppStore` in-process:
Node.wsServer([Daemon.serve(Daily, { effect: poll })]).pipe(
  Layer.provide(AppStore.layer({ filename: ".hyperlink-ts/data.sqlite" })),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3001 })),
)
```

| Intent | API |
|--------|-----|
| Ephemeral engine journal (default) | `Daemon.layer` / `serve` (or `*Memory` aliases) — no provide needed |
| App journals + Logs | `…pipe(Layer.provide(Merge?)(AppStore.layer…))` into the toolkit layer |
| SQLite | `AppStore.layer({ filename })` — `filename` is **required** |
| In-memory AppStore (+ Logs) | `AppStore.layerMemory` |

## Why sibling merge was a footgun

Older toolkit layers **always baked** `Layer.provideMerge(layerDefaultMemory)` inside the engine
layer. Soft never saw an ambient AppStore, so SQLite AppStores stayed empty while two in-memory
journals looked like a working “override” (shared `EventJournal`).

Now Soft unwrap peeks at ambient `Storage` at build time:

- No AppStore in context → bake `layerDefaultMemory` (**R fulfilled**).
- AppStore fed via `Layer.provide` / `provideMerge` **into** the toolkit layer → engines capture that store (memory + Logs, or SQLite).

**Do not** sibling-`Layer.merge` the toolkit layer with AppStore and expect override — Soft never sees `Storage`, engines stay on the default journal, and the AppStore file stays empty.

**Do not** Soft-override with a Node-logs-only `Store.Service` unless that store also registers the engines you run — Soft captures that bridge and toolkit layers **die at build** (`Store.resolveOrDie`) when the engine scope is missing. Live-only log bus: `Logs.layer` (no `Storage`). Durable journals: one AppStore with `Node.logs` + `Daemon.store` / `WorkPool.store` / ….

## One store per Node (intentional multi-node = N stores)

- One `Store.Service` per Node ManagedRuntime: many registrations, one journal/file, one `Logs.layer`.
- Multi-node demos (`examples/hyperlink-web`) use **N** stores / **N** runtimes — each node its own
  `AppStore.layer*`.
- Do **not** install a second `Logs.layer` or second `Store.Service` in the same runtime.

## Logs vs `layerDefaultMemory`

`Store.layerDefaultMemory` (what soft-default / `*Memory` toolkit layers use) is **engine observability only**.
It does **not** install `Logs.Relay` / durable `_logs` tails. Durable logs need
`Store.Service.layer*` (bakes `Logs.layer`) or an explicit `Logs.layer`.

Node journal + resource `_logs` copies of the same live line are intentional — see the logs guide.

## Reading back

- Daemon / WorkPool execution rows: toolkit store handles (`store.events()`, …) or `Store.resolveOrDie`.
- App-facing queries after override: `yield* AppStore` / registration helpers.

## Agent / cutover map

This page is the **wiring SSOT**. Persistence *shapes* live in
[`docs/standards/storage.md`](../standards/storage.md). Historical cutover decisions (Store bridge,
facet retirement, per-engine migrations) remain under
[`docs/handoffs/store-cutover-00-store-core.md`](../handoffs/store-cutover-00-store-core.md) and
sibling `store-cutover-*.md` files — prefer this guide when they disagree.

| Plane | Today |
|-------|--------|
| Store bridge | `Store.Service` + toolkit `*.store(tag)` — Daemon / WorkPool / Gate execution history |
| Logs journals | `Node.logs` / toolkit store registrations on the same `Store.Service` — see [Logs](/docs/logs) |
| Retired | `DaemonStorage` / `LogStore` / `ProcessLifecycleStore` facet substrate — do not revive |

## Related

- [`docs/guides/logs.md`](./logs.md) — fans, `_logs`, `Hyperlink.logs`
- [`docs/standards/storage.md`](../standards/storage.md) — persistence shapes
