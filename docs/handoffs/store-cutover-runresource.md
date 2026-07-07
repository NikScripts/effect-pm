# Store cutover — RunResource

Prereq: `store-cutover-00-store-core.md`. Context: `result-schema-and-rpc-validation.md` (§D done: tag
`payload`/`success`/`error`; RPC + handle shipped).

## The one real issue: migrate the store tap off lazy resolution

`internal/runResourceStoreTap.ts` currently resolves the store **lazily** — `resolveNewStoreHandle` does
`Effect.serviceOption(StoreScopeBridgeTag)` + `bridge.at(scopeKey, contract).pipe(Effect.option)` **per
resolution** (called from the run path). This was the stopgap to avoid the build-time deadlock, but:

- **Lazy per-run resolution is rejected** (owner preference; see store-core §2).
- It's inconsistent with the shared resolution mechanism the three resources are supposed to align on.

**Action:**
- [ ] Migrate to the shared `internal/store/storeTap.ts` helper (queue agent builds it): resolve the
      handle **once, eagerly, in a forked fiber** at engine build; emit sites call the returned sink
      unconditionally. No `serviceOption`, no `.pipe(Effect.option)` on the tap path.
- [ ] Keep the fact/state event shapes (`run-resource.fact.*` / state changes) as the store's tagged-union
      row — one `event` shape, `record`/`events` handle, aligned with queue/process.

## Cast check

- [ ] Confirm RunResource's built-in store contract has no `... as BuiltInRunResourceContract` identity
      cast. With the Store tightening it should compile cast-free (mirror `builtInQueueStoreContract`); if a
      cast is still present, remove it the same way.

## Note

The `bridge.at` call in `runResourceStoreTap.ts:86` was already updated to the new 2-arg signature during
the Store-tightening merge — no action needed there.

## Verify
`pnpm typecheck` (both) + the run-resource + run-resource store suites.
