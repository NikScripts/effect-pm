# Control plane (ControlService)

**ControlService** exposes a **localhost-only** HTTP server for one **typed `ProcessGroup`**. It is the server side of **`ProcessManager.connect`** and of operator tools.

**Operators:** [`process-manager.md`](./process-manager.md) (`ProcessManager.cli`, `group-start`, endpoint config). This guide documents the **HTTP server** those clients call.

---

## How clients talk to the server

| Client | Transport |
| --- | --- |
| **`ProcessManager`** (`connect`, CLI) | **`POST /control`** — JSON **protocol envelope** (`ControlProtocolRequest`) |
| Direct HTTP / tooling | **REST** paths below (`GET` / `POST` per resource) |

REST routes are translated to the same protocol handlers as **`/control`**.

---

## Starting the server

### `ControlService.layerHttp(GroupService, { port? })`

Preferred when the group is a **`ProcessGroup.Service`**:

```typescript
const AppLayer = Layer.mergeAll(
  BillingGroup.layer.pipe(
    Layer.provide(Layer.mergeAll(/* process + queue + ProcessStore */)),
  ),
  ControlService.layerHttp(BillingGroup, { port: 3001 }),
);
```

### `ControlService.make({ group, port? })`

Scoped effect inside **`Effect.scoped`** — same HTTP stack, blocks until scope ends.

### `ControlService.layer(group)`

Router + transport only — you supply **`ControlTransportHttp.serverLayer`** yourself.

**Binding:** `127.0.0.1` only · default port **3001** · no auth (private/dev assumption).

### Signed command authentication

Add `auth` when the control service should reject unsigned commands:

```typescript
import { CommandAuth, ControlService } from "@nikscripts/effect-pm";
import { Config, Duration, Effect } from "effect";

const program = Effect.gen(function* () {
  const keyJson = yield* Config.string("BILLING_GROUP_COMMAND_KEYS");
  const keys = yield* CommandAuth.decodePublicKeyRecordsJson(keyJson);
  const group = yield* BillingGroup;

  yield* ControlService.make({
    group,
    port: 3001,
    auth: CommandAuth.ed25519Verifier({
      keys,
      replay: CommandAuth.Replay.memory({ window: Duration.minutes(5) }),
    }),
  });
});
```

When `auth` is configured, the HTTP surface is strict: signed `POST /control`
only. REST shortcuts, unsigned `/health`, and unsigned log streams fail before
the router runs. Use signed `GetHealth` through `ProcessManager` /
`ControlTransportHttp` for liveness checks.

---

## REST routes

Encode ids in paths: **`encodeURIComponent(id)`** for ids like `@app/Billing/SyncInvoices`.

| Method | Path | Control |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/contract` | `ProcessGroupContract` |
| `GET` | `/status` | Full group status |
| `GET` | `/processes` | List processes |
| `GET` | `/processes/:id` | Process status |
| `POST` | `/processes/:id/start` | Start driver |
| `POST` | `/processes/:id/stop` | Stop |
| `POST` | `/processes/:id/restart` | Restart |
| `POST` | `/processes/:id/now` | `runImmediately` |
| `GET` | `/queues` | List queues |
| `GET` | `/queues/:id` | Queue status |
| `POST` | `/queues/:id/start` | Start workers (`autoStart: false`) |
| `POST` | `/queues/:id/pause` | Pause |
| `POST` | `/queues/:id/resume` | Resume |
| `POST` | `/queues/:id/clear` | Clear pending |

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/control` | Protocol envelope (ProcessManager) |
| `OPTIONS` | `*` | CORS-style empty body |

Responses use **`ControlResponse`**: `{ success, type?, data?, error? }`. Routes check the group **contract** before executing.

---

## Not on the HTTP surface

- Schedule `set` / `add` / `clear` / `reconcile`
- Polling `requestWake` / `resetCadence`
- Remote enqueue via **ProcessManager** (in-process **`group.queue`** only)

---

## Typical layouts

### A — Module launch (recommended for local ops)

1. **`ProcessGroup.Service`** + endpoint config with **`Endpoint.module`** + **`LocalRuntime`**
2. Terminal: **`pm group-start BillingGroup`** (or your CLI binary)
3. Terminal: **`pm start @app/Billing/SyncInvoices`**, **`pm ls`**, etc.

### B — App + control in one process

1. **`BillingGroup.layer`** + **`ControlService.layerHttp(BillingGroup)`**
2. **`yield* BillingGroup`** → **`group.startAll()`** → **`Effect.never`**
3. Optional second shell: **`ProcessManager.cli`** with **`Endpoint.http`** pointing at the same port

### C — Remote consumer

**`ProcessGroup.remoteLayer`** + **`ProcessManager.Endpoint`** in another service (see process-manager guide).

---

## ControlProtocol

**`ControlRouter`**, **`makeControlProtocolRequestEnvelope`**, **`ControlTransportHttp`** — shared by server and **`ProcessManager`**. Import when building custom transports, not for everyday app code.

---

## Related

[process-group.md](./process-group.md) · [process-manager.md](./process-manager.md)
