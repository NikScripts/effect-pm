# Agent report: QueueResource + CustomQueueResource

**Branch:** `integration/storage` (via `cursor/store-cutover-closeout-ce05`)  
**Agent:** Queue owner (owns CQR in same PR)  
**Priority:** **Low** — store cutover engine path shipped; remaining work is future perf (write-buffer) and docs-release sweep.

> **Correction (2026-07-09):** Config-object-only `Tag` wire, `success`/`error` stamps, engine store via
> `materializeEngineQueueStore*` + `layerDefaultMemory`, and `Resource.builtResource` parity (including CQR)
> are **shipped** on `integration/storage`. Authoritative module handoffs:
> [`store-cutover-queue.md`](../store-cutover-queue.md) · [`store-cutover-customqueue.md`](../store-cutover-customqueue.md).

---

## Current state

| Area | Status |
|------|--------|
| Config-object `Tag` (`payload` / optional `success` / `error`) | ✅ QR + CQR |
| Tag stamps (`successOf` / `errorOf`) → store wire SSOT | ✅ |
| Engine store (`materializeEngineQueueStore*` + declared `Storage`) | ✅ QR + CQR |
| `publishEvent` → materialized store (`recordToStore`) | ✅ |
| Legacy `QueueResourceStore` facet | ✅ **deleted** from `src/` |
| `Resource.builtResource` + `grantLocal` on toolkit layers | ✅ QR + CQR |
| `Layer.provideMerge(Store.layerDefaultMemory)` on toolkit layers | ✅ |
| Full lifecycle event taxonomy (persisted == streamed) | ✅ owner locked |
| Write-path buffer off hot path | ❌ **future** — see `store-cutover-queue.md` §Future |
| Docs grep sweep (`itemSchema`, etc.) | ❌ docs-release agent |

RunResource and Process use the same config-object tag shape. Queue/CQR engine store cutover is aligned.

---

## Shipped (do not redo)

### Tag + store wire

```ts
QueueResource.Tag<MyQueue>()("@app/MyQueue", { payload: JobSchema, success?, error? })
CustomQueueResource.Tag<Jobs>()("@app/Jobs", {
  payload: JobSchema,
  levelCount: 3,
  namedLevels: { urgent: 0 },
  success?,
  error?,
})
```

- Tag is SSOT — layer config must not override `payload` / `success` / `error`.
- `builtInQueueStoreContract(tag)` reads tag stamps; cast-free.

### Engine + store

- `buildQueueImpl` / `buildCustomQueueImpl` call `materializeEngineQueueStoreForTag` / `ForItem`.
- `publishEvent` persists via `config.store` at the source (`recordToStore`).
- Toolkit `layer` / `serve` / `serveRemote` merge `Store.layerDefaultMemory`.

---

## Remaining (low priority)

| Item | Owner | Notes |
|------|-------|-------|
| Write-path buffer | Queue (future) | Scoped daemon draining bounded queue → `store.record` — not blocking cutover |
| Docs grep sweep | docs-release | `itemSchema`, `QueueResourceStore` references in guides — separate PR |
| Platform changeset | owner approval | Breaking tag wire already shipped; changeset needs approval |

---

## Verification

```bash
pnpm run typecheck
pnpm test
pnpm exec vitest run test/queue-resource.test.ts test/queue-contract.test.ts \
  test/queue-resource-api.test-d.ts test/queue-store-persist.test.ts \
  test/custom-queue-store-persist.test.ts test/custom-queue-built-resource.test-d.ts
```

---

## Coordination

- **Store agent:** `bridge.at` typing consumed by `materializeEngineQueueStore*` — done.
- **Process / RunResource:** config-object tag reference — aligned.
- **Agent 01 close-out:** [`agent-01-store-cutover-closeout.md`](../agent-01-store-cutover-closeout.md).
