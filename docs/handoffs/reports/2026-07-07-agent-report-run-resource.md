# Agent report: RunResource

**Branch:** `cursor/run-resource-handle-observable-a009`  
**Integration base:** merge `cursor/integration-result-schema-a3ad` (through `b4bf1de` store-cutover corrections)  
**Agent:** RunResource owner  
**Priority:** Low — **RunResource cutover done**; docs/changeset consolidation remain.

---

## Shipped (do not redo)

| Area | Status | Key files |
|------|--------|-----------|
| `.run` handle API | ✅ | `src/RunResource.ts`, `src/internal/runResource.ts` |
| Subscribable observation | ✅ | `status`, `waiting`, `inFlight`, … |
| RPC `layer` / `serve` / `serveRemote` | ✅ | `runSpec`, `buildRunImpl` |
| Tag wire slots `payload` / `success` / `error` | ✅ | commit `2c8a95e` |
| `RunResource.store(tag)` | ✅ | `builtInRunResourceStoreContract` (cast-free) |
| Engine store tap | ✅ | `src/internal/runResourceStoreTap.ts` — Store bridge only (no legacy facet) |
| Public default store | ✅ | `Store.layerDefaultMemory` — app provides at root |
| Layer `RIn` | ✅ | `layer` / `serve` / `Service.layer` require `StoreScopeBridgeTag` |
| Integration tests | ✅ | `test/run-resource.test.ts`, remote HTTP, store suites |
| Changeset (partial) | ✅ | `.changeset/run-resource-handle-rpc-store.md` |

---

## Remaining work

### 1. Changeset consolidation (owner / docs agent)

Merge `.changeset/run-resource-handle-rpc-store.md` into the platform-wide rename/release changeset. Note new requirement: apps must provide `Store.layerDefaultMemory` (or a real `Store.Service`) when composing RunResource layers.

### 2. Doc sweep (mostly done)

- ✅ `docs/CODEBASE-INVENTORY.md` — `payload` / `success` on Service line
- ✅ Module TSDoc on `RunResource` — store provision section
- Optional: `docs/STORAGE.md` asymmetry paragraph (Process/Queue still facet-only)

### 3. Optional hardening

- **`serve` / `serveRemote` + `Resource.httpServer`** — layer error channel is `StoreScopeNotRegistered`; httpServer overload still expects `never` (cast at call sites today).
- **Write-path buffer** — queue cutover may add bounded buffer daemon; RunResource tap writes synchronously on the run path (acceptable for low-volume facts).

---

## Out of scope (other agents)

- Process engine → `Process.store` tap (same declared-dependency pattern)
- Queue engine cutover
- Removing legacy `RunResourceStore` facet — ✅ **deleted** (module, ProcessStorage, subpath, tests)
- RPC fingerprint / buildId handshake

---

## Verification

```bash
pnpm run typecheck
pnpm exec vitest run test/run-resource.test.ts test/run-resource-remote-http.test.ts \
  test/run-resource-store-facet.test.ts test/store.test.ts test/store-default.test.ts
npx tsx examples/forms/process-store/process-store-events-sqlite-layer.ts
```

---

## Critical notes

1. **`RunResource.make`** uses the observable engine internally but exposes **`.run` only** (no Subscribables on public handle).
2. **Do not rename** persisted fact fields (`run-resource.run.*`) or `RunGateStatus` counters — only tag config uses `payload` / `success` / `error`.
3. **Store provision:** compose `Store.layerDefaultMemory` at the **app root** via `Layer.provideMerge` — do **not** bake it into resource layers (store-cutover §2).

---

## Review 2026-07-07 (store-cutover corrections — `b4bf1de`)

Read: [`store-cutover-00-store-core.md`](../store-cutover-00-store-core.md), [`store-cutover-runresource.md`](../store-cutover-runresource.md).

### Policy shift (supersedes earlier `storeTap.ts` plan)

| Old plan | Current (integration) |
|----------|-------------------------|
| Lazy `serviceOption` per write | **Rejected** — removed |
| Forked-fiber `storeTap.ts` helper | **Discarded** — same violation dressed up |
| Build-time resolve deadlocks | Fixed by **declared dependency** + app-root `layerDefaultMemory` (topological build, memoized bridge) |

### Implemented in this branch

- `runResourceStoreTap.ts`: `yield* StoreScopeBridgeTag` once; `yield* bridge.at(scopeKey, contract)`; no `serviceOption`, no handle cast
- `runResourceStoreSpec.ts`: cast-free contract (mirrors queue)
- `Store.layerDefaultMemory` exported publicly
- Tests/examples updated: `layer.pipe(Layer.provideMerge(Store.layerDefaultMemory))`

### Open decision for owner (deferred)

None — Store-only persistence; **`RunResourceStore` facet fully removed**.

---

## Review 2026-07-07 (initial — partially superseded)

Earlier notes about waiting for Queue's `storeTap.ts` are **obsolete** after `b4bf1de`. Queue and Process should copy RunResource's **declared-dependency** tap shape, not lazy resolution or a shared `serviceOption` helper.
