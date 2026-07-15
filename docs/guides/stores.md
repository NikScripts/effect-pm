{#stores title="Stores" status="draft" appliesTo=all}
# Stores

Durable storage for resources — one composition recipe so you cannot silently record on
`layerDefaultMemory` while reading an app `Store.Service`.

This guide is the SSOT for wiring. Persistence *shapes* (append/read vs custom store vs
engine-owned SQL) live in [`docs/standards/storage.md`](../standards/storage.md). Log fans and
`_logs` tails live in [`docs/guides/logs.md`](./logs.md).

## The recipe (Effect-true)

Toolkit engines (`Process.layer` / `serve` / `serveRemote`, and the Queue / CustomQueue /
RunResource counterparts) **require** `Store.Storage`. They capture that service once at layer
build. Soft-default ephemeral journals are **only** via the `*Memory` variants
(`Process.layerMemory`, …) which merge `Store.layerDefaultMemory` — **no** Logs platform.

Real apps provide an app store:

```ts
import { Layer } from "effect"
import * as Process from "@nikscripts/effect-pm/Process"
import * as Store from "@nikscripts/effect-pm/Store"
import * as Resource from "@nikscripts/effect-pm/Resource"

class BillingNode extends Resource.Node<BillingNode>("billing/scores") {}
class Daily extends Process.Tag<Daily>()("app/Daily") {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  BillingNode.logs,
  Process.store(Daily),
) {}

// Prefer this: AppStore satisfies Storage (and keeps AppStore readable).
const live = Process.layer(Daily, { effect: poll }).pipe(
  Layer.provideMerge(AppStore.layer({ filename: ".effect-pm/data.sqlite" })),
)

// httpServer form — Layer.provide is fine when you do not `yield* AppStore` in-process:
Resource.httpServer([Process.serve(Daily, { effect: poll })], { protocol: "websocket" }).pipe(
  Layer.provide(AppStore.layer({ filename: ".effect-pm/data.sqlite" })),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3001 })),
)
```

| Intent | API |
|--------|-----|
| App journals + Logs | `Process.layer` / `serve` + `Layer.provide(Merge?)(AppStore.layer…)` |
| Ephemeral engine journal only | `Process.layerMemory` / `serveMemory` / `serveRemoteMemory` |
| SQLite | `AppStore.layer({ filename })` — `filename` is **required** |
| In-memory AppStore (+ Logs) | `AppStore.layerMemory` |

## Why bare soft-default was a footgun

Older toolkit layers **baked** `Store.layerDefaultMemory` with `provideMerge`. Two in-memory
`EventJournal` layers in one runtime share one journal, so `provideMerge(AppStore.layerMemory,
Process.layer)` looked like override while SQLite AppStores stayed empty — engines had already
captured the default bridge.

Now: `layer` leaves `Storage` as a requirement. `Layer.provide(AppStore)` / `provideMerge(AppStore)`
fills that requirement **before** capture. SQLite and memory AppStores both receive engine writes.

## One store per Node (intentional multi-node = N stores)

- One `Store.Service` per Node ManagedRuntime: many registrations, one journal/file, one `Logs.layer`.
- Multi-node demos (`examples/resource-web`) use **N** stores / **N** runtimes — each node its own
  `AppStore.layer*`.
- Do **not** install a second `Logs.layer` or second `Store.Service` in the same runtime.

## Logs vs `layerDefaultMemory`

`Store.layerDefaultMemory` (what `*Memory` toolkit layers use) is **engine observability only**.
It does **not** install `LogRelay` / durable `_logs` tails. Durable logs need
`Store.Service.layer*` (bakes `Logs.layer`) or an explicit `Logs.layer`.

Node journal + resource `_logs` copies of the same live line are intentional — see the logs guide.

## Reading back

- Process / queue execution rows: toolkit store handles (`store.events()`, …) or `Store.resolveOrDie`.
- Logs: `Logs.byNode` / `Logs.byResource` / `Resource.logs(tag)` — not a public `handle.log` shape
  (private `_logs`).

## Troubleshooting empty journals

| Symptom | Likely cause |
|---------|----------------|
| SQLite file empty after Process ran | Used `*Memory` engine layer, or never `Layer.provide(AppStore)` |
| `Resource.logs` empty | Missing `Node.logs` / `Process.store(tag)` registration on AppStore |
| Live logs but no durable rows | `Logs.layer` alone without store registration |
| Two buses / split history | Second `Logs.layer` or second `Store.Service` in the same runtime |
