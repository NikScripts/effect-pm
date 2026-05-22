# ProcessGroup

A **process group** is the runtime bundle for your app: **process** and **queue** entries share one canonical **id**, one **contract** (`ProcessGroupContract`), and one set of **typed controls**. **`ProcessManager`** and **`ControlService`** talk to that contract over HTTP — they do not replace the group; they remote-control it.

Define processes with [`process.md`](./process.md) and queues with [`queue-resource.md`](./queue-resource.md) first. This guide covers **group composition** and **lifecycle** only.

---

## Canonical shape: `ProcessGroup.Service`

```typescript
import { Effect, Layer } from "effect";
import {
  Endpoint,
  Process,
  ProcessGroup,
  ProcessManager,
  ProcessStore,
  QueueResource,
} from "@nikscripts/effect-pm";

class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
  "@app/Billing/EmailQueue",
  (email) => sendEmail(email).pipe(Effect.asVoid),
  { concurrency: 10 },
) {}

class SyncInvoices extends Process.Service<SyncInvoices>()(
  "@app/Billing/SyncInvoices",
  syncEffect,
  Polling.spaced("30 seconds"),
  ProcessSchedule.alwaysArmed,
) {}

class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/Billing/BillingGroup",
  [SyncInvoices, EmailQueue] as const,
  [
    Endpoint.local(
      Endpoint.module(
        () => import("./billing-runtime.js"),
        (mod) => mod.BillingRuntime,
      ),
    ).default,
    Endpoint.production(
      Endpoint.http({
        transport: ProcessManager.Transport.http({
          baseUrl: "http://127.0.0.1:3001",
        }),
      }),
    ),
  ],
) {}
```

**What you get on the class**

| Field | Role |
| --- | --- |
| `id` | Group id (canonical, slash-separated) |
| `entries` | Tuple of process/queue **service classes** |
| `config` | Endpoint items for **`ProcessManager.cli`** (`--target`) |
| `contract` | `ProcessGroupContract` (`version: "v1"`) |
| `layer` | Acquires group + merges queue layers for handlers |
| `make` | `Effect` yielding **`TypedProcessGroup`** |

**`as const` on the entries tuple is required** for literal process/queue ids in the contract.

---

## `ProcessGroup.make(id, entries, configItems?)`

Same runtime as **`Service`**, without a group Context tag:

```typescript
const group = yield* ProcessGroup.make("@app/Billing/BillingGroup", [
  SyncInvoices,
  EmailQueue,
] as const);
```

Use **`Service`** when the group is a first-class dependency (recommended for apps + PM endpoints).

---

## Runtime wiring with `ProcessManager.LocalRuntime`

Out-of-process ops (**`group-start`**) need a **descriptor** that pairs app layers with control HTTP:

```typescript
export const BillingRuntime = ProcessManager.LocalRuntime(BillingGroup, {
  layer: BillingGroup.layer.pipe(
    Layer.provide(Layer.mergeAll(SyncInvoices.layer, EmailQueue.layer, ProcessStore.layer)),
  ),
  control: ControlService.layerHttp(BillingGroup, { port: 3001 }),
});
```

- **`layer`** — runs the real group (processes, queues, store).
- **`control`** — localhost **`ControlService`** for REST + protocol clients.

Point **`Endpoint.module`** at a module that exports this runtime (see [`process-manager.md`](./process-manager.md)).

---

## Mental model

| Step | State |
| --- | --- |
| Provide **`BillingGroup.layer`** (or `make`) | Processes **stopped**; queue tags live; workers per queue `autoStart` |
| **`group.start(SyncInvoices)`** or **`startAll`** | Forks **`process.effect`** (schedule driver) |
| Schedule **armed** | Instances run poll → user `effect` while entries cover “now” |
| **`group.stop(…)`** | Interrupts drivers |

**`make` / `layer` does not start work.** **`start`** does.

For **`autoStart: false`** queues, **`startAll`** calls **`queue.start`** before starting processes.

---

## Typed controls

### `group.process(SyncInvoices)`

`start` · `stop` · `restart` · `runImmediately` · `status`

### `group.queue(EmailQueue)`

`add` / `enqueue` · `prioritize` · `defer` · `start` · `pause` · `resume` · `clear` · `status`

With **`itemSchema`**, contract queue controls include **`release`**; enqueue can fail validation at the type level.

### Group

`startAll` · `stopAll` · `status` · `health` · `awaitShutdown` (local Node signals only)

---

## Contract

Exported on **`BillingGroup.contract`** and **`GET /contract`**:

- Processes: `start`, `stop`, `restart`, `runImmediately`, `status`
- Queues: `enqueue`, `start`, `pause`, `resume`, `clear`, `status` (+ `release` when schema-backed)

**`ProcessManager.verifyContract`** and HTTP routes preflight against this list.

Remote **`ProcessManager`** does **not** enqueue over the network — enqueue in-process via **`group.queue(EmailQueue)`**.

---

## `ProcessGroup.remoteLayer(GroupService, Endpoint)`

Same **group service key** in the consumer app; controls go to a remote **`ControlService`** URL from **`ProcessManager.Endpoint`**. Use for split CLI/app processes, not for in-process **`yield* BillingGroup`**.

---

## Related

| Guide | Topic |
| --- | --- |
| [process-manager.md](./process-manager.md) | CLI, endpoints, `group-start` |
| [control-plane.md](./control-plane.md) | HTTP server, REST routes |
| [process.md](./process.md) | Process definitions |
| [queue-resource.md](./queue-resource.md) | Queue definitions |
