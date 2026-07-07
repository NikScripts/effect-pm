# Store cutover — Store core (shared decisions for all resource agents)

**Read this first.** The Process / Queue / RunResource / CustomQueue cutover reports all depend on
the decisions here. Companion to `result-schema-and-rpc-validation.md` (naming) and
`queue-persistence-design.md` (two-plane model).

## Done and on the integration branch

- **Store Stage 1 — default in-memory backing.** `layerDefaultMemory` (`internal/store/scopeBridge.ts`,
  `buildDefaultScopeBridge`) materializes any scope on demand against one in-memory `EventJournal`.
  `store-default.test.ts` proves it. This is the "always a store" default the cutover was blocked on.
- **Precise handle resolution (tightening).** `bridge.at` is now generic (`at<Input>(scopeKey, input)`
  → `StoreHandleOf<Input>`); `materializeStoreHandle` carries `Input`; `Tag.store` / `Resource.store`
  return the **precise** `Store.HandleOf<contract>`, not the loose union. **This removes the consumer
  casts** — see "Action for every module" below.

## Decisions locked

1. **No `serviceOption` / `isNone` on any emit path.** Sniffing "is there a store?" per event is banned.
   Resolve the store handle **once**; emit sites call it unconditionally.
2. **Resolution mechanism — SHARED, eager, forked-fiber (not lazy, not build-time).** RunResource's
   current `resolveNewStoreHandle` (lazy `serviceOption` + `.at().pipe(Effect.option)`) is a stopgap and
   must migrate onto the shared helper. Build-time resolution **deadlocks** (resolving the store during a
   resource layer's build blocks a later `Store.Service.at(tag)` read — a scoped-layer memoization lock;
   verified on the queue). The agreed shape: the layer creates the event buffer immediately and forks a
   scoped daemon that resolves the handle once and drains the buffer. **Owner: queue agent prototypes the
   shared `internal/store/storeTap.ts` helper and proves it against the deadlock; all three adopt it.**
3. **Tag is the SSOT for wire schemas** (`payload`/`success`/`error`). Engine/layer config may accept
   schemas *internally* (bootstrapping without a tag, tests) but must not advertise schema overrides —
   overriding a tag's schema at `layer()` is unsafe for RPC (`result-schema-and-rpc-validation.md` §3).
4. **One `event` shape per resource store, tagged-union row, `record`/`events` handle.** Persist the same
   event the live surface emits (queue: `QueueEvent<T>`; process: execution union; run: fact/state union).

## Action for EVERY module (cast removal)

With the tightening, the `... as BuiltInXContract` identity cast is no longer needed. Mirror the queue's
`builtInQueueStoreContract` (no cast — the type-preserving `Store.contract`/`Store.shape` + the value-typed
handle methods line up). **Concretely:** `processStoreSpec.ts` still has
`makeProcessStoreContract(...) as BuiltInProcessContract` — delete the `as`, align the contract's `record`/
`events` method types to the value union, and it should compile cast-free. Same check for RunResource's
store contract.

## Store-core TODO (owner: whoever builds the shared tap)

- [ ] `internal/store/storeTap.ts` — shared helper: `(scopeKey, contract) => Effect<Sink, never, Scope>`
      that resolves the handle once, forks the drain daemon, returns a buffered `record`-style sink
      (no-op when no store in context). Used by all three engines.
- [ ] Verify the forked-fiber resolution dodges the scoped-layer deadlock (the queue case).
- [ ] Decide `success` persistence (doc step E): does the store `Completed`/`RunCompleted` row carry the
      worker/run `success` value? Needs the tag's `success` schema threaded into the event union.
