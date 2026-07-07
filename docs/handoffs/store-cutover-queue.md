# Store cutover — Queue (my target)

Prereq: `store-cutover-00-store-core.md` (shared decisions — **the store is a defaulted service; resolve it
as a declared dependency; NEVER `serviceOption`**).

## Owner decisions LOCKED (2026-07-06)

1. **Event taxonomy = full lifecycle.** The store persists the whole `QueueEvent<T>` union the live
   `.events` stream carries (per-entry + `Start`/`Drained`/`Cleared`/`Shutdown*` lifecycle + `RateLimitExceeded`).
   Not entry-only. SSOT — persisted == streamed. `builtInQueueStoreContract` already does this.
2. **`success`/`error` = full capture, presence-driven by the tag schema.** When the tag declares a
   `success` schema, the worker's return value **is captured onto `Completed`** (a `result` field, threaded
   from `success`) and persisted; when it declares `error`, `Failed` carries the decoded typed error. No
   schema → current behavior (`Completed {entry, elapsed}`, `Failed {entry, cause, elapsed}`). This mirrors
   `makeProcessExecutionEvent(successSchema)` — optional field appears iff the schema is present.
3. **CustomQueue does NOT take the triplet** — config-object only, no `success`/`error` (see
   `store-cutover-customqueue.md`).
4. **Always write thorough tests** — no approval needed for tests, ever.

## Done

- `builtInQueueStoreContract(tag)` — one `event` shape persisting the shared `QueueEvent<T>` union
  (`record`/`events`), **cast-free** (the reference other modules mirror to drop their casts).
- Store tightening + `layerDefaultMemory` (shipped; see store-core report).

## Plan (owner: me) — the defaulted-dependency shape

The engine cutover is now simple, per the store-core §1/§2 decisions:

1. [ ] `buildQueueImpl` resolves the store handle as a **plain declared dependency**:
       `const bridge = yield* StoreScopeBridgeTag; const store = yield* bridge.at(tag.key,
       builtInQueueStoreContract(tag))`. **No `serviceOption`, no `Option.match`, no forked-fiber, no lazy.**
2. [ ] Buffer appends off the worker hot path (one scoped daemon draining a bounded queue → `store.record`).
3. [ ] `publishEvent` persists via that buffer; delete the reverted `serviceOption(QueueResourceStore)` facet
       tier and the `ProcessStore` import.
4. [ ] The queue layer's `RIn` gains `StoreScopeBridgeTag`; the **app** provides `layerDefaultMemory` or a
       real `Store.Service` at the root (do NOT bake it into the queue layer). Update queue tests to provide
       one.

## Discarded (do not do — I got these wrong earlier)

- ❌ `Effect.serviceOption(StoreScopeBridgeTag)` in the engine/layer — violates the no-sniff rule and is the
  cause of the build-time deadlock.
- ❌ A shared `internal/store/storeTap.ts` helper that resolves via `serviceOption` in a forked fiber — same
  violation, dressed up. A declared dependency needs no such helper.
- ❌ Lazy per-event resolution.
- ❌ `Layer.provide(layerDefaultMemory)` baked into the queue layer (hard-provides; blocks app override).

## Why no deadlock now

A declared dependency (`yield* StoreScopeBridgeTag`) is built in topological order and memoized, so the store
builds first and `AppStore.at(tag)` reuses the same instance — no concurrent build, no scoped-`EventJournal`
lock. The deadlock was an artifact of `serviceOption`-in-layer-build, which we're removing.

## Verify
`pnpm typecheck` (both) + queue suites + a `queue-store-persist` test (persist → read back via app store,
`it.live` — real clock; the queue processes + poll in real time).
