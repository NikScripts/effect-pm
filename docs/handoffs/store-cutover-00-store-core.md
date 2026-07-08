# Store cutover — Store core (shared decisions for all resource agents)

**Read this first.** The Process / Queue / RunResource / CustomQueue cutover reports all depend on
the decisions here. Companion to `result-schema-and-rpc-validation.md` (naming) and
`queue-persistence-design.md` (two-plane model).

## Done and on the integration branch

- **Store Stage 1 — default in-memory backing.** `layerDefaultMemory` (`Store.ts`,
  `buildDefaultScopeBridge`) provides {@link Storage} from one in-memory `EventJournal`, materializing
  any scope on demand. `store-default.test.ts` proves it. **This is the always-present default** — see the
  resolution decision below.
- **Precise handle resolution (tightening).** `bridge.at` is generic (`at<Input>(scopeKey, input)` →
  `StoreHandleOf<Input>`); `Tag.store` / `Resource.store` / `AppStore.at(tag)` return the **precise**
  `Store.HandleOf<contract>`. Removes the consumer casts (see "Action for every module").
- **`Storage` public API** — {@link Storage}, {@link StorageApi}, and {@link layerDefaultMemory} are
  `@public` so third-party engines declare the bridge as a dependency (`withDefault` / `withStorage`).

## Decisions locked

### 1. The Store is a **defaulted service** — NEVER `serviceOption`

The store is **always in context**, exactly like `Clock` / `Logger` / `Random`: `layerDefaultMemory` is the
default (in-memory), a real `Store.Service` overrides it. So **there is no "is there a store?" question** —
and therefore **no `Effect.serviceOption(Storage)` anywhere, no `Option.match`, no no-op branch.**

- Engines resolve the store as a **plain declared dependency**: `yield* Storage` or
  `yield* Store.withDefault(scopeKey, contract)`. Because it is always provided, the `yield*` always succeeds.
- "No store wired" is not `Option.none` — it is the default implementation doing its thing.
- **Emit path never sniffs.** Resolve once (as a dependency), emit unconditionally.

**This also dissolves the deadlock.** Resolving the store via `serviceOption` *inside a layer build* races
a concurrent `AppStore.at(tag)` and locks the scoped `EventJournal` (verified on the queue). A **declared
dependency** is built in topological order and memoized, so the store builds first and every reader reuses
the same instance — no race, no forked-fiber trick, no lazy per-event resolution.

### 2. Provision — `layerDefaultMemory` baked into toolkit layers

Every worker resource layer **requires** {@link Storage} in its dependency graph. Toolkit entry points merge
{@link Store.layerDefaultMemory} via `Layer.provideMerge` so gates work out of the box:

- **Process:** `Process.layer` / `serve` / `serveRemote` via `withDefaultMemory`.
- **RunResource:** `RunResource.layer` / `serve` / `Service.layer`.
- **QueueResource:** `QueueResource.layer` / `serve` / `serveRemote`.

A real `AppStore` at the app root **overrides** the default by plain merge
(`Layer.provideMerge(AppStore.layerMemory, Resource.layer(...))` — later layer wins on `Storage`). Do **not**
hard-provide inside the resource layer in a way that blocks override.

### 3. Tag is the SSOT for wire schemas (`payload`/`success`/`error`)

Engine/layer config may accept schemas *internally* (bootstrapping without a tag, tests), but must not
advertise schema overrides — overriding a tag's schema at `layer()` is unsafe for RPC
(`result-schema-and-rpc-validation.md` §3).

### 4. One `event` shape per resource store, tagged-union row, `record`/`events` handle

Persist the same event the live surface emits (queue: `QueueEvent<T>`; process: execution union; run:
fact/state union).

## Action for EVERY module

- **Cast removal.** With the tightening, `... as BuiltInXContract` is unnecessary. Mirror
  `builtInQueueStoreContract` (cast-free). `processStoreSpec.ts` still has `... as BuiltInProcessContract` —
  delete it; RunResource's contract likewise.
- **No `serviceOption` on `Storage`.** Resolve it as a declared dependency (§1). (`serviceOption`
  is still correct for the **durability** plane — `DurableQueueStore` — and irrelevant for the legacy facets
  being deleted.)

## Who is currently wrong (2026-07-07)

- ~~**RunResource** — `internal/runResourceStoreTap.ts` resolves with `serviceOption` + handle cast~~ **Fixed**
  on run-resource branch: declared `Storage` dependency, cast-free contract, **`RunResourceStore` facet deleted**,
  `layerDefaultMemory` merged into layer entry points.
- ~~**Process** — still on `ProcessExecutionStore` only~~ **Fixed** on integration branch: `processStoreTap.ts`,
  **`ProcessExecutionStore` facet deleted**, `withDefaultMemory` on toolkit layers.
- **Queue** — engine still writes legacy `QueueResourceStore` facet for some paths; store bridge tap + facet
  deletion tracked in `store-cutover-queue.md`.
- Legacy-facet `serviceOption` calls (`HistoryStore` / `QueueResourceStore` /
  `LogStore`) are being **deleted** in the cutover — not this rule's concern.
- Durability `serviceOption(DurableQueueStore)` is **correct** — leave it.

### 5. Store event wire — `_tag`, `success`, `error` (locked 2026-07-07)

Persisted store rows use the **same slot names as the tag factory** (`success`, `error`) and
**PascalCase `_tag`** discriminators. Tag config and store wire align — no `result` on
`RunCompleted` / `Completed`.

| Convention | Rule |
|------------|------|
| **`_tag`** | PascalCase only — `RunCompleted`, `RunFailed`, `Completed`, `Failed`, `RunStarted`, … Retire kebab `type` strings (`run-resource.run.failed`, …). **RunResource** store facts still need this migration; handle API (`record` / `facts` / `stateHistory`) is correct. |
| **`success`** | Present on terminal success rows **iff** the tag declares a `success` schema. Field name is `success` (not `result`). Value is the **decoded** worker/run return — journal encodes on append. |
| **`error`** | Always on terminal failure rows. Presence-driven by the tag's `error` schema (see below). |

#### `error` encoding (locked — Process, Queue, RunResource store rows)

One rule for all worker resources:

1. **Extract** the failure value once at the engine:
   `Option.getOrElse(Cause.findErrorOption(cause), () => Cause.squash(cause))`.
2. **Tag declares `error` schema** → store row carries **decoded typed `error`** (the fail-channel
   value). Pass the raw object to `store.record`; the contract's `error` field uses the tag schema;
   the journal **encodes on append** — never pre-encode to JSON/string at the tap.
3. **Tag has no `error` schema** → store row carries **`error: Schema.String`** with
   `String(extracted)` — human-readable fallback, not `Cause.pretty` of the full tree, not
   `Schema.Cause` on the wire.

Queue `Failed` without an `error` schema uses the same `error: string` field (not a separate
`cause` column on the persisted row). Live `.events` streams may still carry rich `Cause`/`Exit`
for subscribers; the **store row** follows the rule above.

**Not the live-handle `result` ref:** Process's reactive `result` Subscribable (latest success
`Option`) is unrelated — only the persisted `RunCompleted.success` field follows this table.

## Store-core TODO

- [x] `success` persistence — terminal rows carry optional `success` when the tag stamps `success`.
- [x] `error` encoding — presence-driven typed vs `String` fallback (§5).

## Proposals (informational — owner approval required)

- **Layer query / bulk read** — draft design for multi-scope and whole-layer reads on EventJournal
  `Store`. **Not approved for implementation.** See [`store-layer-query.md`](./store-layer-query.md).
  Store agent: refine or replace; do not ship public API without owner sign-off.
