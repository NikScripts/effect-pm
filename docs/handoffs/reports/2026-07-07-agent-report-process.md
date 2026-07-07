# Agent report: Process

**Branch:** `cursor/process-store-cutover-a3ad` (targets `cursor/integration-result-schema-a3ad`)  
**Agent:** Process owner  
**Priority:** **Medium** — B3 engine tap landed; facet retirement + cast removal remain.

---

## Shipped (2026-07-07)

| Area | Status | Key files |
|------|--------|-----------|
| Tag positional `success` / `error` | ✅ | `src/Process.ts`, `src/internal/processTagSchemas.ts` |
| Config object `{ success?, error?, … }` | ✅ | `ProcessTagOptions` |
| Store contract (queue-aligned) | ✅ | `src/internal/store/processStoreSpec.ts`, `processEvent.ts` |
| `error` on store union | ✅ | `makeProcessExecutionEvent(success, error)` |
| `Process.store(tag)` registration | ✅ | `builtInProcessStoreContract(tag)` |
| Engine store tap (layer path) | ✅ | `src/internal/processStoreTap.ts` — declared `StoreScopeBridgeTag`, buffered `record` |
| Legacy facet writes from engine | ✅ removed | **`ProcessExecutionStore` facet deleted** |
| Cast on store contract | 🟡 | `builtInProcessStoreContract` cast-free; factory cast remains |
| `RunCompleted.success` population | ✅ | From `SubscriptionRef` when `success` stamped |
| `hasPriorExecutions` via store | ✅ | When execution recorder present (layer path) |
| `Process.result` removed | ✅ | Positional `success` only |
| Store contract tests | ✅ | `test/process-store-contract.test.ts` |
| Engine integration tests | ✅ | `test/process-store-engine.test.ts` |
| Guide update | ✅ | `docs/guides/process.md` |

---

## Open issues

### 1. Cast on `makeProcessStoreContract`

`builtInProcessStoreContract(tag)` is cast-free. One `as BuiltInProcessContract` at
`makeProcessStoreContract` keeps engine `record` on `ProcessStoreEventRow` while schemas validate on
append.

### 2. Facet retirement (Stage 5)

**`ProcessExecutionStore` facet deleted.** Execution history is `Process.store(tag)` only. Remaining facets retire with full ProcessStorage removal.

### 3. `Process.make` path (no layer)

`Process.make` does not write to the store (no `_storeTap`). Use **`Process.layer`** for auto-append.

### 4. Owner decisions locked

**`RunFailed.error` encoding** — see `store-cutover-00-store-core.md` §5: typed decoded `error` when
`errorOf(tag)` is set; `String(extracted)` when not; journal encodes on append. **`RunCompleted.success`**
(not `result`) when `success` is stamped.

### 5. Baked-in default store

**`Process.layer` / `serve` / `serveRemote`** merge **`layerDefaultMemory`** internally — no external
`StoreScopeBridgeTag` layer required. Override with `Layer.provideMerge(AppStore.layerMemory, Process.layer(...))`
when you register `Process.store(tag)` on an app store.

---

## Files to touch next

| File | Work |
|------|------|
| `src/internal/store/processStoreSpec.ts` | Tag-parameterized contract to drop factory cast |
| `src/Process.ts` | Facet writes removed — store contract only on layer path |
| `docs/PROCESS-API.md`, `docs/STORAGE.md` | Document new store path + layer requirement |
| `.changeset/process-tag-store-cutover.md` | Consolidate with platform rename changeset at release |

---

## Verification

```bash
pnpm run typecheck
pnpm exec vitest run test/process-toolkit.test.ts test/process-store-contract.test.ts \
  test/process-store-engine.test.ts test/process-contract-shape.test-d.ts
```

---

## Coordination

- **Store agent:** `layerDefaultMemory` shipped; **Process** merges it on toolkit layers (`withDefaultMemory`). Queue / RunResource still app-root until their cutover.
- **Docs agent:** CHANGELOG + PROCESS-API persistence section.
- **Queue agent:** engine cutover pattern should match declared `StoreScopeBridgeTag` (no `storeTap.ts`); consider Process-style `withDefaultMemory` when baking default in.
