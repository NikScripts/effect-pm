# Storage

**Consumer guide (living book):** [`docs/guides/stores.md`](../guides/stores.md) → `/docs/stores`.

**Single source of truth for persistence in this package (agents).** Read this before changing `src/Store.ts`,
toolkit store registration (`*.store(tag)`), `src/store/*` legacy facets, or engine store wiring.

Verify: `pnpm run typecheck && pnpm test && pnpm run lint && pnpm build`

---

## Two planes (do not conflate)

| Plane | API | Backing | Who writes |
|-------|-----|---------|------------|
| **Store bridge (golden)** | `Store.Service`, `Storage`, `Tag.store(tag)` | `EventJournal` / `SqlEventJournal` via `layerDefaultMemory` or app `Store.layer` | **Toolkit engines** — Process, Queue, CustomQueue, RunResource |
| **RuntimeStorage facets (legacy observability)** | `ProcessStorage`, `LogStore`, `ProcessLifecycleStore` | `RuntimeStorage` rows (`layerProcessStore`, in-memory adapter) | Log relay, lifecycle hooks — **not** toolkit execution history |

Execution history for processes, queues, and run gates lives on the **Store bridge only**. The old
`ProcessExecutionStore`, `QueueResourceStore`, and `RunResourceStore` **facet classes are deleted**
from `src/` — engines no longer dual-write to facet emitters.

Deep design: [`handoffs/store-cutover-00-store-core.md`](../handoffs/store-cutover-00-store-core.md) ·
guides: [`guides/store.md`](./guides/store.md), [`guides/store-backing.md`](./guides/store-backing.md).

---

## Golden model

### `Store.Service` + registration

Apps declare an aggregate store and register toolkit scopes:

```ts
import * as Store from "hyperlink-ts/Store";
import * as Process from "hyperlink-ts/Process";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(MyProcess),
  QueueResource.store(MyQueue),
) {}
```

Each toolkit exposes `Hyperlink.store(tag)` (and optional analytics extensions). Registration attaches
a **built-in contract** (`builtInProcessStoreContract`, `builtInQueueStoreContract`, …) derived from
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
// Engine pattern (QueueResource.buildQueueImpl — representative)
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
| **3 — analytics** | `*.store(tag, extensions?)` read derivations over `event.read` | `QueueResource.store`, `Process.store` |

Tag wire is SSOT — layer config must not override `payload` / `success` / `error`
([`result-schema-and-rpc-validation.md`](../handoffs/result-schema-and-rpc-validation.md)).

### Toolkit layers

`layer` / `serve` / `serveRemote` on Process, QueueResource, CustomQueueResource, and RunResource all
merge `Store.layerDefaultMemory` (Process via `withDefaultMemory`). Worker resources use
`Hyperlink.builtHyperlink` + `grantLocal` where applicable.

**ShardMap** does **not** use the Store bridge for shard state. Local keys are SQLite SSOT
(`effect_pm_shard_map`) opened by the toolkit layer (`:memory:` by default, or `{ filename }`).
Boot `SELECT`s live rows; mutations `UPSERT` / `DELETE` — no event replay, no `ShardMap.store`.

**Future (not shipped):** queue write-path buffer off the worker hot path — see
[`handoffs/store-cutover-queue.md`](../handoffs/store-cutover-queue.md) §Future.

---

## What remains on `RuntimeStorage` facets

`ProcessStorage.layer` / `layerRuntimeStorage` composes **two** built-in facets only:

| Facet | Subpath | File | Purpose |
|-------|---------|------|---------|
| `LogStore` | `store/Log` | `src/store/log.ts` | Durable `log.entry` rows (relay / capture) |
| `ProcessLifecycleStore` | `store/ProcessLifecycle` | `src/store/processLifecycle.ts` | `process.lifecycle.changed` |

Aliases: `ProcessStorage.Log`, `ProcessStorage.ProcessLifecycle`.

**Removed from engine paths** (do not document as writers):

- `QueueResourceStore` — deleted; queue engine uses Store bridge
- `ProcessExecutionStore` — deleted; process engine uses `Process.store(tag)`
- `RunResourceStore` facet — deleted; run engine uses `RunResource.store(tag)`

The `hyperlink-ts/store/QueueResource` subpath was **removed** — there is no
`src/store/queueResource.ts`. Import queue history via `QueueResource.store(tag)` on the Store bridge,
not a RuntimeStorage facet class.

Internal plumbing only: `src/internal/store/{spine,service,helpers,bridge,scopeBridge,memoryScope}.ts`.

---

## Per-toolkit store

### QueueResource + CustomQueueResource

- **Contract:** `builtInQueueStoreContract(tag)` — cast-free; full `QueueEvent<T>` lifecycle union
  (persisted == streamed). See [`handoffs/store-cutover-queue.md`](../handoffs/store-cutover-queue.md).
- **Engine:** `materializeEngineQueueStoreForTag` / `materializeEngineQueueStoreForItem` in
  `buildQueueImpl` / `buildCustomQueueImpl`; `publishEvent` → `recordToStore` at source
  (`src/internal/queueResource.ts`).
- **Registration:** `QueueResource.store(tag)` / `CustomQueueResource.store(tag)` for Tier 3 analytics.
- **Tag:** config object `{ payload, success?, error? }` (+ lane fields on CQR).

### Process

- **Contract:** `builtInProcessStoreContract(tag)` — execution union (`Started` / `Completed` / …).
- **Engine:** `Store.effects` + contract in `buildProcessImpl` (`src/Process.ts`).
- **Registration:** `Process.store(tag)`.
- **Typed errors:** When the tag stamps an **`error`** schema, `Failed.error` is the typed value;
  otherwise the engine stringifies the cause (store-core §5). Manual **`effect`** RPC uses the same
  schemas when stamped (`buildProcessSpec`); scheduled/polling ticks still record failures to the store
  without failing the supervisor loop.
- **Handoff:** [`handoffs/store-cutover-process.md`](../handoffs/store-cutover-process.md).

### RunResource

- **Contract:** `builtInRunResourceStoreContract(tag)` — fact/state union.
- **Engine:** declared `Storage` + contract in `src/internal/runResource.ts`.
- **Registration:** `RunResource.store(tag)`.
- **Handoff:** [`handoffs/store-cutover-runresource.md`](../handoffs/store-cutover-runresource.md).

### ShardMap

- **No Store bridge.** Local shard rows are SQLite SSOT (`effect_pm_shard_map` in
  `src/internal/shardMapSql.ts`), opened by `ShardMap.layer` / `serve` / `serveRemote`.
- **Default:** `:memory:` (always on — an in-memory default carries value). Pass
  `{ filename }` for a durable file.
- **Engine:** boot `SELECT` by `scope_key` (= tag key); `putLocal` → `UPSERT`; `deleteLocal` →
  `DELETE`. Hot `Ref<Map>` cache only.

---

## Wire events (Store bridge)

### Queue / CustomQueue

One `event` shape per queue scope. Rows are the **`QueueEvent<T>`** tagged union the live `.events`
stream carries (`Enqueued`, `Started`, `Completed`, `Failed`, lifecycle, `RateLimitExceeded`, …).
Lane is on the entry, not a separate event union (CQR shares the same union).

Optional `success` / `error` on persisted terminal rows follow tag presence
([`store-cutover-00-store-core.md`](../handoffs/store-cutover-00-store-core.md) §5).

**Not written anymore:** legacy `queue.entry.*`, `queue.lifecycle.*`, `queue.dedupe-key.*`,
`queue.ratelimit.exceeded` **RuntimeStorage** facet types — those were the old facet plane.

### Process

`Started` / `Completed` / `Failed` / `Interrupted` rows on `Process.store(tag)`; auto-append from
`Process.layer` / `serve` / `serveRemote` via baked-in default memory store.

### RunResource

Gate run facts appended to `RunResource.store(tag)` when a gate executes.

**Not on the Store bridge:** ShardMap local keys — SQLite table `effect_pm_shard_map` (see
ShardMap section above).

---

## Usage

### App store + process auto-write

From `examples/forms/process-store/process-layer-store-auto-write.ts`:

```ts
import * as Store from "hyperlink-ts/Store";
import * as Process from "hyperlink-ts/Process";

class DemoStore extends Store.Service<DemoStore>("@examples/DemoStore")(
  Process.store(PricesProcess),
) {}

const live = Layer.provideMerge(
  DemoStore.layerMemory,
  Process.layer(PricesProcess, { effect, polling }),
);

const store = yield* DemoStore.at(PricesProcess);
const events = yield* store.events();
```

`Process.layer` merges `layerDefaultMemory` — events land even without a custom `AppStore` until you
override with `Layer.provideMerge(AppStore.layer(...), ...)`.

### Queue persist + read back

```ts
import * as QueueResource from "hyperlink-ts/QueueResource";
import * as Store from "hyperlink-ts/Store";

class Mail extends QueueResource.Tag<Mail>()("@app/Mail", { payload: JobSchema }) {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  QueueResource.store(Mail),
) {}

// Layer includes materialized engine store + layerDefaultMemory
Effect.provide(program, QueueResource.layer(Mail, { effect, autoStart: true }));

const store = yield* AppStore.at(Mail);
const events = yield* store.events();
```

Or register on an app aggregate: `class AppStore extends Store.Service(...)(
  QueueResource.store(Mail),
) {}` then `yield* AppStore.at(Mail)`.

### Legacy facets (log + lifecycle only)

```ts
import { ProcessStorage } from "hyperlink-ts";
import { layerProcessStore } from "hyperlink-ts/storage/sqlite";

// In-memory (tests)
Effect.provide(program, ProcessStorage.layer);

// Durable RuntimeStorage + facets
Effect.provide(
  program,
  Layer.provide(ProcessStorage.layerRuntimeStorage, layerProcessStore({ filename: ".hyperlink-ts/data.sqlite" })),
);
```

Facet reads still use `Effect.serviceOption(LogStore)` / `yield* ProcessLifecycleStore` where the
facet is optional observability — **distinct** from `Storage` on the Store bridge.

### Durable toolkit store (SQLite)

```ts
class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(MyProcess),
  QueueResource.store(MyQueue),
) {}

const live = Layer.provideMerge(
  AppStore.layer({ filename: ".hyperlink-ts/process.db" }),
  Process.layer(MyProcess, { effect }),
  QueueResource.layer(MyQueue, { effect }),
);
```

---

## Optional ports (separate from Store bridge)

| Port | Role |
|------|------|
| `HistoryStore` | Metrics/logs history sidecar (optional `serviceOption` in toolkit impls) |
| `DurableQueueStore` | Durability plane for queue refill (`serviceOption` — correct here) |
| `layerProcessStore` | SQLite adapter for **RuntimeStorage** facets |

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
