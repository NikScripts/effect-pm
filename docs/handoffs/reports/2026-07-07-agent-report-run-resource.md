# Agent report: RunResource

**Branch:** `cursor/run-resource-handle-observable-a009` (includes RunResource handle/RPC/store work)  
**Integration base:** merge `cursor/integration-result-schema-a3ad` before work  
**Agent:** RunResource owner  
**Priority:** Low — **most work is done**; this agent finishes gaps and verifies.

---

## Shipped (do not redo)

| Area | Status | Key files |
|------|--------|-----------|
| `.run` handle API | ✅ | `src/RunResource.ts`, `src/internal/runResource.ts` |
| Subscribable observation | ✅ | `status`, `waiting`, `inFlight`, … |
| RPC `layer` / `serve` / `serveRemote` | ✅ | `runSpec`, `buildRunImpl` |
| Tag wire slots `payload` / `success` / `error` | ✅ | commit `2c8a95e` |
| `RunResource.store(tag)` | ✅ | `builtInRunResourceStoreContract` |
| Engine store tap | ✅ | `src/internal/runResourceStoreTap.ts` (legacy facet + Store, lazy bridge) |
| Integration tests | ✅ | `test/run-resource.test.ts` (ProcessStorage + Store auto-write) |
| Remote HTTP test | ✅ | `test/run-resource-remote-http.test.ts` |
| Changeset (partial) | ✅ | `.changeset/run-resource-handle-rpc-store.md` |

---

## Remaining work

### 1. Consume integration branch Store typing fix

Integration commit `4597ee1` tightens `bridge.at` / `Tag.store` so consumers get `StoreHandleOf<C>` without casts.

- **File:** `src/internal/runResourceStoreTap.ts` — may drop `as unknown as StoreHandleFromContract<…>` after merge.
- **Verify:** `test/store.test.ts`, `test/store-default.test.ts`.

### 2. Doc sweep (stale names)

Grep and fix any remaining `inputSchema` / `successSchema` / `RunGate` / callable `gate(`:

- `docs/CODEBASE-INVENTORY.md` — RunResource Service line still mentions `inputSchema` (as of pre-report tree)
- `docs/guides/resource-configure.md` — confirm `payload` / `success` / `error`
- Examples under `examples/forms/resource/`

### 3. Changeset consolidation

Merge `.changeset/run-resource-handle-rpc-store.md` into the platform-wide rename/release changeset (see Docs + release report). Avoid two conflicting beta notes.

### 4. Optional hardening

- **`serve` / `serveRemote` casts** — `Layer.unwrap` + casts mirror Process; revisit only if typecheck improves upstream.
- **SQLite example** — `examples/forms/process-store/process-store-events-sqlite-layer.ts` already logs run facts; no blocker.

---

## Out of scope (other agents)

- Process engine → `Process.store` tap
- Queue `itemSchema` → `payload` rename
- RPC fingerprint / buildId handshake
- Removing legacy `RunResourceStore` facet (ProcessStorage still depends on it)

---

## Verification

```bash
pnpm run typecheck
pnpm exec vitest run test/run-resource.test.ts test/run-resource-remote-http.test.ts \
  test/run-resource-store-facet.test.ts test/store.test.ts
npx tsx examples/forms/process-store/process-store-events-sqlite-layer.ts
```

---

## Critical notes

1. **`RunResource.make`** uses the observable engine internally but exposes **`.run` only** (no Subscribables on public handle). Documented in module TSDoc — keep accurate.
2. **Store tap resolves bridge at write time** — required when gate layer and Store layer are `Layer.mergeAll` siblings; do not revert to eager resolution at handle init.
3. **Do not rename** persisted fact fields (`run-resource.run.*`) or `RunGateStatus` counters — only tag config uses `payload` / `success` / `error`.
