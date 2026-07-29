{#stores title="Stores" status="draft" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/stores>.
<!-- docs-site-link:end -->
# Stores

How Hyperlink persists data — journals, WorkPool durability, history backfill, Redis
rate limits, and engine-owned SQL. Persistence *shapes* (append/read vs custom store vs
engine-owned keyed SQL) are locked in [`docs/standards/storage.md`](/docs/storage). Log fans
and `_logs` tails live in [Logs](/docs/logs).

There is **no** `ProcessStore`, public `LogStore`, or `store/Log` facet. Those were retired.
Toolkit history goes through `Store.Service` + `Daemon.store` / `WorkPool.store` / `Gate.store`
/ `Node.logs`. Custom backends that have no useful in-memory default use
`Effect.serviceOption` (presence-driven): provide the layer or get nothing.

## The four wiring patterns

| # | Pattern | When | Opt-in? |
|---|---------|------|---------|
| **1** | **`Store.Service` journal** | Engine observability, execution/queue/gate history, durable logs | Soft in-memory default; override with AppStore |
| **2** | **Custom port + `serviceOption`** | Semantics journals cannot express (leasing, at-least-once priority, rate-limit fleet) | Provide the backend layer or nothing |
| **3** | **Engine-owned keyed SQL** | Current keyed state (a Map of live rows), not an event log | `:memory:` default; `{ filename }` for durable |
| **4** | **Effect Redis peers** | Fleet rate limit (and Effect `Persistence` / `PersistedQueue` smokes) | Compose Effect layers; not Hyperlink ports |

## 1. `Store.Service` — Soft journals

Toolkit engines (`Daemon` / `WorkPool` / `Gate` `layer` / `serve` / `serveRemote`)
**soft-default** `Store.layerDefaultMemory` via `Store.withDefaultStorage` — **R is fulfilled**
out of the box. `*Memory` variants are aliases of the same soft-default (ephemeral engine
journal — **no** Logs platform).

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

Registrations you put on the `Store.Service`:

| Registration | What it journals |
|--------------|------------------|
| `Node.logs` / `Hyperlink.store(Node)` | Durable `_logs` tails for that node |
| `Daemon.store(tag)` | Daemon tick timeline (`Started` / `Completed` / …) |
| `WorkPool.store(tag)` | WorkPool analytics / lifecycle rows |
| `Gate.store(tag)` | Gate analytics rows |

Single vs multi handle:

- Bare registration: `WorkPool.store(Mail)` → `yield* MailStore`
- Tag-keyed array: `[WorkPool.store(Mail), …]` → `yield* AppStore.at(Mail)`
- Custom keys: `{ mail: WorkPool.store(Mail), … }` → `yield* AppStore.at("mail")`

### Why sibling merge was a footgun

Older toolkit layers **always baked** `Layer.provideMerge(layerDefaultMemory)` inside the engine
layer. Soft never saw an ambient AppStore, so SQLite AppStores stayed empty while two in-memory
journals looked like a working “override” (shared `EventJournal`).

Now Soft unwrap peeks at ambient `Storage` at build time:

- No AppStore in context → bake `layerDefaultMemory` (**R fulfilled**).
- AppStore fed via `Layer.provide` / `provideMerge` **into** the toolkit layer → engines capture that store (memory + Logs, or SQLite).

**Do not** sibling-`Layer.merge` the toolkit layer with AppStore and expect override — Soft never sees `Storage`, engines stay on the default journal, and the AppStore file stays empty.

**Do not** Soft-override with a Node-logs-only `Store.Service` unless that store also registers the engines you run — Soft captures that bridge and toolkit layers **die at build** (`Store.resolveOrDie`) when the engine scope is missing. Live-only log bus: `Logs.layer` (no `Storage`). Durable journals: one AppStore with `Node.logs` + `Daemon.store` / `WorkPool.store` / ….

### One store per Node

- One `Store.Service` per Node ManagedRuntime: many registrations, one journal/file, one `Logs.layer`.
- Multi-node demos use **N** stores / **N** runtimes — each node its own `AppStore.layer*`.
- Do **not** install a second `Logs.layer` or second `Store.Service` in the same runtime.

### Logs vs `layerDefaultMemory`

`Store.layerDefaultMemory` (what soft-default / `*Memory` toolkit layers use) is **engine observability only**.
It does **not** install `Logs.Relay` / durable `_logs` tails. Durable logs need
`Store.Service.layer*` (bakes `Logs.layer`) or an explicit `Logs.layer`.

Node journal + per-service `_logs` copies of the same live line are intentional — see the logs guide.

### Reading back

- Daemon / WorkPool execution rows: toolkit store handles (`store.events()`, …) or `Store.resolveOrDie`.
- App-facing queries after override: `yield* AppStore` / registration helpers.

## 2. Custom ports — `serviceOption` (no Soft default)

When an in-memory “durable” store would be pointless, the backend is **presence-driven**:
`Effect.serviceOption(Port)` inside the engine. Provide the layer → on. Omit it → off.
This is **not** the Soft/`Storage` path and **not** a Tag config field.

### WorkPool durability — `DurableWorkPoolStore` (SQL)

Pending + in-flight work that must survive a restart (at-least-once + dedup). Port:
`hyperlink-ts/DurableWorkPoolStore`. SQLite backend: `SQLiteDurableWorkPoolStore` from
`hyperlink-ts/storage/sqlite`.

Requires a `payload` / `itemSchema` on the WorkPool tag so entries can serialize. Compose the
backend onto the WorkPool layer — the layer *is* the switch:

```ts
import * as WorkPool from "hyperlink-ts/WorkPool"
import { SQLiteDurableWorkPoolStore } from "hyperlink-ts/storage/sqlite"

const live = WorkPool.layer(Mail, { /* … */ }).pipe(
  Layer.provide(SQLiteDurableWorkPoolStore.layer({ filename: "queue.db" })),
)
```

This is a **different plane** from Soft `WorkPool.store(Mail)` on an AppStore (observability /
analytics). You can run durability alone, Soft journals alone, or both. Consumer analytics reads
are listed on [WorkPool](/docs/work-pools#persistence-and-analytics).

### History backfill — `HistoryStore`

Keyed append-log for stream history (metrics windows, etc.). Port: `hyperlink-ts/HistoryStore`
(`HistoryStore.layerMemory()`, or `SQLiteHistoryStore` from `hyperlink-ts/storage/sqlite`).
Engines read it via `serviceOption(HistoryStore)` — omit the layer and `*History` / windowed
`metrics.query` backfill stay empty.

Provide onto the WorkPool / Daemon / Gate layer that should capture windows:

```ts
import { HistoryStore } from "hyperlink-ts"
import { SQLiteHistoryStore } from "hyperlink-ts/storage/sqlite"
import { Layer } from "effect"

Layer.provide(HistoryStore.layerMemory())
// or: Layer.provide(SQLiteHistoryStore.layer({ filename: "history.db" }))
```

### Fleet rate limit — Effect `RateLimiterStore` (Redis)

Gate / WorkPool / HttpApiClient rate limits take **policy** on the tag (`rateLimit: { limit,
window, … }`). The store is a Context service: Soft in-memory limiter when absent; for a shared
fleet limit provide Effect Redis:

```ts
import {
  layerStoreRedis as rateLimiterStoreRedis,
} from "effect/unstable/persistence/RateLimiter"
import { NodeRedis } from "@effect/platform-node"

const FleetLive = Layer.mergeAll(EastGate.layer, WestGate.layer).pipe(
  Layer.provide(rateLimiterStoreRedis({ prefix: "fleet:" })),
  Layer.provide(NodeRedis.layer({ host: "127.0.0.1", port: 6379 })),
)
```

See [Gates](/docs/gates) for the full Redis recipe and live suites.

## 3. Engine-owned keyed SQL — `ShardMap`

Current keyed state (a Map of live rows), not an event journal. The engine owns a SQLite table
directly (`hyperlink_ts_shard_map`). Default client is `:memory:`; pass `{ filename }` for
crash-surviving durability. No `Store.Service`, no separate store port. See [ShardMap](/docs/shardmap).

## 4. Effect Redis peers (compose, not Hyperlink ports)

Hyperlink WorkPool durability remains **SQLite `DurableWorkPoolStore`** today. Effect’s own
`Persistence.layerRedis` / `PersistedQueue.layerStoreRedis` are available for apps that want those
Effect surfaces — covered by `test/effect-redis-stores.test.ts`. They are not Hyperlink storage
ports and do not replace `DurableWorkPoolStore` or `Store.Service`.

## Exports

| Subpath | Role |
|---------|------|
| `hyperlink-ts/Store` | Soft journals — `Store.Service`, Soft default, registrations |
| `hyperlink-ts/DurableWorkPoolStore` | WorkPool durability port |
| `hyperlink-ts/HistoryStore` | Stream history port (`layerMemory`) |
| `hyperlink-ts/storage/sqlite` | `SQLiteDurableWorkPoolStore`, `SQLiteHistoryStore` |
| Effect `RateLimiter` + `@effect/platform-node` Redis | Fleet rate-limit store |

## Cutover history

Historical Store-bridge / facet-retirement decisions live under
[`docs/handoffs/store-cutover-00-store-core.md`](../handoffs/store-cutover-00-store-core.md) and
sibling `store-cutover-*.md` files — **prefer this guide** when they disagree. Do not revive
`DaemonStorage` / `LogStore` / `ProcessLifecycleStore`.

## Related

- [Logs](/docs/logs) — fans, `_logs`, `Hyperlink.logs`
- [Storage & Persistence](/docs/storage) (standards) — the three approved shapes
- [WorkPool](/docs/work-pools) · [Daemon](/docs/daemons) · [Gate](/docs/gates) · [ShardMap](/docs/shardmap)
