# ProcessManager

**ProcessManager** is how you **operate** typed **`ProcessGroup`** instances from another process: discover endpoints, launch runtimes, verify contracts, and run controls over HTTP.

It does **not** replace the group runtime — your app (or a child process started by **`group-start`**) still provides **`ProcessGroup.Service.layer`** and **`ControlService`**.

---

## Primary interface: `ProcessManager.cli`

```typescript
import { Effect, Layer } from "effect";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { ProcessManager } from "@nikscripts/effect-pm";
import { BillingGroup } from "./billing-group.js";

const cli = ProcessManager.cli([BillingGroup] as const);

cli(process.argv).pipe(
  Effect.provide(Layer.merge(NodeHttpClient.layer, /* … */)),
  NodeRuntime.runMain,
);
```

Pass every **`ProcessGroup.Service`** class you want in the operator catalog. Endpoint metadata comes from the group’s **third config argument** (or **`ProcessManager.Config.layer`** override).

### Commands (current)

| Command | Purpose |
| --- | --- |
| `groups` | Groups + endpoint status (`Configured`, `Pending`, `Online`, `Offline`, `ContractDrift`) |
| `ls` | Processes and queues per group with **contract controls** |
| `verify [group]` | Local vs remote contract drift |
| `group-start <group>` | Launch **module** endpoint (child process + control URL) |
| `group-stop <group>` | SIGTERM + clear run state |
| `status <target>` | Group or entry status |
| `start` / `stop` / `restart` / `now` | Process controls (canonical id or suffix alias) |
| `pause` / `resume` / `clear` | Queue controls |

**Flags:** `--json` on `groups`, `ls`, `verify`, `status`; **`--target <label>`** selects a non-default endpoint from group config.

**Targets:** canonical ids like `@app/Billing/SyncInvoices`, or normalized suffixes when unique across listed groups.

---

## Endpoint config on the group

Declare on **`ProcessGroup.Service`** (or **`make`’s third argument**):

```typescript
import { Endpoint, ProcessManager, Transport } from "@nikscripts/effect-pm";

const billing = Transport.http(3001);

[
  Endpoint.local(billing, import.meta.url).default,
  Endpoint.production(billing),
  Endpoint.define("staging", billing),
]
```

| Builder | Role |
| --- | --- |
| **`Transport.http`** | Protocol descriptor (`port`, `host:port`, or full `baseUrl`) |
| **`Endpoint.local(transport, entry)`** | Spawns packaged **`effect-pm-group-child`** for `group-start` (entry = module URL or path) |
| **`Endpoint.local(…).default`** | Marks dev default for `--target` |
| **`Endpoint.production(transport)`** | Remote control plane at `transport.baseUrl` |
| **`Endpoint.define(label, transport)`** | Named target for CLI |
| **`Endpoint.http({ transport })`** | HTTP endpoint definition object (remote-only) |

**`ProcessManager.GroupConfig(Group, items?)`** — validate/normalize items.

**`ProcessManager.Config.layer(configs)`** — override selection (wins over bundled group config, then connection registry).

**`ProcessManager.ChildLaunch`** — resolves child script paths via Effect `Config` (`EFFECT_PM_GROUP_CHILD_SCRIPT`, etc.). Use **`ProcessManager.operatorLayer`** in the CLI, or **`ChildLaunch.layerConfig({ … })`** in tests.

See also [`process-manager-endpoints.md`](./process-manager-endpoints.md).

---

## `group-start` / `group-stop`

**`group-start`** builds launch argv from the selected **`Endpoint.local`** child endpoint, spawns a detached Node child, drains **stdout** / **stderr** into `.effect-pm/logs/<group>.out.log` and `.err.log`, and records PID + paths under `.effect-pm/run/groups/`.

**`group-stop`** reads that run state, signals the PID, and removes the JSON file.

---

## In-process client: `ProcessManager.connect`

For app/CI code (not the CLI):

```typescript
const manager = yield* ProcessManager.connect(BillingGroup, {
  baseUrl: "http://127.0.0.1:3001",
});
// manager.process("@app/Billing/SyncInvoices").start
```

| Discovery | API |
| --- | --- |
| Registry map | `ProcessManager.ConnectionRegistry.layer(groups, { [id]: url })` |
| Effect Config | `ConnectionRegistry.layerConfig` |
| Inline URL | `connect(Group, { baseUrl })` |
| Raw contract | `connect({ baseUrl, contract })` |

HTTP client uses the **control protocol envelope** (`POST /control`). The server also exposes **REST** routes for the same operations (see [`control-plane.md`](./control-plane.md)).

---

## `ProcessManager.Endpoint` + `ProcessGroup.remoteLayer`

```typescript
class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(BillingGroup) {}

// Consumer app:
Layer.mergeAll(
  BillingGroup.remoteLayer(BillingGroup, BillingEndpoint),
  BillingEndpoint.layer, // resolves baseUrl from registry or inline config
);
```

Same remote limits: **no enqueue**, **no `awaitShutdown`**.

---

## Remote control surface

| Surface | Remote |
| --- | --- |
| Process `start` / `stop` / `restart` / `runImmediately` / `status` | Yes (if on contract) |
| Queue `pause` / `resume` / `clear` / `status` | Yes |
| Queue `add` / `enqueue` / `prioritize` / `defer` | **No** — in-process only |
| `verifyContract` | Yes |

---

## Errors

`ProcessManagerConnectionError` · `ProcessManagerRequestError` · `ProcessManagerEndpointConfigError` · `UnsupportedRemoteControlError` · `ProcessGroupRemoteControlError`

Target resolution helpers (`normalizeProcessManagerTarget`, `resolveProcessManagerTarget`) live in **`ProcessManagerTargetResolver`** (not always re-exported from the main barrel).

---

## Related

[process-group.md](./process-group.md) · [control-plane.md](./control-plane.md) · plan [07-process-manager.md](../plans/07-process-manager.md)
