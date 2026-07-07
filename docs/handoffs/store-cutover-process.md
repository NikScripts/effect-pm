# Store cutover — Process

Prereq: `store-cutover-00-store-core.md` (shared decisions). Context: `result-schema-and-rpc-validation.md`
(§B/B2/B3/E). The tag-schema + store-contract work (B/B2) is **done** on the integration branch; this is
the review fixes + the engine cutover (B3), now **unblocked** (Store Stage 1 default backing shipped).

## Review findings to fix

1. **🔴 Remove the cast.** `internal/store/processStoreSpec.ts` — `makeProcessStoreContract(...) as
   BuiltInProcessContract`. The Store tightening makes this unnecessary; mirror `builtInQueueStoreContract`
   (cast-free). Align `BuiltInProcessContract`'s `record`/`events` method types to the value union so the
   inferred type is assignable without the `as`.
2. **🟡 `ResourceTag<any, any>` in the graft helpers** (`applyProcessTagSchemas`, `graftResultRefAndSchemas`
   in `Process.ts`). Tighten where possible; a few `any` at heterogeneous tag-mutation boundaries may be
   unavoidable, but this is public-surface-adjacent — minimize.
3. **🟡 `processTagSchemas.ts` — DRY.** `successOf` / `errorOf` are near-identical — collapse to one `schemaOf(tag, sym)` if touching this file.
4. **🟡 Confirm `error` is consumed, not just stamped.** It's stamped (`errorSym`) and in the
   `Tag` signature, but the store `RunFailed` row uses `error: Schema.String`. If its only real use is RPC
   error validation, verify that path exists — otherwise it's a stamped-but-dead field.

## Cutover (B3 — now unblocked)

- [ ] `createProcess` (supervisor terminal) writes execution events via **`tag.store`** (the built-in
      process contract's `record`), not the legacy `ProcessExecutionStore` facet. Resolve the store as a
      **plain declared dependency** (`const bridge = yield* StoreScopeBridgeTag; const store = yield*
      bridge.at(scopeKey, contract)`) — **no `serviceOption`** (store-core §1), buffer writes off the hot
      path. The engine's `RIn` gains `StoreScopeBridgeTag`; the app provides `layerDefaultMemory` or a real
      store at the root.
- [ ] `getStatus` / `hasPriorExecutions` read via the store contract's `events` / `hasPriorExecutions`
      (the contract already exposes `hasPriorExecutions`).
- [ ] Delete the `ProcessExecutionStore` facet module. **Done** — use `Process.store(tag)` for execution history.
- [ ] (Doc step E) When the tag carries `success`, `RunCompleted` already carries the optional `result`
      (via `makeProcessExecutionEvent(successOf(tag))`) — confirm the supervisor populates it.

## Verify
`pnpm typecheck` (both projects) + `test/process-store-contract.test.ts` + the process suites.

## Review 2026-07-07 (shipped on `cursor/process-store-cutover-a3ad`)

- [x] Wire `error` into store contract (`makeProcessExecutionEvent(success, error)`; typed `RunFailed` when `errorOf(tag)` set).
- [x] Engine store tap: `makeProcessExecutionRecorder` resolves `StoreScopeBridgeTag` once, buffers to `store.record`; **no** `ProcessExecutionStore` writes.
- [x] `hasPriorExecutions` reads store when recorder present (layer path).
- [x] Populate `result` on `RunCompleted` from `SubscriptionRef` when tag carries `success`.
- [x] Remove `Process.result`.
- [ ] Drop `as BuiltInProcessContract` cast (type variance — deferred).
- [ ] Owner decision deferred: `RunFailed` stores raw `error` value when schema stamped (journal encodes on append) vs pre-encoded payload.
- **App requirement:** `Process.layer` / `serve` / `serveRemote` now require `StoreScopeBridgeTag` in context — provide `layerDefaultMemory` or `Store.Service.layerMemory` at the app root (`Layer.provide`, not baked into resource layer).
