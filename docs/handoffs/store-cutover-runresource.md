# Store cutover — RunResource

Prereq: `store-cutover-00-store-core.md` (**the store is a defaulted service; resolve it as a declared
dependency; NEVER `serviceOption`**).

## 🔴 RunResource is currently doing it wrong — two violations in `internal/runResourceStoreTap.ts`

1. **`serviceOption` on the new store bridge.** `resolveNewStoreHandle` (line ~80) does
   `Effect.serviceOption(StoreScopeBridgeTag)` + `bridge.at(scopeKey, contract).pipe(Effect.option)`, resolved
   **per write**. This breaks the locked rule (store-core §1): the store is a **defaulted service**, always
   present, so there is nothing to `serviceOption`. Per-write resolution is also the pattern the queue got
   burned by (build-time race / deadlock).

   **Fix:** resolve the store **once** as a plain declared dependency —
   `const bridge = yield* StoreScopeBridgeTag; const store = yield* bridge.at(scopeKey, contract)` — buffer
   writes off the hot path, emit unconditionally. No `serviceOption`, no `.pipe(Effect.option)`. The tap's
   `RIn` gains `StoreScopeBridgeTag`; the app provides `layerDefaultMemory` or a real store at the root.

2. **Cast on the handle.** `handle.value as unknown as StoreHandleFromContract<BuiltInRunResourceContract>`.
   With the Store tightening merged, `bridge.at` returns the precise handle — **delete the `as unknown as`.**
   Also confirm the built-in RunResource store contract has no `... as BuiltInRunResourceContract` identity
   cast (mirror `builtInQueueStoreContract`, which is cast-free).

Also: the tap still uses the legacy `ProcessStore.catchErrorAndLog` — swap for a local
`Effect.catchCause(... logWarning ...)` as the old facets are removed.

## Keep

- The fact/state event shapes (`run-resource.fact.*` / state changes) as the store's tagged-union `event`
  row (`record`/`events`), aligned with queue/process.

## Note

The `bridge.at` 2-arg signature update was already applied during the Store-tightening merge — no action there.

## Verify
`pnpm typecheck` (both) + the run-resource + run-resource store suites.
