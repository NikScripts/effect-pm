# Store migration roadmap — modules, lanes, priorities

The authoritative plan for migrating every module onto the new Store machinery. One source of truth
for both the local (Claude) lane and the cloud (Cursor) lane. Tick modules off as they land.

## Branches & workflow
- **Integration branch: `integration/storage`** (the go-forward integration branch; supersedes
  `cursor/integration-result-schema-a3ad`). SHARED — merges need per-action owner permission.
- **Working branches: `action/short-description`** (e.g. `fix/store-extend`, `refactor/queue-golden`),
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

## Done ✅ (on `integration/storage`)
- **Store core + transform layer** — `Store.effects`, `mapEffects`, `catchWriteErrors`, categorized
  `StoreWriteError`, `Store.extend` (type-preserving), `Store.provideContext`, `resolve`/`resolveOrDie`
  (deprecated aliases removed).
- **Resource transform layer** — `Resource.mapEffects`, `Resource.provideContext` (subtractive).
- **Full-capture merged + worker-A** — success schema drives the worker return type.
- **QueueResource** — three-tier store, 12 analytics reads, golden-clean.

## Module inventory (tick as landed)

### Claude lane — local (critical / shared / design)
- [x] **Logs** (`src/store/log.ts` `LogStore`) — on PR [#30](https://github.com/NikScripts/effect-pm/pull/30) (`cursor/phase5-logs-migration-a3ad`). Migrated off `ProcessStore.Service` → `Store.contract`/`Store.Service`; `Logs.persistLayer` is a relay subscriber; Phase 5 broke `captureLogs` / handle `logs`. **P1 remain** (level pipes, per-registration followers, remote `Resource.logs`) — see [review](./phase5-logs-migration-review.md). Blocks substrate retirement until lifecycle delete.
- [ ] **Delete `ProcessLifecycleStore`** (`src/store/processLifecycle.ts`) — dead code, zero live emitters.
- [ ] **Retire the facet substrate** (after Logs + the delete): `RuntimeStorage.ts`, `ProcessStore.ts`,
      `ProcessStorage.ts`, `ProcessStoreEvent.ts`, `Query.ts`, `internal/store/spine.ts`,
      `internal/store/service.ts`, the RuntimeStorage half of `internal/store/helpers.ts`,
      `src/storage/redis/*`, and the RuntimeStorage half of `src/storage/sqlite/*` (KEEP the
      `SQLiteHistoryStore` + `SQLiteDurableQueueStore` backends). Prune legacy `index.ts` re-exports + the
      `./storage/redis` + `./storage/sqlite`-RuntimeStorage `package.json` subpaths.
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
**RETIRE, not migrate** — gated on lifecycle delete after Logs. Evidence: Process/Run already left the
substrate (their specs are `Store.contract`, resolved via `Store.Storage`); `LogStore` now uses
`Store.Service` + `Logs.persistLayer` (relay subscriber); the only facet left on the substrate is
`ProcessLifecycleStore` (dead). The redis + sqlite RuntimeStorage backends are runtime-dead (only
doc/test references). Only 3 files import `RuntimeStorage` (`spine`, `service`, half of `helpers`) →
bounded blast radius. Delete `ProcessLifecycleStore`, and the whole substrate falls.

## Ordering
**Logs (#30 / Phase 5) ✓ cutover** → delete `ProcessLifecycleStore` → retire facet substrate (owner-gated Slice 3). Cursor can continue **Run / CustomQueue** in parallel. `layerQuery` only after owner approval. Logs **P1** (level pipes / followers / remote `Resource.logs`) is a separate follow-up PR.

## Surprises worth remembering
- `ProcessLifecycleStore` is dead code (delete, don't migrate).
- `HistoryStore` is a distinct third store the finished queue still uses — not legacy.
- `DurableQueueStore` is a fourth axis (durability) — not the observability store.
- `storage/sqlite/index.ts` is mixed (retire-able RuntimeStorage backend + keep HistoryStore/DurableQueue
  backends) — surgical retirement, not a directory delete.
