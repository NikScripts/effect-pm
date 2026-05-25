# Architecture audit and logs separation

This document records a critical review of the current `@nikscripts/effect-pm` storage and logging design, plus **target rules** for fixing naming and dependency direction. It supersedes informal chat summaries for these topics.

**Related:** [`STORAGE.md`](./STORAGE.md) (storage invariants), [`STORAGE-INTEGRATION-INVENTORY.md`](./STORAGE-INTEGRATION-INVENTORY.md) (**every module** + parallel agent handoff), [`docs/AGENTS.md`](./AGENTS.md) (agent map).

---

## Target rules (decisions)

### Storage (unchanged intent)

1. **`RuntimeStorage`** — raw normalized `RuntimeRecord` I/O. Swap adapters here (memory, SQLite, Prisma later).
2. **`ProcessStore`** — module-facing client: `append`, `events`, `records`, and domain **facets** that only talk through that client.
3. **Durable local stack** — `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite` only on the sqlite subpath (no `@effect/sql-sqlite-node` on core `ProcessStore` entry).
4. **No** `Logs.layer`, `QueueResource.layer`, or other storage composition on domain modules.
5. **Legacy** `ProcessStore.file` / `storage/file` — not for new code.

### Logs — one public name, two responsibilities split by module

**Resolved (2026-05):** “Logs” no longer appears on `ProcessStore`. Capture/relay live only on `@nikscripts/effect-pm/Logs`; persistence uses `ProcessStore.GroupLog`.

**Decision:**

| Module / export | Responsibility | Must NOT |
|-----------------|----------------|----------|
| **`@nikscripts/effect-pm/Logs`** (dedicated file + package subpath) | **Capture and relay only:** `captureLoggerLayer`, `relayLayer` (in-memory tail + PubSub + batched flush into store), HTTP/stream helpers used by `pm watch`, replay helpers. | Own SQLite/file storage layers or duplicate storage APIs |
| **ProcessStore** (facet, renamed — see below) | **Persistence and query only:** record `group.log.entry` events via `append` / `appendBatch`, load/query through `ProcessStore.events`. | Export anything named `relayLayer`, `captureLoggerLayer`, or depend on `processManagerLogsRelay` from `ProcessStore.ts` |

**Naming resolution (no duplicate “Logs”):**

- Remove the public name **`ProcessStore.Logs`** (namespace and instance property name **`Logs`**).
- Store facet: **`ProcessStore.GroupLog`** (namespace + `store.GroupLog` on `ProcessStoreInterface`), type **`ProcessStoreGroupLogApi`** in `ProcessStoreLogs.ts`.
- **`@nikscripts/effect-pm/Logs`** (`src/Logs.ts`) — the only user-facing `Logs` export for capture (`captureLoggerLayer`, `relayLayer`, etc.).

### `layerProcessStore` name collision

Two symbols must not share one name:

| Symbol | Location | Meaning |
|--------|----------|---------|
| `layerProcessStore` | `storage/sqlite` | SQLite `RuntimeStorage` + full `ProcessStore` (combiner of facet layers) |
| `ProcessStoreRunResource.layerRuntimeStorage` | `store/RunResource` | `ProcessStoreRunResource` facet on top of injected `RuntimeStorage` |
| `ProcessStoreRunResource.layer` | `store/RunResource` | `ProcessStoreRunResource` facet + in-memory `RuntimeStorage` (dev/test) |

**Resolved:** the legacy `RuntimeObserver` and generic `ProcessStoreRuntime` facet are removed. Persistence now flows through the per-domain `ProcessStoreRunResource` facet's per-type static optional emitters (`recordRunStarted` / `recordRunCompleted` / `recordRunFailed` / `recordStateChange`) and the facet layer composed at app/group scope. New domains follow the per-domain rule — see [STORAGE-FACET-AUTHORING-GUIDE.md](./STORAGE-FACET-AUTHORING-GUIDE.md).

---

## What works today (keep)

- Unified spine: `makeRuntimeStorageProcessStore` for memory and SQLite-backed stores.
- `layerProcessStore` on the sqlite subpath keeps native deps optional.
- `ProcessStore.layerRuntimeStorage` + injected `RuntimeStorage`.
- `ProcessStore.QueueResource` facet pattern (static namespace delegates to `store.QueueResource`) — naming collision with `QueueResource` module remains a separate issue.
- `test/runtime-storage.conformance.ts` for adapter parity.
- [`STORAGE.md`](./STORAGE.md) states the one-stack rule clearly.

---

## High severity issues

### H1 — `ProcessStore` imports process-manager relay

**Where:** `src/ProcessStore.ts` imports `logsRelayLayer` from `src/processManagerLogsRelay.ts` to expose `ProcessStore.Logs.relayLayer`.

**Why it is wrong:** Storage core must not depend on PM capture wiring. Creates module cycle `ProcessStore ↔ processManagerLogsRelay`.

**Fix:** Delete `relayLayer` from `ProcessStore` namespace entirely. Live only on `@nikscripts/effect-pm/Logs`.

### H2 — `relayLayer` provided twice in group child

**Where:** `src/groupChild.ts` — `ProcessStore.Logs.relayLayer` merged on `envLayer` and again on `runtime.control`.

**Fix:** Compose capture stack once: `layerProcessStore` + `Logs.captureLoggerLayer` + `Logs.relayLayer` (after separation). Document minimal child layer graph.

### H3 — Two different `layerProcessStore` symbols

See target rules above. Rename to prevent wrong imports.

### H4 — Documentation contradicts implementation

**Where:** `docs/PROCESS-API.md` (RuntimeStorage “planned”, file-backed primary narrative, Prisma reads implied).

**Reality:** `src/RuntimeStorage.ts`, SQLite adapter, `layerProcessStore` exist; Prisma path throws `PrismaProcessStoreUnavailableError`.

**Fix:** Align `PROCESS-API.md` and `docs/CODEBASE-INVENTORY.md` with `STORAGE.md`. Mark plans as historical where needed.

### H5 — File-backed `ProcessStore` is a second persistence model

**Where:** `makeFileProcessStore` in `src/ProcessStore.ts` — NDJSON, not `RuntimeStorage`; `records()` semantics differ from SQLite.

**Fix:** Quarantine under explicit legacy surface or remove from default `ProcessStoreInterface` over time.

### H6 — No integration test for child log pipeline

**Missing:** `captureLoggerLayer` → relay publish → batched `recordBatch` → SQLite → load/query.

**Fix:** One test under `test/` proving end-to-end persistence on `groupLogSqlitePath`.

---

## Medium severity issues

### M1 — `ProcessStore.Logs.query` vs `load`

**Where:** `src/ProcessStoreLogs.ts` — `query` replays to operator logger; `load` returns entries.

**Fix:** Keep replay on `@nikscripts/effect-pm/Logs` or `ProcessManager` only; store facet exposes `load` / `record` only.

### M2 — PM types on store facet

**Where:** `ProcessStoreLogsApi` uses `ProcessManagerLogEntry`, `ProcessManagerLogQuery`, `ProcessManagerLogQueryError`.

**Acceptable short-term** if facet is renamed `GroupLog` and documented as “structured group log events in ProcessStore,” not generic logging.

### M3 — `QueueResource` module vs `ProcessStore.QueueResource` facet

Same English name, different layers (runtime workers vs storage semantics). Consider renaming facet to `ProcessStore.QueueRecords` or module to `QueueWorker` in a breaking pass.

### M4 — Static namespace wrappers

**Where:** `ProcessStore.Logs.*` / `ProcessStore.QueueResource.*` duplicate `store.*` facets.

**Fix:** Document one preferred style; trim redundant surface from root `index.ts`.

### M5 — Export sprawl on `src/index.ts`

Examples: `relayLayer`, `logsRelayLayer`, `processManagerLogRelayLayer` (unused in repo); duplicate `makeRecordedEvent`; `groupLocalRuntime` twice; split `ProcessManager` export blocks.

**Fix:** Namespace-first on `ProcessStore` / `Logs` subpaths; root only for main orchestration types.

### M6 — `ProcessGroup` ↔ `ProcessManager` mutual imports

**Fix:** Extract shared contract/config types to a small module (e.g. `ProcessGroupContract.ts`).

### M7 — SQLite `layerProcessStore(...).pipe(Layer.orDie)`

**Where:** `src/storage/sqlite/index.ts`.

**Fix:** Surface `SqlError` at compose time for operator-visible failures.

### M8 — `src/cli.ts` imports types from `./index`

Barrel cycle risk. Import from leaf modules instead.

### M9 — Parallel analytics APIs

Legacy `getProcessExecutions` / `getQueueItemCompletions` vs `ProcessStore.runtime.*`. Migrate `Process.ts` to projections.

---

## Low severity issues

- Duplicate `isGroupLogEntryRecorded` in `ProcessStore.ts` and `ProcessStoreLogs.ts`.
- `test/process-manager-group-logs.test.ts` name overpromises (codec only).
- `docs/CODEBASE-INVENTORY.md` stale vs `group.log.entry`, facets, sqlite layer.
- Root `index.ts` TSDoc still understates sqlite-first / overstates Prisma.

---

## Intended module layout (after logs separation)

```
RuntimeStorage          ← adapters (memory, sqlite, …)
ProcessStore            ← client + GroupLog facet + QueueResource facet
  .layer / .layerRuntimeStorage
  .GroupLog.record / .load   (no relayLayer)
  .QueueResource.*
  .runtime.*

@nikscripts/effect-pm/storage/sqlite
  layerProcessStore       ← sqlite ProcessStore composition

@nikscripts/effect-pm/Logs   ← ONLY capture/relay/operator log UX
  captureLoggerLayer
  relayLayer
  (optional: streamGroupLogs, replay helpers — or stay on ProcessManager)

@nikscripts/effect-pm/ProcessManager
  pm CLI, group child orchestration, queryGroupLogsForCatalog, …
```

**Group child layer stack (target):**

```ts
layerProcessStore({ filename: groupLogSqlitePath(...) })
  |> Logs.captureLoggerLayer
  |> Logs.relayLayer   // requires ProcessStore + ProcessGroupLogContext; flushes to store.GroupLog
  |> runtime.layer
  |> control
```

---

## Implementation checklist

Use this as the PR sequence; each item should have tests/docs updated in the same slice.

- [x] **L1** — This document; linked from `docs/AGENTS.md` and root `AGENTS.md`.
- [x] **L2** — `ProcessStore.ts` no longer imports relay layers.
- [x] **L3** — `src/Logs.ts` + `package.json` export `"./Logs"`.
- [x] **L4** — Store facet `GroupLog` + `ProcessStore.GroupLog` namespace.
- [x] **L5** — `groupChild.ts` composes `relayLayer` + `captureLoggerLayer` once on `envLayer`.
- [x] **L6** — Root `index.ts` re-exports capture/relay from `./Logs.js`.
- [x] **L7** — `STORAGE.md`, `PROCESS-API.md`, `PACKAGE-GUIDE.md`, `examples/README.md` updated.
- [x] **L8** — Integration test: capture → relay → SQLite → `ProcessStore.GroupLog.load` (`test/process-manager-log-pipeline.test.ts`).
- [x] **L9** — `ProcessStoreRunResource` (per-domain replacement for the removed generic `ProcessStoreRuntime` facet) replaces `RuntimeObserver.layerFromProcessStore` (legacy observer removed).
- [ ] **L10** — Changeset (user approval) for public API rename `Logs` → `GroupLog` on store and restored `./Logs` subpath.

---

## Facet vs namespace quick reference (target)

| Concern | Use |
|--------|-----|
| Persist/query group log events | `yield* ProcessStore` then `store.GroupLog.record` / `ProcessStore.GroupLog.load` |
| Capture Effect logs in child | `Logs.captureLoggerLayer` |
| Live tail + batch persist | `Logs.relayLayer` + `ProcessStore` in same layer stack |
| Operator `pm logs` | `ProcessManager` + `ProcessStore.GroupLog` / sqlite path |
| Operator `pm watch` | `Logs` stream helpers + control HTTP |
| Durable store composition | `layerProcessStore` from `storage/sqlite` |

**Do not use `ProcessStore.Logs` in new code** — use `ProcessStore.GroupLog` for persistence and `@nikscripts/effect-pm/Logs` for capture/relay.

---

## Open questions

1. **Facet name:** `GroupLog` vs `StructuredLog` vs `GroupLogHistory` — pick one before L4.
2. **Whether `ProcessStore.GroupLog.query` (replay)** stays on store facet or moves entirely to `ProcessManager` / `Logs`.
3. **Queue facet rename** — separate breaking changeset from log naming.

---

*Last updated to reflect: unified RuntimeStorage stack, merged `ProcessStore` namespaces, and explicit separation of PM `Logs` capture/relay from store persistence (no duplicate public name `Logs`).*
