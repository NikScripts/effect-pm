# Storage

**Single source of truth for persistence in this package.** Read this before changing `src/store/*`, `ProcessStore`, or `RuntimeStorage`.

## Rules

- **Stack:** `RuntimeStorage` (rows) + per-domain facets in `src/store/` (`@nikscripts/effect-pm/store/*`). `ProcessStore` = layer combiner only; legacy `ProcessStoreInterface` (`append`, `events`, `getProcessLifecycle`, …) is being removed.
- **One facet per domain.** Concrete wire event types. No public `RuntimeFact` / `runtime.fact.recorded` on new facets (`ProcessStoreQueueResource` still on envelope — fix listed below).
- **Optional storage.** Domain code uses **static emitters** on facet classes (`ProcessStoreX.recordY(...)`). No-op without layer; write failures logged, never change caller success/error (`ProcessStoreBuilder` wraps emits).
- **Reads:** static methods on facet classes (`ProcessStoreProcessExecution.executions(...)`) or `yield* Facet` for instance API. No `Effect.serviceOption(ProcessStore)` in domain modules.
- **No backward compat.** Delete legacy APIs; no `@deprecated` shims.
- **Logs:** capture/relay → `@nikscripts/effect-pm/Logs`. Durable rows → `ProcessStoreLog` (`log.entry`). Not `ProcessStoreGroupLog`.
- **Durable:** `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`. Do not add `ProcessStore.file` / NDJSON.

Verify: `pnpm typecheck && pnpm test && pnpm lint && pnpm build`

---

## Modules to refactor

| Module | Facet | Work |
|--------|-------|------|
| `src/QueueResource.ts` | `ProcessStoreQueueResource` | **Now:** hand-rolled + `runtime.fact.recorded` envelope. **Target:** `ProcessStoreBuilder.Service` + concrete `queue.*` wire types; static emitters in `QueueResource.ts` (see Assignment 1). |
| `src/store/log.ts` + `internal/manager/log*` | `ProcessStoreLog` | Hand-rolled. Assignment 2: builder migration or documented exception (relay shared state). |
| `src/ProcessStore.ts` | combiner | Remove monolith `ProcessStoreInterface`; keep facet merge only. |
| `src/internal/store/composite.ts` | — | Shrink when monolith goes. |
| `src/storage/file.ts` | — | Delete (Assignment 4). |
| `src/prisma/*` | — | Rebuild as `RuntimeStorage` adapter (Assignment 5). |
| `src/storage/sqlite/index.ts` | — | Replace `Layer.orDie` with typed errors (Assignment 6). |
| `src/RunResource.ts` | `ProcessStoreRunResource` | Done — reference |
| `src/Process.ts` | `ProcessStoreProcessExecution` | Done |
| `src/ProcessGroup.ts` | `ProcessStoreProcessLifecycle`, `ProcessStoreProcessGroup` | Done |
| `src/Polling.ts`, `src/ProcessSchedule.ts`, `src/HttpApiResource.ts` | — | Assignment 3: proposal only |
| `src/HttpClientRunGate.ts`, `src/Resource.ts`, Control/*, `cli.ts` | — | No storage |

### Tests / examples still on legacy monolith

| Path | Use instead |
|------|-------------|
| `test/process-store.test.ts` | Facet APIs; drop `ProcessStore.file` block when file storage deleted |
| `test/process-group.test.ts` | `ProcessStoreProcessLifecycle.lifecycle` |
| `test/logs.test.ts`, `test/process-manager-log-pipeline.test.ts` | `ProcessStoreLog` |
| `examples/forms/process-store/*` | Facet + `layerProcessStore` |

### OK for now (combiner host only)

Anything that only `Effect.provide(ProcessStore.layer)` and does not call `store.append` / `getProcessLifecycle` / `getQueue*`.

---

## Facets and layout

| Tag | Subpath | File |
|-----|---------|------|
| `ProcessStoreRunResource` | `store/RunResource` | `src/store/runResource.ts` |
| `ProcessStoreQueueResource` | `store/QueueResource` | `src/store/queueResource.ts` |
| `ProcessStoreLog` | `store/Log` | `src/store/log.ts` |
| `ProcessStoreProcessLifecycle` | `store/ProcessLifecycle` | `src/store/processLifecycle.ts` |
| `ProcessStoreProcessGroup` | `store/ProcessGroup` | `src/store/processGroup.ts` |
| `ProcessStoreProcessExecution` | `store/ProcessExecution` | `src/store/processExecution.ts` |
| `ProcessStore` | `ProcessStore` | combiner + legacy monolith |
| `RuntimeStorage` | `RuntimeStorage` | `src/RuntimeStorage.ts` |

Internal only: `src/internal/store/{spine,codec,composite,service,factEnvelope}.ts`

Context key: `@nikscripts/effect-pm/store/<file>/<ServiceTag>`

Import `store/QueueResource` for the **storage facet**, not `@nikscripts/effect-pm/QueueResource` (worker).

---

## Wire events

| `type` | Writer | Reader |
|--------|--------|--------|
| `process.execution.completed` | `ProcessStoreProcessExecution.recordCompleted` / `recordFailed` / `recordInterrupted` | `.executions` |
| `process.lifecycle.changed` | `ProcessStoreProcessLifecycle.lifecycleChanged` or `ProcessStoreProcessGroup.recordMember*` | `.lifecycle` / `.lifecycleByGroup` |
| `run-resource.fact.recorded` | `ProcessStoreRunResource.recordRun*` | `.facts`, `.runs`, `.byRun` |
| `run-resource.state.changed` | `ProcessStoreRunResource.recordStateChange` | `.stateHistory`, `.latestState` |
| `log.entry` | `ProcessStoreLog` via relay | `.load`, `.query` |
| `runtime.fact.recorded` | `ProcessStoreQueueResource` only (legacy) | `records` — remove |
| `queue.item.completed`, `queue.lifecycle.changed` | monolith `append` only | monolith `getQueue*` — remove |

---

## Usage

```ts
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";
import { ProcessStoreProcessExecution } from "@nikscripts/effect-pm/store/ProcessExecution";

yield* ProcessStoreProcessExecution.recordCompleted(input);
const rows = yield* ProcessStoreProcessExecution.executions({ processId: "billing/sync" });
```

```ts
import { ProcessStore } from "@nikscripts/effect-pm";

Effect.provide(program, ProcessStore.layer); // in-memory, all facets
Effect.provide(program, layerProcessStore({ filename: ".effect-pm/data.sqlite" }));
```

---

## Authoring a facet (`ProcessStoreBuilder.Service`)

Template: `src/store/runResource.ts`, tests: `test/process-store-run-resource-facet.test.ts`.

```ts
export class ProcessStoreMyDomain extends ProcessStoreBuilder.Service<ProcessStoreMyDomain>()(
  "@nikscripts/effect-pm/store/myDomain/ProcessStoreMyDomain",
  ProcessStoreBuilder.record((s) => ({
    recordThing: (fact: MyFact) => s.append(toWireEvent(fact)),
  })),
  ProcessStoreBuilder.read((s) => ({
    facts: (query?: MyQuery) =>
      s.events(myStoreQuery(query)).pipe(Effect.map(project)),
  })),
) {}

export declare namespace ProcessStoreMyDomain {
  export type Type = ProcessStoreBuilder.Service.Type<typeof ProcessStoreMyDomain>;
  export type EmitType = ProcessStoreBuilder.Service.EmitType<typeof ProcessStoreMyDomain>;
}
```

Builder gives: shared spine per layer, static emitters (optional + failure-isolated), static readers (stub when layer absent), `layerRuntimeStorage`, `layer`.

**Cut-over checklist:** domain types → wire events in `ProcessStoreEvent.ts` → codec/spine → facet file → feature module static emitters → `ProcessStore.layerRuntimeStorage` merge + `package.json` subpath → delete legacy → conformance test.

**Do not:** public envelope types; `store.append` from apps; hand-roll `serviceOption` in feature modules; `ProcessStore.<domain>.*` namespaces on monolith.

**When builder is not enough:** shared per-layer state (e.g. log relay buffer). Either defer streaming/`live()` or hand-roll `Context.Service` and document why. `ProcessStoreLog` is the open case (Assignment 2).

**Adapters:** implement `RuntimeStorageService` in `RuntimeStorage.ts`; wire via `ProcessStore.layerRuntimeStorage` or `layerProcessStore`. Do not implement `ProcessStoreInterface` for new backends.

---

## Agent assignments

One assignment per agent run. No PR/commit unless asked.

```
Do "<title>" from docs/STORAGE.md § Agent assignments.

Read docs/STORAGE.md only. Stay in listed files. No backward-compat shims.

Verify: pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

### 1 — `ProcessStoreQueueResource` → builder + `queue.*` wire types

**Files:** `src/store/queueResource.ts`, `src/QueueResource.ts`, `src/ProcessStoreEvent.ts`, `src/internal/store/codec.ts`, `src/internal/store/spine.ts`, `test/queue-resource.test.ts`, `test/process-store.test.ts` (queue parts), new `test/process-store-queue-resource-facet.test.ts`.

**Off limits:** other `src/store/*` except as needed for combiner exports.

**Done when:** builder facet; static emitters from `QueueResource`; no `serviceOption(ProcessStoreQueueResource)`; conformance tests; legacy SQLite envelope rows still decode; changeset for breaking wire rename.

### 2 — `ProcessStoreLog`: builder or documented exception

**Phase 1 only:** `docs/storage-proposals/log-builder.md` — option A extend builder with shared `make` context vs B keep hand-rolled + shared emitter helper. No `src/` edits.

### 3 — Telemetry proposals (`Polling`, `ProcessSchedule`, `HttpApiResource`)

**Phase 1 only:** three files under `docs/storage-proposals/` (≤300 lines each): facet yes/no, wire types, cardinality, correlation, layers, open questions. No code.

### 4 — Delete NDJSON

Remove `src/storage/file.ts`, `ProcessStore.file` / `fileLayer`, file examples/tests.

### 5 — Prisma `RuntimeStorage` adapter

Replace `PrismaProcessStoreUnavailableError` stub.

### 6 — SQLite typed errors

`storage/sqlite` — stop `Layer.orDie` for storage failures.
