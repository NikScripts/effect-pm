# Agent report: Store (platform)

**Branch:** `integration/storage`  
**Agent:** Store / internal-store owner (Agent 1)  
**Priority:** **Done** — Stage 1 + engine wiring shipped; open = write-buffer future + owner TODOs only.

> **Correction (2026-07-09):** Prior report lines claiming "Stage 1 blocked", lazy `serviceOption` taps, and
> Queue-on-facet-only writes are **stale**. Authoritative policy:
> [`store-cutover-00-store-core.md`](../store-cutover-00-store-core.md) · consumer docs:
> [`STORAGE.md`](../../STORAGE.md).

---

## Shipped on `integration/storage`

| Area | Status | Evidence |
|------|--------|----------|
| **Stage 1 — default backing** | ✅ | `Store.layerDefaultMemory`, `buildDefaultScopeBridge`; `test/store-default.test.ts` |
| **Precise handle resolution** | ✅ | Generic `bridge.at<Input>` → `StoreHandleOf<Input>`; typed `Tag.store` |
| **Declared `Storage` dependency** | ✅ | No `serviceOption(Storage)` in engines; `materializeEngineQueueStore*` (QR/CQR), `Store.effects` (Process), RunResource internal tap |
| **Toolkit `layerDefaultMemory` merge** | ✅ | Process (`withDefaultMemory`), Queue, CQR, RunResource layer entry points |
| **Legacy execution facets deleted** | ✅ | `ProcessExecutionStore`, `QueueResourceStore`, `RunResourceStore` facet **classes gone** from `src/` |
| **Built-in contracts cast-free** | ✅ | Queue, RunResource; Process (`process-store-contract.test-d.ts`) |
| **Journal codec** | ✅ | Effect Msgpack via `journalCodec.ts` — no direct `msgpackr` dep |

---

## Engine wiring (all four toolkits)

| Toolkit | Contract | Engine materialization | Handoff |
|---------|----------|------------------------|---------|
| **QueueResource** | `builtInQueueStoreContract(tag)` | `materializeEngineQueueStoreForTag` in `buildQueueImpl` | [`store-cutover-queue.md`](../store-cutover-queue.md) |
| **CustomQueueResource** | same union | `materializeEngineQueueStoreForItem` in `buildCustomQueueImpl` | [`store-cutover-customqueue.md`](../store-cutover-customqueue.md) |
| **Process** | `builtInProcessStoreContract(tag)` | `Store.effects` in `buildProcessImpl` | [`store-cutover-process.md`](../store-cutover-process.md) |
| **RunResource** | `builtInRunResourceStoreContract(tag)` | `Store.effects` in `internal/runResource.ts` | [`store-cutover-runresource.md`](../store-cutover-runresource.md) |

Queue persists full `QueueEvent<T>` lifecycle via `publishEvent` → `recordToStore` — not entry-only, not facet rows.

---

## What remains on RuntimeStorage facets

`ProcessStorage` composes **Log** + **ProcessLifecycle** only (`src/store/log.ts`, `src/store/processLifecycle.ts`).
Execution history is **Store bridge only**.

---

## Open (low priority / future)

| Item | Owner | Notes |
|------|-------|-------|
| Write-path buffer (queue) | Queue | Scoped daemon off hot path — **future**; see `store-cutover-queue.md` |
| `package.json` `store/QueueResource` subpath | release | Export may linger; no `src/store/queueResource.ts` — document exception until removed |
| Platform changeset | owner approval | Breaking store/tag wire — needs approval |
| Hybrid RuntimeStorage / Postgres | roadmap | `docs/plans/` |

---

## Files (Store subsystem)

| Path | Role |
|------|------|
| `src/Store.ts` | Public aggregate API, `Storage`, `layerDefaultMemory` |
| `src/internal/store/bridge.ts`, `scopeBridge.ts`, `memoryScope.ts` | Bridge + default resolution |
| `src/internal/store/sqliteLayer.ts` | Durable layers |
| `src/internal/store/journalCodec.ts` | Msgpack payload codec |
| `src/internal/store/{queue,process,runResource}StoreSpec.ts` | Built-in contracts |
| `test/store.test.ts`, `test/store-default.test.ts`, `test/store.sqlite.test.ts` | Conformance |

---

## Verification

```bash
pnpm run typecheck
pnpm test
pnpm exec vitest run test/store.test.ts test/store-default.test.ts test/store.sqlite.test.ts \
  test/queue-store-persist.test.ts test/custom-queue-store-persist.test.ts
```

---

## Coordination

- **Agent 1 (docs):** [`agent-01-session-2-storage-docs.md`](../agent-01-session-2-storage-docs.md) — `STORAGE.md` rewrite + grep sweep.
- **Agent 2 (Process):** owns `PROCESS-API.md`, `guides/process.md` — not Store agent.
- **Queue agent:** write-buffer only; engine store **done**.
