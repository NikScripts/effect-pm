# Store cutover — Process

Prereq: `store-cutover-00-store-core.md` (shared decisions). Context: `result-schema-and-rpc-validation.md`
(§B/B2/B3/E). The tag-schema + store-contract work (B/B2) is **done** on the integration branch; engine
cutover (B3) is **done** on `cursor/process-store-cutover-a3ad`.

## Review findings

1. **✅ Cast on `makeProcessStoreContract`.** `builtInProcessStoreContract(tag)` is cast-free; `record`
   accepts `ProcessStoreEventRow` via a narrow `event.append` bridge (journal encodes on append). Mirror
   queue tag-parameterized contract if variance can be eliminated further.
2. **🟡 `ResourceTag<any, any>` in graft helpers** (`applyProcessTagSchemas`, `augmentTag`, layer
   builders). Unavoidable at heterogeneous tag-mutation boundaries — minimized, not exported.
3. **✅ `processTagSchemas.ts` — DRY.** `schemaOf(tag, sym)` backs `successOf` / `errorOf`.
4. **✅ `error` consumed.** Typed `RunFailed.error` when `errorOf(tag)` is set; RPC + store contract.

## Cutover (B3 — toolkit layers)

- [x] Terminal runs on **`Process.layer` / `serve` / `serveRemote`** append to **`Process.store(tag)`** (declared **`Store.Storage`**, default in-memory store merged into layer).
- [x] **`Process.make`** — supervisor only; **no** auto-append.
- [x] **`ProcessExecutionStore` facet deleted** — module, subpath, `ProcessStorage` alias, tests.
- [x] `RunCompleted.success` from latest run when tag carries `success`.
- [x] `Process.result` removed; positional `success` / `error` on `Tag`.

## Open

- [x] `RunInterrupted` recorded via `Effect.onInterrupt` when a tracked run is cancelled (`stop` / fiber interrupt).
- [x] **`RunFailed.error` encoding** — locked in `store-cutover-00-store-core.md` §5: typed decoded
      `error` when `errorOf(tag)` is set; `String(extracted)` when not; journal encodes on append.
- **✅ Baked-in default store:** `Process.layer` / `serve` / `serveRemote` merge `layerDefaultMemory`
  internally. Override at the app root with `Layer.provideMerge(AppStore.layerMemory)` or
  `AppStore.layer({ filename })`.

## Verify

```bash
pnpm run typecheck
pnpm run build
pnpm exec vitest run test/process-toolkit.test.ts test/process-store-contract.test.ts \
  test/process-store-engine.test.ts test/process-store-default-override.test.ts \
  test/process-store-sqlite.test.ts test/process-contract-shape.test-d.ts
```
