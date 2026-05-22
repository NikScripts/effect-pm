# ProcessManager

**ProcessManager** is a **typed remote client** for a running **`ControlService`**. It does not own process or queue fibers; it reads a group **contract**, verifies it against expectations, and issues **control protocol** requests over HTTP (or a provided transport).

Use it when the control plane runs in another process (daemon, deployed app) and operators or tools connect from a laptop, CI, or second service.

Local single-group tooling: [`control-plane.md`](./control-plane.md). Group definition: [`process-group.md`](./process-group.md).

---

## Mental model

```text
  Your tool / CI          ProcessManager              ControlService
       |                        |                          |
       |---- connect(Group) ---->|---- GET /contract ------->|
       |                        |---- POST /control -------->|
       |                        |                          |-> ProcessGroup
```

**Contract-first:** IDs and allowed controls come from **`ProcessGroupContract`**. **`verifyContract`** compares remote vs local before mutations (CLI paths do this in preflight).

---

## Connection discovery

### `ProcessManager.connect(GroupService)`

Resolves base URL from **`ProcessManagerConnectionRegistry`** (must provide registry layer with `[groupId]: url`).

### `ProcessManager.connect(GroupService, { baseUrl })`

Explicit URL — tests and simple scripts.

### `ProcessManager.connect({ baseUrl, contract })`

Raw contract value (generated or hand-maintained clients).

### Registry layers

| Layer | Role |
| --- | --- |
| `ProcessManager.ConnectionRegistry.layer(groups, map)` | Static `Record<groupId, url>` |
| `ProcessManager.ConnectionRegistry.layerConfig(groups, configMap)` | Effect `Config` per group |

---

## Endpoint configuration (group third arg)

Attach endpoint metadata when defining **`ProcessGroup.Service`** or **`ProcessGroup.make(id, entries, configItems)`**:

| Helper | Role |
| --- | --- |
| `Endpoint.local(definition).default` | Dev default for a local runtime module |
| `Endpoint.production(definition)` | Production URL descriptor |
| `Endpoint.http({ transport })` | `Transport.http({ baseUrl })` |
| `Endpoint.module(load, select?)` | Out-of-process module launch for `group-start` |
| `Endpoint.define(label, definition)` | Named entry in config list |
| `ProcessManager.GroupConfig(Group, items?)` | Validate/normalize items |

**`ProcessManager.Config.layer(configs)`** overrides endpoint selection (CLI checks this before group-bundled config, then registry).

**`ProcessManager.Endpoint<Self>()(Group)`** — Context service resolving URL for **`ProcessGroup.remoteLayer`**.

---

## `RemoteProcessManager` API

After **`yield* ProcessManager.connect(...)`**:

| Member | Role |
| --- | --- |
| `contract` | Local typed contract mirror |
| `fetchContract` | Remote JSON |
| `verifyContract` | Drift check (ids, controls, optional item codec) |
| `process(id)` | `RemoteProcessControls` |
| `queue(id)` | `RemoteQueueControls` |
| `status` | Full group status |

### Remote process controls

`start`, `stop`, `restart`, `runImmediately`, `status` — when contract includes them.

### Remote queue controls

`pause`, `resume`, `clear`, `status` only.

**No remote enqueue** — `add` / `enqueue` / `prioritize` / `defer` fail with **`UnsupportedRemoteControlError`**. Enqueue stays in-process on **`group.queue(Entry)`** or the live queue tag.

---

## ProcessManager CLI — `ProcessManager.cli(groups, config?)`

Multi-group operator CLI (Effect CLI). Typical groups argument: tuple of **`ProcessGroup.Service`** classes.

| Command | Purpose |
| --- | --- |
| `groups` | List groups + endpoint status (`Configured`, `Pending`, `Online`, `Offline`, `ContractDrift`) |
| `ls` | Entries and contract controls per group |
| `verify [group]` | Contract drift check |
| `group-start <group>` | Start HTTP module / attach to endpoint |
| `group-stop <group>` | SIGTERM recorded PID |
| `status <target>` | Group or entry status |
| `start` / `stop` / `restart` / `now` | Process controls |
| `pause` / `resume` / `clear` | Queue controls |

**Flags:** `--json` on several commands; `--target <label>` for endpoint-backed runs.

**Target resolution:** canonical id or normalized suffix; ambiguity → **`AmbiguousProcessManagerTarget`**; missing → **`MissingProcessManagerTarget`** (resolver utilities, not always on main barrel).

---

## `ProcessGroup.remoteLayer`

Provides the **group service** in a consumer app while executing controls against a remote **`ControlService`**. Pair with **`ProcessManager.Endpoint`** for URL discovery.

Same remote limitations as **`RemoteProcessManager`** (no enqueue, no `awaitShutdown`).

---

## Errors

| Error | When |
| --- | --- |
| `ProcessManagerConnectionError` | Registry missing URL for group |
| `ProcessManagerRequestError` | HTTP/network/decode failure |
| `ProcessManagerEndpointConfigError` | Invalid endpoint config item |
| `UnsupportedRemoteControlError` | Contract or platform blocks op |

---

## Choosing a wiring style

| Goal | Prefer |
| --- | --- |
| Ops against one local daemon | `ControlService` + `createCli` |
| Many groups / prod URLs | `ProcessManager.cli` + registry or `Config.layer` |
| App code calls remote controls | `ProcessManager.connect` + `remoteLayer` |
| Typed IDs in application | `ProcessGroup.Service` + `connect(Group)` |

---

## Related tools

| Tool | Role |
| --- | --- |
| **`ControlService`** | Server side — [`control-plane.md`](./control-plane.md) |
| **`ControlProtocol`** | Request/response envelopes |
| **`ProcessGroup`** | Contract source — [`process-group.md`](./process-group.md) |

---

## Implementation reference

| Location | Contents |
| --- | --- |
| `src/ProcessManager.ts` | Client, CLI, endpoint config |
| `src/ProcessManagerTargetResolver.ts` | Target parsing |
| `src/ControlTransportHttp.ts` | HTTP client transport |
