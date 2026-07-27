# Storage

**Consumer guide (living book):** [`docs/guides/stores.md`](../guides/stores.md) → `/docs/stores`.

**Single source of truth for persistence in this package (agents).** Read this before changing `src/Store.ts`,
toolkit store registration (`*.store(tag)`), `src/store/*` legacy facets, or engine store wiring.

Verify: `pnpm run typecheck && pnpm test && pnpm run lint && pnpm build`

---

## Two planes (do not conflate)

| Plane | API | Backing | Who writes |
|-------|-----|---------|------------|
| **Store bridge (golden)** | `Store.Service`, `Storage`, `Tag.store(tag)` | `EventJournal` / `SqlEventJournal` via `layerDefaultMemory` or app `Store.layer` | **Toolkit engines** — Daemon, WorkPool, untyped WorkPool, Gate |
| **RuntimeStorage facets (legacy observability)** | `DaemonStorage`, `LogStore`, `ProcessLifecycleStore` | `RuntimeStorage` rows (`layerDaemonStore`, in-memory adapter) | Log relay, lifecycle hooks — **not** toolkit execution history |

Execution history for processes, queues, and run gates lives on the **Store bridge only**. The old
`ProcessExecutionStore`, `WorkPoolStore`, and `GateStore` **facet classes are deleted**
from `src/` — engines no longer dual-write to facet emitters.

Deep design: [`handoffs/store-cutover-00-store-core.md`](../handoffs/store-cutover-00-store-core.md) ·
guides: [`guides/store.md`](./guides/store.md), [`guides/store-backing.md`](./guides/store-backing.md).

---

## Golden model

### `Store.Service` + registration

Apps declare an aggregate store and register toolkit scopes:

```ts
import * as Store from "hyperlink-ts/Store";
import * as Daemon from "hyperlink-ts/Daemon";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Daemon.store(MyProcess),
  WorkPool.store(MyQueue),
) {}
```

Each toolkit exposes `Hyperlink.store(tag)` (and optional analytics extensions). Registration attaches
a **built-in contract** (`builtInDaemonStoreContract`, `builtInQueueStoreContract`, …) derived from
the tag's wire slots (`payload` / `success` / `error` where applicable).

Resolve handles:

- `yield* AppStore.at(Tag)` — tag-first on the aggregate
- `yield* Tag.store` — when the tag carries a `.store` attachment
- `Store.effects(scopeKey, contract)` — engine-internal materialization

### `Storage` — declared dependency, never `serviceOption`

`Storage` is a **defaulted service** (like `Clock`). Toolkit layers merge
`Store.layerDefaultMemory` via `Layer.provideMerge`, so engines always `yield* Storage` and
materialize handles — **no** `Effect.serviceOption(Storage)`, **no** forked-fiber store sniffing.

```ts
// Engine pattern (WorkPool.buildQueueImpl — representative)
const store = yield* materializeEngineQueueStoreForTag(tag);
// publishEvent → store.record / narrow writes (enqueued, completed, …)
```

Apps override the default at the root:

```ts
Layer.provideMerge(AppStore.layer({ filename: ".hyperlink-ts/data.sqlite" }), resourceLayers)
```

Later `Storage` layer wins on merge. Do not hard-provide inside a toolkit layer in a way that blocks
override.

### Tiers (per resource)

| Tier | Role | Example |
|------|------|---------|
| **1 — lean base** | One `event` shape → `record` + `events` | `builtInQueueStoreContract(tag)` |
| **2 — engine writes** | Narrow semantic methods (`completed`, `failed`, …) funnel to `event.append` | `makeEngineQueueStoreContract` / materialized writer |
| **3 — analytics** | `*.store(tag, extensions?)` read derivations over `event.read` | `WorkPool.store`, `Daemon.store` |

Tag wire is SSOT — layer config must not override `payload` / `success` / `error`
([`result-schema-and-rpc-validation.md`](../handoffs/result-schema-and-rpc-validation.md)).

### Toolkit layers

`layer` / `serve` / `serveRemote` on Daemon, WorkPool, WorkPool.Service (untyped), and Gate all
merge `Store.layerDefaultMemory` (Daemon via `withDefaultMemory`). Worker hyperlinks use
`Hyperlink.driver` + `grantLocal` where applicable.

**ShardMap** does **not** use the Store bridge for shard state. Local keys are SQLite SSOT
(`effect_pm_shard_map`) opened by the toolkit layer (`:memory:` by default, or `{ filename }`).
Boot `SELECT`s live rows; mutations `UPSERT` / `DELETE` — no event replay, no `ShardMap.store`.

**Future (not shipped):** queue write-path buffer off the worker hot path — see
[`handoffs/store-cutover-queue.md`](../handoffs/store-cutover-queue.md) §Future.

---

## What remains on `RuntimeStorage` facets

`DaemonStorage.layer` / `layerRuntimeStorage` composes **two** built-in facets only:

| Facet | Subpath | File | Purpose |
|-------|---------|------|---------|
| `LogStore` | `store/Log` | `src/store/log.ts` | Durable `log.entry` rows (relay / capture) |
| `ProcessLifecycleStore` | `store/ProcessLifecycle` | `src/store/processLifecycle.ts` | `process.lifecycle.changed` |

Aliases: `DaemonStorage.Log`, `DaemonStorage.ProcessLifecycle`.

**Removed from engine paths** (do not document as writers):

- `WorkPoolStore` — deleted; queue engine uses Store bridge
- `ProcessExecutionStore` — deleted; process engine uses `Daemon.store(tag)`
- `GateStore` facet — deleted; run engine uses `Gate.store(tag)`

The `hyperlink-ts/store/WorkPool` subpath was **removed** — there is no
`src/store/queueHyperlink.ts`. Import queue history via `WorkPool.store(tag)` on the Store bridge,
not a RuntimeStorage facet class.

Internal plumbing only: `src/internal/store/{spine,service,helpers,bridge,scopeBridge,memoryScope}.ts`.

---

## Per-toolkit store

### WorkPool + untyped WorkPool

- **Contract:** `builtInQueueStoreContract(tag)` — cast-free; full `QueueEvent<T>` lifecycle union
  (persisted == streamed). See [`handoffs/store-cutover-queue.md`](../handoffs/store-cutover-queue.md).
- **Engine:** `materializeEngineQueueStoreForTag` / `materializeEngineQueueStoreForItem` in
  `buildQueueImpl` / `buildUntypedWorkPoolImpl`; `publishEvent` → `recordToStore` at source
  (`src/internal/queueHyperlink.ts`).
- **Registration:** `WorkPool.store(tag)` / `WorkPool.store /* untyped .Service */(tag)` for Tier 3 analytics.
- **Tag:** config object `{ payload, success?, error? }` (+ lane fields on untyped WorkPool).

### Daemon

- **Contract:** `builtInDaemonStoreContract(tag)` — execution union (`Started` / `Completed` / …).
- **Engine:** `Store.effects` + contract in `buildProcessImpl` (`src/Daemon.ts`).
- **Registration:** `Daemon.store(tag)`.
- **Typed errors:** When the tag stamps an **`error`** schema, `Failed.error` is the typed value;
  otherwise the engine stringifies the cause (store-core §5). Manual **`effect`** RPC uses the same
  schemas when stamped (`buildProcessSpec`); scheduled/polling ticks still record failures to the store
  without failing the supervisor loop.
- **Handoff:** [`handoffs/store-cutover-daemon.md`](../handoffs/store-cutover-daemon.md).

### Gate

- **Contract:** `builtInGateStoreContract(tag)` — fact/state union.
- **Engine:** declared `Storage` + contract in `src/internal/runHyperlink.ts`.
- **Registration:** `Gate.store(tag)`.
- **Handoff:** [`handoffs/store-cutover-gate.md`](../handoffs/store-cutover-gate.md).

### ShardMap

- **No Store bridge.** Local shard rows are SQLite SSOT (`effect_pm_shard_map` in
  `src/internal/shardMapSql.ts`), opened by `ShardMap.layer` / `serve` / `serveRemote`.
- **Default:** `:memory:` (always on — an in-memory default carries value). Pass
  `{ filename }` for a durable file.
- **Engine:** boot `SELECT` by `scope_key` (= tag key); `putLocal` → `UPSERT`; `deleteLocal` →
  `DELETE`. Hot `Ref<Map>` cache only.

---

## Wire events (Store bridge)

### Queue / untyped WorkPool

One `event` shape per queue scope. Rows are the **`QueueEvent<T>`** tagged union the live `.events`
stream carries (`Enqueued`, `Started`, `Completed`, `Failed`, lifecycle, `RateLimitExceeded`, …).
Lane is on the entry, not a separate event union (untyped WorkPool shares the same union).

Optional `success` / `error` on persisted terminal rows follow tag presence
([`store-cutover-00-store-core.md`](../handoffs/store-cutover-00-store-core.md) §5).

**Not written anymore:** legacy `queue.entry.*`, `queue.lifecycle.*`, `queue.dedupe-key.*`,
`queue.ratelimit.exceeded` **RuntimeStorage** facet types — those were the old facet plane.

### Daemon

`Started` / `Completed` / `Failed` / `Interrupted` rows on `Daemon.store(tag)`; auto-append from
`Daemon.layer` / `serve` / `serveRemote` via baked-in default memory store.

### Gate

Gate run facts appended to `Gate.store(tag)` when a gate executes.

**Not on the Store bridge:** ShardMap local keys — SQLite table `effect_pm_shard_map` (see
ShardMap section above).

---

## Usage

### App store + process auto-write

From `examples/forms/process-store/process-layer-store-auto-write.ts`:

```ts
import * as Store from "hyperlink-ts/Store";
import * as Daemon from "hyperlink-ts/Daemon";

class DemoStore extends Store.Service<DemoStore>("@examples/DemoStore")(
  Daemon.store(PricesProcess),
) {}

const live = Layer.provideMerge(
  DemoStore.layerMemory,
  Daemon.layer(PricesProcess, { effect, polling }),
);

const store = yield* DemoStore.at(PricesProcess);
const events = yield* store.events();
```

`Daemon.layer` merges `layerDefaultMemory` — events land even without a custom `AppStore` until you
override with `Layer.provideMerge(AppStore.layer(...), ...)`.

### Queue persist + read back

```ts
import * as WorkPool from "hyperlink-ts/WorkPool";
import * as Store from "hyperlink-ts/Store";

class Mail extends WorkPool.Tag<Mail>()("@app/Mail", { payload: JobSchema }) {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  WorkPool.store(Mail),
) {}

// Layer includes materialized engine store + layerDefaultMemory
Effect.provide(program, WorkPool.layer(Mail, { effect, autoStart: true }));

const store = yield* AppStore.at(Mail);
const events = yield* store.events();
```

Or register on an app aggregate: `class AppStore extends Store.Service(...)(
  WorkPool.store(Mail),
) {}` then `yield* AppStore.at(Mail)`.

### Legacy facets (log + lifecycle only)

```ts
import { DaemonStorage } from "hyperlink-ts";
import { layerDaemonStore } from "hyperlink-ts/storage/sqlite";

// In-memory (tests)
Effect.provide(program, DaemonStorage.layer);

// Durable RuntimeStorage + facets
Effect.provide(
  program,
  Layer.provide(DaemonStorage.layerRuntimeStorage, layerDaemonStore({ filename: ".hyperlink-ts/data.sqlite" })),
);
```

Facet reads still use `Effect.serviceOption(LogStore)` / `yield* ProcessLifecycleStore` where the
facet is optional observability — **distinct** from `Storage` on the Store bridge.

### Durable toolkit store (SQLite)

```ts
class AppStore extends Store.Service<AppStore>("@app/Store")(
  Daemon.store(MyProcess),
  WorkPool.store(MyQueue),
) {}

const live = Layer.provideMerge(
  AppStore.layer({ filename: ".hyperlink-ts/process.db" }),
  Daemon.layer(MyProcess, { effect }),
  WorkPool.layer(MyQueue, { effect }),
);
```

---

## Optional ports (separate from Store bridge)

| Port | Role |
|------|------|
| `HistoryStore` | Metrics/logs history sidecar (optional `serviceOption` in toolkit impls) |
| `DurableQueueStore` | Durability plane for queue refill (`serviceOption` — correct here) |
| `layerDaemonStore` | SQLite adapter for **RuntimeStorage** facets |

---

## Authoring notes

- **New toolkit persistence:** `builtIn*StoreContract(tag)` + `materializeEngine*` or `Store.effects`;
  declare `Storage`; merge `layerDefaultMemory` on public layers.
- **Do not:** `serviceOption(Storage)` in engines; facet dual-write; positional tag schema overloads.
- **Tests:** `test/store-default.test.ts`, `test/queue-store-persist.test.ts`,
  `test/custom-queue-store-persist.test.ts`, `test/process-store-default-override.test.ts`.

---

## Pending work

Future items: [`plans/README.md`](../plans/README.md) — Postgres adapters,
queue write-buffer, richer history vocabulary. Implemented Store-bridge behavior belongs in this file
and toolkit handoffs, not `docs/plans/`.
