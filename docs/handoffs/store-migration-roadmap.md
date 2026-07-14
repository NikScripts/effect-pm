# Store migration roadmap — modules, lanes, priorities

The authoritative plan for migrating every module onto the new Store machinery. One source of truth
for both the local (Claude) lane and the cloud (Cursor) lane. Tick modules off as they land.

## Branches & workflow
- **Integration branch: `integration`** (renamed from `integration/storage` — storage work done;
  general integration line). SHARED — merges need per-action owner permission.
- **Working branches: `action/short-description` or `cursor/<desc>-a3ad`**,
  pushed to origin under the same name, freely.
- Lane split: **Claude = local**, handles critical / shared / design-heavy work (Store core, Logs,
  retiring the facet substrate). **Cursor = cloud clones**, one per module, mechanical work that copies
  the golden queue template.

## Golden model = `QueueResource` (copy this)
The queue is the finished reference. The patterns every module adopts:
- **Contract tiers via `Store.extend`** (type-preserving): lean base = `Store.contract`; engine
  write-extension + consumer read-extension = `Store.extend(methodsFn, base)`.
- **Recorder via `Store.effects` + `Store.catchWriteErrors`** — narrow semantic writes; write errors
  (`StoreWriteError`) logged + swallowed, defects propagate.
- **Impl requirement discharged with `Resource.provideContext(impl, tag[specSym], ctx)`** (one call,
  not per-method); store recorder's `Storage` discharged with `Store.provideContext`.
- **Full-capture**: single typed outcome event; the tag's `success`/`error` schema slots type the worker
  return + `Completed.success`/`Failed.cause` (worker-A).
- Guides: `store.md`, `store-backing.md`, `store-migration.md`, `queue-resource.md`.

## Done ✅ (on `integration`)
- **Store core + transform layer** — `Store.effects`, `mapEffects`, `catchWriteErrors`, categorized
  `StoreWriteError`, `Store.extend` (type-preserving), `Store.provideContext`, `resolve`/`resolveOrDie`
  (deprecated aliases removed).
- **Resource transform layer** — `Resource.mapEffects`, `Resource.provideContext` (subtractive).
- **Full-capture merged + worker-A** — success schema drives the worker return type.
- **QueueResource** — three-tier store, 12 analytics reads, golden-clean.
- **Logs Phase 5** (#30) — `captureLogs` / handle `logs` removed; `Resource.logs` / `NodeStatus.logs`.
- **Facet substrate retired** — `ProcessLifecycleStore`, `ProcessStorage`, `RuntimeStorage`, related
  redis/sqlite RuntimeStorage half, public facet modules.
- **`NodeLogs` shim removed** — `cursor/logs-closeout-a3ad` (closeout after #30).

## Module inventory (tick as landed)

### Claude lane — local (critical / shared / design)
- [x] **Logs** (`src/store/log.ts` `LogStore`) — merged via [#30](https://github.com/NikScripts/effect-pm/pull/30). `Store.contract`/`Store.Service`; `Logs.persistLayer` is a relay subscriber; Phase 5 broke `captureLogs` / handle `logs`. **`NodeLogs` shim removed.** **P1:** Agent 3 — [`agent-03-logs-p1.md`](./agent-03-logs-p1.md) (levels / followers / remote); owner unlocks slices.
- [x] **Delete `ProcessLifecycleStore`** — done (folded into `integration` with #30 tip).
- [x] **Retire the facet substrate** — done (`RuntimeStorage`, `ProcessStore`, `ProcessStorage`,
      `ProcessStoreEvent`, `Query`, RuntimeStorage redis/sqlite halves, related subpaths).
- [ ] **`Store.layerQuery`** (multi-scope read) — designed in `store-layer-query.md`, **NOT approved**;
      build only if Logs by-node/by-resource querying needs it, and after owner sign-off on the API.
- [ ] doc nit: dangling `{@link withDefault}` in `Store.ts` header.

### Cursor lane — cloud clones (mechanical, copy the queue)
- [x] **Process** — `Store.effects` + `catchWriteErrors` + `builtInProcessStoreContract`; handoff `store-cutover-process.md` **done**.
- [ ] **Run** (`RunResource.ts`, `internal/runResource.ts`, `internal/runResourceStoreTap.ts`,
      `internal/store/runResourceStoreSpec.ts`) — convert the `recordWrite`/`catchErrorAndLog` tap →
      `Store.catchWriteErrors`; two write shapes (`fact` + `state`) become tier-2. Handoff:
      `store-cutover-runresource.md`.
- [ ] **CustomQueue** (`CustomQueueResource.ts`, `internal/customQueueResource.ts`) — records NOTHING
      today; add a built-in contract + `Store.effects` recorder + `store(tag)` analytics, mirroring the
      queue. Slightly design-heavy (N-level) → light review. Handoff: `store-cutover-customqueue.md`.

### Keep — separate live axes, NOT part of this migration
- [x] `HistoryStore` (+ `storage/sqlite/historyStore.ts`) — live-stream ring history; used even by the
      done queue.
- [x] `DurableQueueStore` (+ `storage/sqlite/durableQueue.ts`) — durability plane.

### No store work
- [x] ApiMetrics, ApiUsageSchema, Group, HttpApiResource, HttpClientRunGate, LogContext, LogEntry,
      MultiNode, Polling, Resource, ResourceConfigure, Telemetry, disarmedIdleSleep, cli/tui/ui/web.

## Retire-vs-migrate verdict (facet substrate)
**RETIRED.** Process/Run left the substrate for `Store.contract`; Logs used `Store.Service` +
`Logs.persistLayer`; `ProcessLifecycleStore` and the RuntimeStorage facet stack were deleted after
Phase 5.

## Ordering
**Logs (#30) ✓** → **ProcessLifecycle delete ✓** → **facet substrate retire ✓** → **`NodeLogs` remove
(closeout)** → Cursor **Run / CustomQueue** in parallel. `layerQuery` only after owner approval.
Logs **P1** is a separate follow-up if owner wants it.

## Surprises worth remembering
- `ProcessLifecycleStore` was dead code (deleted, not migrated).
- `HistoryStore` is a distinct third store the finished queue still uses — not legacy.
- `DurableQueueStore` is a fourth axis (durability) — not the observability store.
- SQLite HistoryStore / DurableQueue backends remain; RuntimeStorage sqlite/redis halves are gone.
