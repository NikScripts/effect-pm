# Storage integration inventory

**Purpose.** Per-source-module view of how each runtime module relates to storage today: which facet it uses, whether it should grow one, or whether it correctly stays storage-free. **Complements** [STORAGE-AGENT-HANDBOOK.md](./STORAGE-AGENT-HANDBOOK.md) — the handbook is the assignment dispatcher for per-module facet setup, this file is the audit snapshot.

- **Rules** → [`STORAGE.md`](./STORAGE.md), [`AGENTS.md`](./AGENTS.md), [`.cursor/rules/public-vs-internal.mdc`](../.cursor/rules/public-vs-internal.mdc)
- **How to build a facet** → [`STORAGE-FACET-AUTHORING-GUIDE.md`](./STORAGE-FACET-AUTHORING-GUIDE.md)
- **Per-module assignments** → [`STORAGE-AGENT-HANDBOOK.md`](./STORAGE-AGENT-HANDBOOK.md)

---

## Per-module inventory

| Module | Storage relationship today | Open assignment |
|---|---|---|
| `Process` | Uses `ProcessStoreProcessExecution` static optional emitters (`recordCompleted` / `recordFailed`) + `Effect.serviceOption(ProcessStoreProcessExecution)` for reads. No raw `append`. | — |
| `ProcessGroup` | Uses `ProcessStoreProcessGroup.recordMemberLifecycle` (typed groups with `id`) or `ProcessStoreProcessLifecycle.lifecycleChanged` (un-typed). No raw `append`. | — |
| `QueueResource` | Publishes through `ProcessStoreQueueResource` (hand-rolled `Context.Service`) — currently wraps writes in `runtime.fact.recorded` envelope with `queue.*` fact subtypes. | [Handbook Assignment 1](./STORAGE-AGENT-HANDBOOK.md#assignment-1--migrate-processstorequeueresource-off-the-internal-factenvelope) |
| `RunResource` | Publishes through `ProcessStoreRunResource` per-type static emitters (`recordRunStarted` / `recordRunCompleted` / `recordRunFailed` / `recordStateChange`). Reference facet implementation. | — |
| `HttpApiResource` | Concurrency gating only. No analytics. | [Handbook Assignment 3](./STORAGE-AGENT-HANDBOOK.md#assignment-3--design-proposal-telemetry-for-polling-processschedule-httpapiresource) (design proposal) |
| `HttpClientRunGate` | Thin `HttpClient.transform` wrapper. Delegates to `RunResource` runner instrumentation. No storage. | — |
| `Polling` | No telemetry. | [Handbook Assignment 3](./STORAGE-AGENT-HANDBOOK.md#assignment-3--design-proposal-telemetry-for-polling-processschedule-httpapiresource) (design proposal) |
| `ProcessSchedule` | No telemetry. | [Handbook Assignment 3](./STORAGE-AGENT-HANDBOOK.md#assignment-3--design-proposal-telemetry-for-polling-processschedule-httpapiresource) (design proposal) |
| `Resource` | Generic helper. No storage. | — |
| `Logs` (`@nikscripts/effect-pm/Logs`) | Capture + relay. Persistence flows into `ProcessStoreLog.recordBatch`. | [Handbook Assignment 2](./STORAGE-AGENT-HANDBOOK.md#assignment-2--decide-processstorelog-builder-or-documented-exception) (builder migration or hand-rolled exception) |
| `ProcessManager` (operator) | Reads via `ProcessStoreLog.load` / `.query`; opens per-group SQLite in operator paths. | — (extend filters / pagination if product needs it) |
| `ControlService`, `ControlProtocol`, `ControlTransportHttp`, `cli.ts` | Transport / wire / CLI only. No persistence. Persistence is the child / group's responsibility. | — |
| `disarmedIdleSleep`, `Query`, `LogContext`, `LogEntry`, `Transport`, `processLayerBrand` | Pure policy / types / utilities. No storage. | — |

### Infrastructure debt (tracked here, not in the handbook)

The handbook is scoped to **per-module storage-service setup**. Cross-cutting infrastructure work below is real but doesn't fit that frame. Open new assignments when scheduled.

| Module | Current state | Debt |
|---|---|---|
| `ProcessStore` (combiner module) | Still a `Context.Service` + `ProcessStoreInterface` monolith alongside the namespace combiner. `memory` / `file` / `fileLayer` deprecated. | Demolish the monolith — every per-domain facet ships its own writers/readers; only the namespace combiner remains. |
| `RuntimeStorage` | Normalized `RuntimeRecord` port. Implemented by `storage/sqlite`. Prisma placeholder. | Prisma rebuild — replace `PrismaProcessStoreUnavailableError` with a real adapter over `storage/prisma`. |
| `storage/sqlite` | `layerProcessStore` over `Layer.orDie`. | Surface typed errors instead of `Layer.orDie`. |
| `storage/file` | Legacy NDJSON. `@deprecated`. | Delete — the only blessed durable adapter is `storage/sqlite`. |
| `prisma/*` | `PrismaProcessStoreUnavailableError` placeholder; legacy codec only. | Tracked with `RuntimeStorage` Prisma rebuild above. |

### ProcessManager support modules (no facet of their own)

| Module | Role |
|---|---|
| `logCapture`, `logPersistRelay`, `logHistory`, `logQuery`, `groupLogWatch*` | PM log pipeline — uses `ProcessStoreLog`. |
| `groupChild`, `groupRuntime`, `childLaunch` | Compose `layerProcessStore` + capture/relay stack at the child process boundary. |
| `processManagerLogContext`, `ProcessManagerTargetResolver` | Scope annotations and target lookup; pure types. |

---

## Wire event types in the spine

| `type` literal | Public writer | Public reader | Notes |
|---|---|---|---|
| `process.execution.completed` | `ProcessStoreProcessExecution.recordCompleted` / `recordFailed` static emitters | `ProcessStoreProcessExecution.executions(processId)` | — |
| `process.lifecycle.changed` | `ProcessStoreProcessLifecycle.lifecycleChanged` *(no group id)* or `ProcessStoreProcessGroup.recordMemberLifecycle(groupId, …)` *(typed group)* | `ProcessStoreProcessLifecycle.lifecycle(processId)` / `ProcessStoreProcessGroup.lifecycleByGroup(groupId)` | Typed groups annotate rows with `attributes.groupId`. |
| `run-resource.fact.recorded` | `ProcessStoreRunResource.recordRunStarted` / `recordRunCompleted` / `recordRunFailed` | `ProcessStoreRunResource.facts` / `.runs` / `.byRun` | Per-domain, fully concrete shapes. |
| `run-resource.state.changed` | `ProcessStoreRunResource.recordStateChange` | `ProcessStoreRunResource.stateHistory` / `.latestState` | — |
| `runtime.fact.recorded` *(internal envelope)* | `ProcessStoreQueueResource` writes — currently wraps `queue.*` payloads in the internal envelope | internal spine helpers (`src/internal/store/spine.ts`) | Migrates to `queue.*` wire types in [Handbook Assignment 1](./STORAGE-AGENT-HANDBOOK.md#assignment-1--migrate-processstorequeueresource-off-the-internal-factenvelope). |
| `runtime.state.changed` *(internal envelope)* | same | same | — |
| `log.entry` | `ProcessStoreLog.recordBatch` (via the relay) | `ProcessStoreLog.load` / `.query` | `entityType: "log"`, `entityId` is the relay-supplied log bucket. |

---

*Linked from [`AGENTS.md`](./AGENTS.md), [`STORAGE.md`](./STORAGE.md), [`STORAGE-AGENT-HANDBOOK.md`](./STORAGE-AGENT-HANDBOOK.md), [`STORAGE-FACET-AUTHORING-GUIDE.md`](./STORAGE-FACET-AUTHORING-GUIDE.md), [`ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md`](./ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md).*
