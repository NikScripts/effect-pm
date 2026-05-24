# ProcessStore / RuntimeStorage integration inventory

**Purpose:** Every runtime module that should integrate with optional **`ProcessStore`** (and, at compose time, **`RuntimeStorage`** adapters). Use this to split work across parallel agents. Not limited to modules that already call legacy `append` / `getProcessExecutions`.

**Agent prompts (A–Z):** [**STORAGE-AGENT-HANDBOOK.md**](./STORAGE-AGENT-HANDBOOK.md) — share with an agent: *“Do Part C”*.

**Rules:** [`STORAGE.md`](./STORAGE.md), [`ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md`](./ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md).

**Pattern:** Domain modules use `Effect.serviceOption(ProcessStoreGroupLog | ProcessStoreQueueResource | ProcessStore)` (or `RuntimeObserver`) — analytics when the layer is present, silent no-op when absent. Writes go through **facet services** (`ProcessStoreQueueResource`, `ProcessStoreGroupLog`, future `ProcessStore.ProcessExecution`, etc.), not ad-hoc `append` from feature code. Slim imports: e.g. `QueueResource` depends only on `ProcessStoreQueueResource`.

---

## High severity audit (owner: main agent — status)

| ID | Issue | Status |
|----|--------|--------|
| **H1** | `ProcessStore` must not import PM relay | **Fixed** — no `processManagerLogsRelay` import in `ProcessStore.ts` |
| **H2** | Duplicate `relayLayer` in group child | **Fixed** — single merge on `envLayer` in `groupChild.ts` |
| **H3** | Two `layerProcessStore` symbols | **Fixed** — `RuntimeObserver.layerFromProcessStore`; deprecated alias `layerProcessStore` |
| **H4** | Docs say RuntimeStorage “planned” | **Fixed** — `PROCESS-API.md` aligned with implementation |
| **H5** | File-backed second persistence model | **Quarantined** — `@deprecated` on `ProcessStore.file` / `fileLayer`; use only via `@nikscripts/effect-pm/storage/file`. **Follow-up agent:** file layer on `RuntimeStorage` or removal |
| **H6** | No capture → relay → SQLite test | **Fixed** — `test/process-manager-log-pipeline.test.ts`; also fixed Effect v4 `captureLogger` (void + scheduled publish) and relay flush-on-publish |

---

## Agent handoff matrix (all modules)

| Module | Needs `ProcessStore`? | Today | Target facet / API | Agent |
|--------|----------------------|-------|-------------------|-------|
| **`Process`** | **Yes** | Optional `append` (`process.execution.completed`); reads via `getProcessExecutions` | `ProcessStore.ProcessExecution` (record + query); stop using raw `append` / legacy getter | **C** |
| **`ProcessGroup`** | **Yes** | Optional `append` (`process.lifecycle.changed`); status derived from process + store | `ProcessStore.ProcessLifecycle` + projection helpers for group `status` / `ls` | **D** |
| **`QueueResource`** | **Yes** | Optional writes via **`ProcessStoreQueueResource`** service | **Done** — extend queries/analytics only if product needs more | — |
| **`RunResource`** | **Yes** | Publishes via **`RuntimeObserver`** (`publishFact` / `publishStateChange`) | Persist through **`ProcessStore.Runtime`** facet writes (not raw `append` in observer layer) | **C** (shared with runtime) |
| **`HttpApiResource`** | **Yes** | **No integration today** | Same as `RunResource`: in-flight / completed / failed HTTP run facts + optional state snapshots | **E** |
| **`Polling`** | **Yes** (telemetry) | No store | Tick/armed/disarmed or skip events tied to process id (or schedule key) | **F** |
| **`ProcessSchedule`** | **Yes** (telemetry) | No store | Schedule arm/disarm / window transitions for analytics | **F** |
| **`RuntimeState` / `RuntimeObserver`** | **Yes** (infra) | `layerFromProcessStore` uses raw `append` for facts/state | **`ProcessStore.Runtime`** facet: `recordFact`, `recordStateChange`, queries = current `ProcessStore.runtime.*` | **B** |
| **`Logs`** (`@nikscripts/effect-pm/Logs`) | **Yes** (capture) | `relayLayer` → **`ProcessStoreGroupLog.recordBatch`** | **Done** for persistence path | — |
| **`ProcessManager`** (operator) | **Yes** (read) | `GroupLog.load` / `query`, sqlite paths for `pm logs` | No new facet; wire richer filters / cross-target queries | Playground agent |
| **`groupChild`** | **Yes** (compose) | `layerProcessStore` + `Logs` stack | Document only; no domain writes | — |
| **`ControlService`** | **No writes** | `ProcessStore` in **type** requirements for group entry | Stays transport-only; persistence is child/group responsibility | — |
| **`ControlProtocol` / `ControlTransportHttp`** | **No** | — | — | — |
| **`cli.ts`** (package) | **No** | HTTP client | — | — |
| **`disarmedIdleSleep`** | **No** | Pure policy | — | — |
| **`Query.ts`** | **No** | Generic query helpers | — | — |
| **`prisma/*`** | **Adapter** | Not production-ready | `RuntimeStorage` + `ProcessStore.layerRuntimeStorage` adapter | **File/sqlite agent** (after file layer) |

### Infrastructure (not feature agents)

| Module | Role | Agent |
|--------|------|-------|
| **`RuntimeStorage`** | Port | **B** (with observer facet) |
| **`ProcessStore`** | Facade + codec | **B** (facet growth only) |
| **`ProcessStoreCodec` / `ProcessStoreEvent`** | Encode/decode | With whichever facet adds event types |
| **`storage/sqlite`** | `layerProcessStore` | **B** (M7: surface `SqlError` vs `orDie`) |
| **`storage/file`** | Legacy NDJSON | **File storage agent** — H5: RuntimeStorage-backed file or delete |

### ProcessManager support modules (no separate storage facet)

| Module | Role |
|--------|------|
| `processManagerLogsRelay`, `processManagerLogRelay`, `processManagerLogQuery`, `processManagerLogHistory` | PM log pipeline (uses `GroupLog`) |
| `processManagerGroupLogs`, `processManagerGroupLogsInteractive` | `pm watch` |
| `processManagerGroupRuntime`, `processManagerChildLaunch` | Compose store + logs paths |
| `processManagerLogContext` | Annotations / scopes |
| `ProcessManagerTargetResolver` | Target resolution for watch/logs |

---

## Event types already in the spine

| Event type | Written by | Read by |
|------------|------------|---------|
| `process.execution.completed` | `Process.ts` (raw append) | `getProcessExecutions` |
| `process.lifecycle.changed` | `ProcessGroup.ts` (raw append) | `events` / status derivation |
| `queue.*` | `QueueResource` → **QueueResource facet** | **QueueResource** queries |
| `runtime.fact.recorded` | `RuntimeObserver.layerFromProcessStore` | `ProcessStore.runtime.facts` |
| `runtime.state.changed` | same | `ProcessStore.runtime.stateHistory` |
| `group.log.entry` | **GroupLog** facet / relay | `GroupLog.load` / `query` |

---

## Recommended parallel agents (1–5+)

1. **Agent B — Runtime facet + sqlite hardening** — `ProcessStore.Runtime` write API; migrate `RuntimeObserver.layerFromProcessStore`; optional M7 (`orDie` → surfaced `SqlError`).
2. **Agent C — Process + RunResource** — `ProcessExecution` facet; migrate `Process.ts`; align `RunResource` fact types with facet.
3. **Agent D — ProcessGroup lifecycle** — lifecycle facet; group status projections from store.
4. **Agent E — HttpApiResource** — optional observer/facts for gated HTTP client (mirror `RunResource`).
5. **Agent F — Schedule/Polling telemetry** — arm/disarm/tick events when `ProcessStore` present.
6. **Agent G — File storage layer** (after B) — replace NDJSON `makeFileProcessStore` with `RuntimeStorage` adapter or remove from public surface.
7. **Playground agent** — README + manual `watch` / `logs` recipes; optional smoke script.

---

## Verification per agent

- `pnpm run typecheck`
- `pnpm test` (add facet tests beside `test/runtime-storage.conformance.ts`, `test/logs.test.ts`, `test/process-manager-log-pipeline.test.ts`)
- No new storage `Layer`s on domain modules (compose at app/child only)

*Linked from [`ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md`](./ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md).*
