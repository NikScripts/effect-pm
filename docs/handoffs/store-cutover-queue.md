# Store cutover — WorkPool (typed queue) (my target)

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

Prereq: `store-cutover-00-store-core.md` (shared decisions — **the store is a defaulted service; resolve it
as a declared dependency; NEVER `serviceOption`**).

## Owner decisions LOCKED (2026-07-06)

1. **Event taxonomy = full lifecycle.** The store persists the whole `QueueEvent<T>` union the live
   `.events` stream carries (per-entry + `Start`/`Drained`/`Cleared`/`Shutdown*` lifecycle + `RateLimitExceeded`).
   Not entry-only. SSOT — persisted == streamed. `builtInQueueStoreContract` already does this.
2. **`success`/`error` = full capture, presence-driven by the tag schema** (`store-cutover-00-store-core.md`
   §5). When the tag declares `success`, the worker return is captured on `Completed.success` and persisted.
   When it declares `error`, `Failed.error` carries the decoded typed error (journal encodes on append).
   No `success` schema → `Completed { entry, elapsed }` only. No `error` schema → `Failed.error: string`
   (`String` of `findErrorOption` / `squash`), not a separate `cause` field on the store row. Mirrors
   `makeProcessExecutionEvent(success, error)` — optional typed fields appear iff the schema is present.
3. **untyped WorkPool** shares optional `success` / `error` on the config object (no positional schemas) — see
   `store-cutover-workpool-untyped.md`.
4. **Always write thorough tests** — no approval needed for tests, ever.

## Done

- `builtInQueueStoreContract(tag)` — one `event` shape persisting the shared `QueueEvent<T>` union
  (`record`/`events`), **cast-free** (the reference other modules mirror to drop their casts).
- Store tightening + `layerDefaultMemory` (shipped; see store-core report).
- [x] `buildQueueImpl` resolves the store via `materializeEngineQueueStoreForItem` (declared `Storage`
      dependency — **no `serviceOption`**). `layer` / `serve` / `serveRemote` merge `Store.layerDefaultMemory`.
- [x] `Hyperlink.builtHyperlink` + `grantLocal` on `layer` / `serve` / `serveRemote` (worker `R` discharged
      at grant; remote path defers via wire invoke).
- [x] Config-object-only `Tag` with optional `success` / `error` on the config object.
- [x] `publishEvent` persists via materialized engine store (`config.store` / `recordToStore` at source).
- [x] Legacy `WorkPoolStore` facet deleted from `src/` (engine no longer dual-writes).

## Future (not this cutover — no code changes in Agent 01)

1. [ ] Buffer appends off the worker hot path (one scoped daemon draining a bounded queue → `store.record`).

## Discarded plan items (superseded — do not redo)

The following were the original engine-cutover checklist; **declared-dependency materialize + `layerDefaultMemory`
merge shipped** on `integration/storage`. Keep for history only:

1. ~~`buildQueueImpl` resolves the store handle as a **plain declared dependency**~~ — **done** via
   `materializeEngineQueueStoreForItem`.
2. ~~The queue layer's `RIn` gains `StoreScopeBridgeTag`; app provides `layerDefaultMemory` at root~~ — **done**
   via `Layer.provideMerge(Store.layerDefaultMemory)` on toolkit layers (apps override at root).

## Discarded (do not do — I got these wrong earlier)

- ❌ `Effect.serviceOption(StoreScopeBridgeTag)` in the engine/layer — violates the no-sniff rule and is the
  cause of the build-time deadlock.
- ❌ A shared `internal/store/storeTap.ts` helper that resolves via `serviceOption` in a forked fiber — same
  violation, dressed up. A declared dependency needs no such helper.
- ❌ Lazy per-event resolution.
- ❌ `Layer.provide(layerDefaultMemory)` baked into the queue layer (hard-provides; blocks app override).
  **Note:** shipped shape is `Layer.provideMerge(Store.layerDefaultMemory)` on toolkit layers — apps override at root.

## Why no deadlock now

A declared dependency (`yield* StoreScopeBridgeTag`) is built in topological order and memoized, so the store
builds first and `AppStore.at(tag)` reuses the same instance — no concurrent build, no scoped-`EventJournal`
lock. The deadlock was an artifact of `serviceOption`-in-layer-build, which we're removing.

## Verify
`pnpm typecheck` (both) + queue suites + a `queue-store-persist` test (persist → read back via app store,
`it.live` — real clock; the queue processes + poll in real time).
