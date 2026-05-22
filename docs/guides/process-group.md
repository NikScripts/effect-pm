# ProcessGroup

A **process group** registers **process** and **queue** entries under one id, tracks **running fibers** for each process, and exposes **typed controls** (`start`, `enqueue`, `pause`, …) plus a **contract** (`ProcessGroupContract`) that HTTP and remote clients use for discovery and preflight checks.

**Scope:** how to **define** a group, start/stop work, and wire control surfaces. Processes are defined with [`process.md`](./process.md); queues with [`queue-resource.md`](./queue-resource.md). Runtime is **in-process** — the group does not replace your app `Layer` tree; it orchestrates entries you already declared.

Spec tables: [`docs/SCHEDULE-AND-PROCESSGROUP.md`](../SCHEDULE-AND-PROCESSGROUP.md), [`docs/CODEBASE-INVENTORY.md`](../CODEBASE-INVENTORY.md) (ProcessGroup section).

---

## Mental model

| Moment | What happens |
| --- | --- |
| **`ProcessGroup.make` / `Service.layer`** | Registers processes and queues; process status is **stopped**; queue tags are acquired (workers per queue `autoStart`). |
| **`group.start(Entry)`** / **`startAll`** | Forks **`process.effect`** (schedule driver). For queues with **`autoStart: false`**, **`startAll`** calls **`queue.start`** first. |
| **Schedule armed** | Driver runs; instances tick when schedule entries cover “now” (see schedule guide). |
| **`group.stop` / `stopAll`** | Interrupts process fibers; lifecycle **Stopped**. |

**`make` does not “start the app.”** It builds the orchestrator. **`start`** attaches drivers.

---

## Ways to define a group

### `ProcessGroup.make(id, entries as const)`

Typed tuple of **`Process.Service`** classes and/or **`QueueResource.Service`** classes (legacy: `Process.make` handles + queue tags in `{ queues, processes }` — prefer the tuple form for contracts).

```typescript
import { Effect } from "effect";
import { ProcessGroup } from "@nikscripts/effect-pm";

const group = yield* ProcessGroup.make("@app/Billing", [
  SyncProcess,
  EmailQueue,
] as const);
```

**Benefits**

- **`group.contract`** — schema-backed `ProcessGroupContract` (`version: "v1"`).
- **`group.process(SyncProcess)`** / **`group.queue(EmailQueue)`** — typed controls, no string typos.
- Requirement inference: env must provide all queue tags (and process deps when forking).

**Tradeoffs**

- Tuple must be `as const` for full literal inference.
- All queue layers must be in scope when calling `make` (or use `Service.layer` below).

---

### `ProcessGroup.Service<Self>(id, entries, configItems?)`

Injectable group: **`id`**, **`entries`**, **`contract`**, **`make`**, **`layer`**. Merges bundled queue layers into **`layer`** so **`yield* BillingGroup`** and **`ControlService`** see the same queue tags.

```typescript
class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/Billing",
  [SyncProcess, EmailQueue] as const,
) {}
```

Optional third argument: **`ProcessManagerGroupConfigItem[]`** for endpoint labels (HTTP module launch, production URL, etc.) — see [`process-manager.md`](./process-manager.md).

---

### Legacy `ProcessGroup.make({ queues, processes })`

Untyped **`ProcessGroup<R>`** with **string** names (`group.start("id")`). Still supported; typed tuple is preferred for contracts and `ProcessManager`.

---

## Entry forms

| Entry | Form |
| --- | --- |
| Process | `Process.Service` class or `Process.make` handle |
| Queue | `QueueResource.Service` class (baked `.layer`) |
| Queue (DI) | `QueueResource.Tag` + provide `QueueResource.layer` in app env |

Empty queue list is valid (process-only group).

---

## Typed controls

### Processes — `group.process(ProcessEntry)`

| Control | Effect |
| --- | --- |
| `start` | Fork `process.effect` (schedule driver) |
| `stop` | Interrupt driver + instances |
| `restart` | `stop` then `start` |
| `runImmediately` | One tracked tick without requiring armed schedule |
| `status` | `ProcessGroupDetails` snapshot |

### Queues — `group.queue(QueueEntry)`

| Control | Effect |
| --- | --- |
| `add` / `enqueue` | Normal priority batch |
| `prioritize` / `defer` | High / low priority |
| `start` | Fork workers when `autoStart: false` |
| `pause` / `resume` | Worker latch |
| `clear` | Drain pending; returns count |
| `status` | `QueueDetails` |

When the queue declares **`itemSchema`**, contract includes **`release`** and enqueue may fail validation; typed enqueue errors flow from `QueueResource`.

### Group-level

| API | Role |
| --- | --- |
| `startAll` / `stopAll` | All entries |
| `status` | All processes + queues |
| `health` | Aggregate counts |
| `awaitShutdown` | Node SIGINT/SIGTERM → `stopAll` (local only) |

---

## Contract

**`ProcessGroupContract`:** `id`, `kind: "group"`, `version: "v1"`, `processes[]`, `queues[]`.

Each process entry lists allowed **`controls`**: `start`, `stop`, `restart`, `runImmediately`, `status`.

Each queue entry lists **`controls`**: `enqueue`, `start`, `pause`, `resume`, `clear`, `status` (plus `release` when schema present). The **`enqueue`** bit describes capability; **remote** clients still do not enqueue over HTTP (see process-manager guide).

**Schemas:** `ProcessGroupContractSchema`, `ProcessGroupProcessControlSchema`, `ProcessGroupQueueControlSchema` — used by `ProcessManager.verifyContract` and control routes.

---

## Remote group — `ProcessGroup.remoteLayer(GroupService, Endpoint)`

Same **service key** as local group, but controls go over HTTP to a **`ControlService`**. Requires **`ProcessManager.Endpoint`** (or compatible) for base URL.

**Supported remotely:** process lifecycle, queue pause/resume/clear/status, group status/health.

**Not supported remotely:** queue enqueue/add, `awaitShutdown`.

Errors widen to **`ProcessGroupRemoteControlError`**, **`UnsupportedRemoteControlError`**, etc.

---

## Errors

| Error | When |
| --- | --- |
| `ProcessNotFoundError` | Unknown process name |
| `ProcessAlreadyRunningError` | `start` when already running |
| `ProcessNotRunningError` | `stop` when stopped |
| `ProcessGroupControlError` | Union on typed group |

---

## Related tools

| Tool | Role |
| --- | --- |
| **`ControlService`** | Localhost HTTP for one group — [`control-plane.md`](./control-plane.md) |
| **`ProcessManager`** | Multi-group remote client + CLI — [`process-manager.md`](./process-manager.md) |
| **`ProcessStore`** | Execution + lifecycle events when layer provided |

---

## Implementation reference

| Location | Contents |
| --- | --- |
| `src/ProcessGroup.ts` | `make`, `Service`, `remoteLayer`, contracts |
| `src/ControlProtocol.ts` | Envelopes + router |
| `src/ControlTransportHttp.ts` | HTTP server |
