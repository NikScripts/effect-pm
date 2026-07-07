# Store cutover — Process

Prereq: `store-cutover-00-store-core.md` (shared decisions). Context: `result-schema-and-rpc-validation.md`
(§B/B2/B3/E). The tag-schema + store-contract work (B/B2) is **done** on the integration branch; engine
cutover (B3) is **done** on `cursor/process-store-cutover-a3ad`.

## Review findings

1. **🟡 Cast on `makeProcessStoreContract`.** `builtInProcessStoreContract(tag)` is cast-free; one
   `as BuiltInProcessContract` remains at the factory so engine `record` accepts `ProcessStoreEventRow`
   (schema validates on append). Mirror queue tag-parameterized contract if variance can be eliminated.
2. **🟡 `ResourceTag<any, any>` in graft helpers** (`applyProcessTagSchemas`, `augmentTag`, layer
   builders). Unavoidable at heterogeneous tag-mutation boundaries — minimized, not exported.
3. **✅ `processTagSchemas.ts` — DRY.** `schemaOf(tag, sym)` backs `successOf` / `errorOf`.
4. **✅ `error` consumed.** Typed `RunFailed.error` when `errorOf(tag)` is set; RPC + store contract.

## Cutover (B3 — done)

- [x] Supervisor terminal writes via **`tag.store`** (`processStoreTap.ts`) — declared
      `StoreScopeBridgeTag`, buffered `record`, no `serviceOption`.
- [x] `hasPriorExecutions` reads store contract when recorder present (layer path).
- [x] **`ProcessExecutionStore` facet deleted** — module, subpath, `ProcessStorage` alias, tests.
- [x] `RunCompleted.result` populated from `SubscriptionRef` when tag carries `success`.
- [x] `Process.result` removed; positional `success` / `error` on `Tag`.

## Open

- [ ] Owner decision: `RunFailed.error` encoding — raw failure value (journal encodes) vs pre-encoded.
- **App requirement:** `Process.layer` / `serve` / `serveRemote` require `StoreScopeBridgeTag` at root.

## Verify

```bash
pnpm run typecheck
pnpm run build
pnpm exec vitest run test/process-toolkit.test.ts test/process-store-contract.test.ts \
  test/process-store-engine.test.ts test/process-contract-shape.test-d.ts
```
