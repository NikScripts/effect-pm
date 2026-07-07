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
| `RunCompleted.result` population | ✅ | From `SubscriptionRef` when `success` stamped |
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

`Process.make` does not write execution history (no `_executionRecorder`). Use **`Process.layer`** for store-backed runs.

### 4. Owner decision deferred

**`RunFailed.error` encoding** when `error` schema is stamped: raw failure value (journal encodes on append) vs pre-encoded payload.

### 5. App requirement (breaking)

**`Process.layer` / `serve` / `serveRemote`** require **`StoreScopeBridgeTag`**. Apps provide `Store.Service.layerMemory` (or equivalent) at the root via `Layer.provide` — see `store-cutover-00` §2.

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

- **Store agent:** `layerDefaultMemory` shipped; Process does not bake it into resource layers.
- **Docs agent:** CHANGELOG + PROCESS-API persistence section.
- **Queue agent:** engine cutover pattern should match declared `StoreScopeBridgeTag` (no `storeTap.ts`).
