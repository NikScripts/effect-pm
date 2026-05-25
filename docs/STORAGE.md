# Storage

**Single source of truth for persistence in this package.** Read this before changing `src/store/*`, `ProcessStore`, or `RuntimeStorage`.

## Rules

- **Stack:** `RuntimeStorage` (rows) + per-domain facets in `src/store/` (`@nikscripts/effect-pm/store/*`). `ProcessStore` = facet builder. `ProcessStorage` = combined built-in facet layers. The legacy monolith service is removed.
- **One facet per domain.** Concrete wire event types. No public `RuntimeFact` / `runtime.fact.recorded` on new facets (`ProcessStoreQueueResource` still on envelope — fix listed below).
- **Optional storage.** Domain code uses **static emitters** on facet classes (`ProcessStoreX.recordY(...)`). No-op without layer; write failures logged, never change caller success/error (`ProcessStore` wraps emits).
- **Reads:** `Effect.serviceOption(ProcessStoreX)` then `Option.match({ onNone, onSome: (store) => store.read(...) })` — never static read methods on the facet class. No `Effect.serviceOption(ProcessStore)` monolith in domain modules.
- **No backward compat.** Delete legacy APIs; no `@deprecated` shims.
- **Logs:** capture/relay → `@nikscripts/effect-pm/Logs`. Durable rows → `ProcessStoreLog` (`log.entry`), backed by `ProcessStore`. Not `ProcessStoreGroupLog`.
- **Durable:** `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`. Do not add `ProcessStore.file` / NDJSON.

Verify: `pnpm typecheck && pnpm test && pnpm lint && pnpm build`

---

## Modules to refactor

| Module | Facet | Work |
|--------|-------|------|
| `src/QueueResource.ts` | `ProcessStoreQueueResource` | **Now:** hand-rolled + `runtime.fact.recorded` envelope. **Target:** `ProcessStore.Service` + concrete `queue.*` wire types; static emitters in `QueueResource.ts` (see Assignment 1). |
| `src/store/log.ts` + `internal/manager/log*` | `ProcessStoreLog` | Done — builder facet; relay uses static `record` / `recordBatch`; reads via `yield* ProcessStoreLog`. |
| `src/ProcessStore.ts` | builder | Done — facet builder only. |
| `src/ProcessStorage.ts` | combiner | Done — combined built-in facet layers. |
| `src/prisma/*` | — | Rebuild as `RuntimeStorage` adapter (Assignment 5). |
| `src/storage/sqlite/index.ts` | — | Replace `Layer.orDie` with typed errors (Assignment 6). |
| `src/RunResource.ts` | `ProcessStoreRunResource` | Done — reference |
| `src/Process.ts` | `ProcessStoreProcessExecution` | Done |
| `src/ProcessGroup.ts` | `ProcessStoreProcessLifecycle`, `ProcessStoreProcessGroup` | Done |
| `src/Polling.ts`, `src/ProcessSchedule.ts`, `src/HttpApiResource.ts` | — | Assignment 3: proposal only |
| `src/HttpClientRunGate.ts`, `src/Resource.ts`, Control/*, `cli.ts` | — | No storage |

### Removed legacy monolith callers

| Path | Use instead |
|------|-------------|
| `test/process-store.test.ts` | Deleted; facet suites own storage behavior |
| `test/process-group.test.ts` | Uses `ProcessStoreProcessLifecycle.lifecycle` |
| `test/logs.test.ts`, `test/process-manager-log-pipeline.test.ts` | Use `yield* ProcessStoreLog` for reads |
| `examples/forms/process-store/*` | Use facets + `ProcessStorage` / `layerProcessStore` |

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
| `ProcessStore` | `ProcessStore` | facet builder |
| `ProcessStorage` | `ProcessStorage` | combined built-in facet layers |
| `RuntimeStorage` | `RuntimeStorage` | `src/RuntimeStorage.ts` |

Internal only: `src/internal/store/{spine,codec,service,factEnvelope}.ts`

Context key: `@nikscripts/effect-pm/store/<file>/<ServiceTag>`

Import `store/QueueResource` for the **storage facet**, not `@nikscripts/effect-pm/QueueResource` (worker).

---

## Wire events

| `type` | Writer | Reader |
|--------|--------|--------|
| `process.execution.completed` | static `recordCompleted` / `recordFailed` / `recordInterrupted` | `yield* ProcessStoreProcessExecution` → `.executions` |
| `process.lifecycle.changed` | static `lifecycleChanged` / `recordMember*` | `yield* ProcessStoreProcessLifecycle` / `ProcessStoreProcessGroup` → read methods |
| `run-resource.fact.recorded` | static `recordRun*` | `yield* ProcessStoreRunResource` → `.facts`, `.runs`, `.byRun` |
| `run-resource.state.changed` | static `recordStateChange` | `yield* ProcessStoreRunResource` → `.stateHistory`, `.latestState` |
| `log.entry` | static `record` / `recordBatch` (relay) | `yield* ProcessStoreLog` → `.load`, `.query` |
| `runtime.fact.recorded` | `ProcessStoreQueueResource` only (legacy) | `records` — remove |

---

## Usage

```ts
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";
import { ProcessStoreProcessExecution } from "@nikscripts/effect-pm/store/ProcessExecution";

yield* ProcessStoreProcessExecution.recordCompleted(input);

const rows = yield* Effect.serviceOption(ProcessStoreProcessExecution).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeed([]),
      onSome: (store) => store.executions({ processId: "billing/sync" }),
    }),
  ),
);
```

```ts
import { ProcessStorage } from "@nikscripts/effect-pm";

Effect.provide(program, ProcessStorage.layer); // in-memory, all facets
Effect.provide(program, layerProcessStore({ filename: ".effect-pm/data.sqlite" }));
```

---

## Authoring a facet (`ProcessStore.Service`)

Template: `src/store/runResource.ts`, tests: `test/process-store-run-resource-facet.test.ts`.

```ts
export class ProcessStoreMyDomain extends ProcessStore.Service<ProcessStoreMyDomain>()(
  "@nikscripts/effect-pm/store/myDomain/ProcessStoreMyDomain",
  ProcessStore.record((s) => ({
    recordThing: (fact: MyFact) => s.append(toWireEvent(fact)),
  })),
  ProcessStore.read((s) => ({
    facts: (query?: MyQuery) =>
      s.events(myStoreQuery(query)).pipe(Effect.map(project)),
  })),
) {}

export declare namespace ProcessStoreMyDomain {
  export type Type = ProcessStore.Service.Type<typeof ProcessStoreMyDomain>;
  export type EmitType = ProcessStore.Service.EmitType<typeof ProcessStoreMyDomain>;
}
```

Builder gives: shared spine per layer, static emitters only (optional + failure-isolated), reads via `Effect.serviceOption` on the facet tag + service methods, `layerRuntimeStorage`, `layer`.

**Cut-over checklist:** domain types → wire events in `ProcessStoreEvent.ts` → codec/spine → facet file → feature module static emitters → `ProcessStorage.layerRuntimeStorage` merge + `package.json` subpath → conformance test.

**Do not:** public envelope types; `store.append` from apps; hand-roll `serviceOption` in feature modules; `ProcessStore.<domain>.*` namespaces on monolith.

**Adapters:** implement `RuntimeStorageService` in `RuntimeStorage.ts`; wire via `ProcessStorage.layerRuntimeStorage` or `layerProcessStore`. Do not implement domain APIs in adapters.

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

### 2 — `ProcessStoreLog` → `ProcessStore.Service` — done

**Goal.** Replace hand-rolled `Context.Service` in `src/store/log.ts` with `ProcessStore.Service` (same pattern as `ProcessStoreRunResource`). Wire stays `log.entry`.

**Files:** `src/store/log.ts`, `src/internal/manager/logPersistRelay.ts`, `src/internal/manager/logHistory.ts`, `src/internal/manager/logQuery.ts`, `test/logs.test.ts`, `test/process-manager-log-pipeline.test.ts`, new `test/process-store-log-facet.test.ts` (mirror run-resource conformance).

**Done when:** `ProcessStoreLog extends ProcessStore.Service`; static `record` / `recordBatch` only; reads via `yield* ProcessStoreLog`; relay uses static emitters; conformance tests pass.

### 3 — Telemetry proposals (`Polling`, `ProcessSchedule`, `HttpApiResource`)

**Phase 1 only:** three files under `docs/storage-proposals/` (≤300 lines each): facet yes/no, wire types, cardinality, correlation, layers, open questions. No code.

### 4 — Delete NDJSON — done

`src/storage/file.ts`, `ProcessStore.file` / `fileLayer`, the file example, and legacy monolith tests are removed.

### 5 — Prisma `RuntimeStorage` adapter

Replace `PrismaProcessStoreUnavailableError` stub.

### 6 — SQLite typed errors

`storage/sqlite` — stop `Layer.orDie` for storage failures.
