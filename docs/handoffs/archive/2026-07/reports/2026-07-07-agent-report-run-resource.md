# Agent report: RunResource

**Branch:** `cursor/run-resource-handle-observable-a009`  
**Integration base:** merge `cursor/integration-result-schema-a3ad` (through `b4bf1de` store-cutover corrections)  
**Agent:** RunResource owner  
**Priority:** **Done** — RunResource cutover complete; optional platform changeset consolidation remains.

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
| **`RunResourceStore` facet** | ✅ **deleted** | module, ProcessStorage, subpath, tests |
| Default store on layers | ✅ | `layer` / `serve` / `Service.layer` merge `Store.layerDefaultMemory` (`c6ca217`) |
| Layer `RIn` | ✅ | `layer` / `serve` / `Service.layer` require `StoreScopeBridgeTag` |
| Integration tests | ✅ | `test/run-resource.test.ts`, remote HTTP, store suites |
| Changeset (partial) | ✅ | `.changeset/run-resource-handle-rpc-store.md` |
| Doc sweep | ✅ | guides, handoffs, inventory, PROCESS-API, STORAGE |

---

## Remaining work (platform / optional — not RunResource blockers)

### 1. Changeset consolidation (owner / docs agent)

Merge `.changeset/run-resource-handle-rpc-store.md` into the platform-wide rename/release changeset. Note:
`.run` migration, facet removal, and **`layerDefaultMemory` merged into RunResource layer entry points**.

### 2. Optional hardening (explicitly deferred)

- **`serve` / `serveRemote` + `Resource.httpServer`** — layer error channel includes `StoreScopeNotRegistered`;
  httpServer overload still expects `never` (partial fix in `d208c62`).
- **Write-path buffer** — queue cutover may add bounded buffer daemon; RunResource tap writes synchronously
  on the run path (acceptable for low-volume facts).

### 3. Product gaps (not bugs — not implemented unless requested)

- Layer flag for **no store writes** (disable engine persistence).
- Public **memory options** on default bridge (`maxRows` exists internally, not exported on `layerDefaultMemory`).
- **`Store.layerFromEventJournal`** / Redis journal adapter.

---

## Out of scope (other agents)

- Process engine → `Process.store` tap (same declared-dependency pattern)
- Queue engine cutover
- RPC fingerprint / buildId handshake

---

## Verification

```bash
pnpm run typecheck
pnpm exec vitest run test/run-resource.test.ts test/run-resource-remote-http.test.ts \
  test/store.test.ts test/store-default.test.ts
npx tsx examples/process-store/process-store-events-sqlite-layer.ts
```

---

## Critical notes

1. **`RunResource.make`** uses the observable engine internally but exposes **`.run` only** (no Subscribables on public handle).
2. **Do not rename** persisted fact fields (`run-resource.run.*`) or `RunGateStatus` counters — only tag config uses `payload` / `success` / `error`.
3. **Store provision:** `layer` / `serve` / `Service.layer` merge `Store.layerDefaultMemory` automatically; override with `Layer.provideMerge(AppStore.layerMemory)`. **`make`** still needs `Effect.provide(Store.layerDefaultMemory)` (see tests).

---

## Review 2026-07-07 (store-cutover corrections — `b4bf1de` + `c6ca217`)

Read: [`store-cutover-00-store-core.md`](../store-cutover-00-store-core.md), [`store-cutover-runresource.md`](../store-cutover-runresource.md).

### Policy shift (supersedes earlier `storeTap.ts` plan)

| Old plan | Current (integration) |
|----------|-------------------------|
| Lazy `serviceOption` per write | **Rejected** — removed |
| Forked-fiber `storeTap.ts` helper | **Discarded** — same violation dressed up |
| Build-time resolve deadlocks | Fixed by **declared dependency** + memoized bridge |
| App must always provide store at root | **RunResource:** `layerDefaultMemory` merged into layer entry points via `provideMerge`; override at app root still works |

### Implemented in this branch

- `runResourceStoreTap.ts`: `yield* StoreScopeBridgeTag` once; `yield* bridge.at(scopeKey, contract)`; no `serviceOption`, no handle cast
- `runResourceStoreSpec.ts`: cast-free contract (mirrors queue)
- `Store.layerDefaultMemory` exported publicly; merged into `RunResource.layer` / `serve` / `Service.layer`
- **`RunResourceStore` facet fully removed**
- Tests/examples/docs aligned with baked-default policy

### Open decision for owner (deferred)

None for RunResource store cutover.

---

## Review 2026-07-07 (initial — partially superseded)

Earlier notes about waiting for Queue's `storeTap.ts` are **obsolete** after `b4bf1de`. Queue and Process should copy RunResource's **declared-dependency** tap shape, not lazy resolution or a shared `serviceOption` helper.
