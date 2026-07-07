# Store cutover — Store core (shared decisions for all resource agents)

**Read this first.** The Process / Queue / RunResource / CustomQueue cutover reports all depend on
the decisions here. Companion to `result-schema-and-rpc-validation.md` (naming) and
`queue-persistence-design.md` (two-plane model).

## Done and on the integration branch

- **Store Stage 1 — default in-memory backing.** `layerDefaultMemory` (`internal/store/scopeBridge.ts`,
  `buildDefaultScopeBridge`) provides `StoreScopeBridgeTag` from one in-memory `EventJournal`, materializing
  any scope on demand. `store-default.test.ts` proves it. **This is the always-present default** — see the
  resolution decision below.
- **Precise handle resolution (tightening).** `bridge.at` is generic (`at<Input>(scopeKey, input)` →
  `StoreHandleOf<Input>`); `Tag.store` / `Resource.store` / `AppStore.at(tag)` return the **precise**
  `Store.HandleOf<contract>`. Removes the consumer casts (see "Action for every module").

## Decisions locked

### 1. The Store is a **defaulted service** — NEVER `serviceOption`

The store is **always in context**, exactly like `Clock` / `Logger` / `Random`: `layerDefaultMemory` is the
default (in-memory), a real `Store.Service` overrides it. So **there is no "is there a store?" question** —
and therefore **no `Effect.serviceOption(StoreScopeBridgeTag)` anywhere, no `Option.match`, no no-op branch.**

- Engines resolve the store as a **plain declared dependency**: `const bridge = yield* StoreScopeBridgeTag`.
  Because it is always provided, the `yield*` always succeeds.
- "No store wired" is not `Option.none` — it is the default implementation doing its thing.
- **Emit path never sniffs.** Resolve once (as a dependency), emit unconditionally.

**This also dissolves the deadlock.** Resolving the store via `serviceOption` *inside a layer build* races
a concurrent `AppStore.at(tag)` and locks the scoped `EventJournal` (verified on the queue). A **declared
dependency** is built in topological order and memoized, so the store builds first and every reader reuses
the same instance — no race, no forked-fiber trick, no lazy per-event resolution.

### 2. Provision — app root, not baked into the resource layer

The resource layer **requires** `StoreScopeBridgeTag` (its `RIn` includes it — no longer `never`). The **app**
provides one at the root: `layerDefaultMemory` (default) **or** its own `Store.Service` (override). Do **not**
`Layer.provide(layerDefaultMemory)` *inside* the resource layer — that hard-provides and blocks the app from
overriding.

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
- **No `serviceOption` on `StoreScopeBridgeTag`.** Resolve it as a declared dependency (§1). (`serviceOption`
  is still correct for the **durability** plane — `DurableQueueStore` — and irrelevant for the legacy facets
  being deleted.)

## Who is currently wrong (2026-07-07)

- **RunResource** — `internal/runResourceStoreTap.ts:80` resolves the new store with
  `Effect.serviceOption(StoreScopeBridgeTag)` + `.at().pipe(Effect.option)`, *and* casts the handle. Both go
  (see its report).
- Legacy-facet `serviceOption` calls (`HistoryStore` / `ProcessExecutionStore` / `QueueResourceStore` /
  `LogStore`) are being **deleted** in the cutover — not this rule's concern.
- Durability `serviceOption(DurableQueueStore)` is **correct** — leave it.

## Store-core TODO

- [ ] (Doc step E) Decide `success` persistence: does the store `Completed`/`RunCompleted` row carry the
      worker/run `success` value (the tag's `success` schema threaded into the event union)?
