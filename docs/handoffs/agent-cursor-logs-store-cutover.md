# Agent (Cursor) — Logs store cutover

**Status:** **SUPERSEDED** — do not execute. Superseded by Agent 3 Logs P1 / followers ([#40](https://github.com/NikScripts/effect-pm/pull/40), [#43](https://github.com/NikScripts/effect-pm/pull/43)); see [`agent-03-logs-p1.md`](./agent-03-logs-p1.md).  
**Base:** `integration/storage` (`39c75d7`+)  
**Branch:** `cursor/logs-store-cutover-a009` (new)

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`store-migration-roadmap.md`](./store-migration-roadmap.md) · [`store-and-logs-design.md`](./store-and-logs-design.md)

---

## Owner steer (2026-07-12)

- **Wait on `main` merge / `pnpm run version`** until Logs lands.
- **Priority:** migrate **`LogStore`** off the legacy `ProcessStore` facet substrate.
- **Lane:** Cursor cloud agent (not Claude local).

---

## Why this blocks everything else

`LogStore` (`src/store/log.ts`) is the **only live consumer** of `ProcessStore.Service` + `RuntimeStorage` spine. Process/Queue already use `Store.contract` + `Store.effects`. Until Logs moves, we cannot delete `ProcessLifecycleStore`, `RuntimeStorage`, `ProcessStorage`, redis/sqlite RuntimeStorage adapters, or `internal/store/spine.ts`.

---

## Golden reference (copy shape, not domain)

| Reference | Path |
|-----------|------|
| Queue store contract | `src/internal/store/queueStoreSpec.ts` |
| Process store contract | `src/internal/store/processStoreSpec.ts` |
| Process engine wiring | `src/Process.ts` (`Store.effects` + `catchWriteErrors` + `provideContext`) |
| Store guides | `docs/legacy/guides/store.md` (if present), `docs/handoffs/store-cutover-process.md` |

**Do not** implement the full `store-and-logs-design.md` platform (`Resource.logs`, rip `logs` off process/queue specs) in this session — that is a follow-on. This session is **facet → Store bridge** only.

---

## Problem today

```ts
// src/store/log.ts — still ProcessStore facet
export class LogStore extends ProcessStore.Service<LogStore>()(
  "@nikscripts/effect-pm/store/log/LogStore",
  ProcessStore.record({ record, recordBatch }),
  ProcessStore.read({ load, query }),
) {}
```

- Writes go through `RuntimeRecord` + `RuntimeStorage` spine (`makeLogRecord`, `Type.equals`, `ProcessId.equals`).
- **`NodeLogs.persistLayer`** batches into `LogStore.record` / `recordBatch`.
- **`nodeStatusResource`** reads via `Effect.serviceOption(LogStore)` + `load`.
- **`ProcessStorage.layer`** merges `LogStore.layerRuntimeStorage` + dead `ProcessLifecycleStore`.
- SQLite/redis: `layerProcessStore` → `ProcessStorage.layerRuntimeStorage`.

---

## Target (this session)

### 1. New store contract

Add `src/internal/store/logStoreSpec.ts` (mirror queue/process):

- **Tier 1 (lean):** append log rows + read/query by `LogQuery` payload.
- Use **`Store.contract`** / **`Store.shape`** / **`Store.query`** — not `ProcessStore.record/read`.
- Preserve wire semantics: `groupId` bucket, `entryId`, `LogEntry` body, annotation filters (`processId`, `queueId`).
- Error channel: `StoreWriteError` on writes, `LogQueryError` on reads (keep existing tagged errors).

### 2. `LogStore` public facet

Refactor `src/store/log.ts`:

- Replace `extends ProcessStore.Service` with **`Store.Service`** registration pattern (or `Store.effects` recorder surface consumed by `NodeLogs` — pick the shape that matches how node-scoped store registers today; see `Store.Service` pipe API in `Store.ts`).
- Keep public **`LogStore` tag id** `@nikscripts/effect-pm/store/log/LogStore` if possible; migrate `LogStoreApi` methods (`record`, `recordBatch`, `load`, `query`).
- **`makeLogRecord`** / codec: move to internal spec or keep exported if tests depend on it.

### 3. Wire consumers

| Consumer | File | Change |
|----------|------|--------|
| Node durable writer | `src/NodeLogs.ts` (`persistLayer`) | Call new store append API |
| Node status history | `src/internal/nodeStatusResource.ts` | Resolve store via new bridge |
| Combined layer | `src/ProcessStorage.ts` | Drop `layerRuntimeStorage` facet merge for LogStore — use Store bridge |
| SQLite/redis | `src/storage/sqlite/index.ts`, `src/storage/redis/index.ts` | Replace `ProcessStorage.layerRuntimeStorage` log path with Store-backed layer |
| Log query helpers | `src/internal/manager/logQuery.ts` | Keep; adapt imports if needed |

### 4. Tests (must stay green)

```
test/log-store-facet.test.ts
test/log-pipeline.test.ts      # SQLite byNode / byResource
test/logs.test.ts
test/host-logs-history.test.ts
test/log-query.test.ts
test/host-status.test.ts       # node logs stream
```

Add conformance tests mirroring `test/process-store-*.test.ts` if the new contract warrants it.

### 5. Slice 2 (same branch, separate commit — if time)

- **Delete `ProcessLifecycleStore`** (`src/store/processLifecycle.ts`) — zero live emitters.
- Remove from `ProcessStorage.layer` merge.
- Do **not** delete full substrate yet (RuntimeStorage, ProcessStore module, redis) — that's Slice 3 after owner review.

---

## Out of scope

- `main` merge / release / `pnpm run version`
- Full substrate retirement (`RuntimeStorage`, `ProcessStore.ts`, `spine.ts`, …)
- `store-and-logs-design.md` platform logs (`Resource.logs`, remove `logs` from resource specs)
- `Store.layerQuery` (not approved)
- CustomQueue / RunResource store cutovers

---

## Slices + verify

| Slice | Work | Verify |
|-------|------|--------|
| 1 | `logStoreSpec` + internal codec | typecheck |
| 2 | Refactor `LogStore` tag | `test/log-store-facet.test.ts` |
| 3 | `NodeLogs` + `nodeStatusResource` | `test/log-pipeline.test.ts`, `host-logs-history.test.ts` |
| 4 | `ProcessStorage` + sqlite/redis layers | full `pnpm test` |
| 5 | Delete `ProcessLifecycleStore` (optional) | grep zero imports |
| 6 | Docs + changeset + `agent-status` | lint + typecheck + test |

```bash
pnpm run typecheck
pnpm test
pnpm run lint
```

---

## Short prompt (paste to Cursor Agent)

```
Read docs/handoffs/agent-cursor-logs-store-cutover.md and store-migration-roadmap.md (Logs section).

Branch cursor/logs-store-cutover-a009 from integration/storage.

Migrate LogStore off ProcessStore facet to Store.contract / Store.effects (golden: queueStoreSpec + processStoreSpec). Wire NodeLogs.persistLayer, nodeStatusResource, ProcessStorage, sqlite/redis layers. Keep LogStoreApi semantics and all log tests green.

Optional slice 2: delete dead ProcessLifecycleStore.

OUT OF SCOPE: main release, full RuntimeStorage substrate deletion, store-and-logs-design platform refactor.

Before/After/Verify each slice per supervisor-protocol.md. Update agent-status + owner-decisions on push. Changeset required; do NOT run pnpm run version.
```
