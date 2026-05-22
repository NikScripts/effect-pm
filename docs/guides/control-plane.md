# Control plane (ControlService & CLI)

The **control plane** exposes a **localhost HTTP JSON API** for one **typed `ProcessGroup`**, plus optional **CLI** commands that call the same routes. **`ProcessManager`** is the multi-group **client** for those endpoints — see [`process-manager.md`](./process-manager.md).

**Scope:** binding, routes, response shape, and **`createCli` / `runCli`**. Assumes the group is already defined ([`process-group.md`](./process-group.md)) and processes/queues registered.

---

## ControlService

### `ControlService.make({ port?, group })`

Scoped effect: starts **127.0.0.1** HTTP server until scope closes. Default **port 3001**.

```typescript
import { Effect } from "effect";
import { ControlService, ProcessGroup } from "@nikscripts/effect-pm";

const program = Effect.gen(function* () {
  const group = yield* ProcessGroup.make("@app/Billing", [SyncProcess, EmailQueue] as const);
  yield* ControlService.make({ port: 3001, group });
  yield* Effect.never;
}).pipe(Effect.scoped);
```

Provide queue/process layers before `make` (or use **`ProcessGroup.Service.layer`**).

### Layer variants

| API | Role |
| --- | --- |
| `ControlService.layer(group)` | Control router + external transport server tag |
| `ControlService.layerHttp(group, { port? })` | Default localhost HTTP stack |

Use layers when the HTTP server is composed with the rest of the app `Layer` tree instead of a standalone `make` effect.

**Security (documented assumption):** localhost only, no auth/TLS — suitable for dev and private operator networks, not public internet.

---

## HTTP routes

| Method | Path | Role |
| --- | --- | --- |
| `GET` | `/health` | Probe |
| `GET` | `/contract` | `ProcessGroupContract` JSON |
| `GET` | `/status` | All processes + queues |
| `GET` | `/processes` | Process list |
| `GET` | `/processes/:id` | One process status |
| `POST` | `/processes/:id/start` | Start driver |
| `POST` | `/processes/:id/stop` | Stop |
| `POST` | `/processes/:id/restart` | Restart |
| `POST` | `/processes/:id/now` | `runImmediately` |
| `GET` | `/queues` | Queue list |
| `GET` | `/queues/:id` | Queue status |
| `POST` | `/queues/:id/start` | Start workers (`autoStart: false`) |
| `POST` | `/queues/:id/pause` | Pause |
| `POST` | `/queues/:id/resume` | Resume |
| `POST` | `/queues/:id/clear` | Clear pending |
| `POST` | `/control` | Canonical protocol envelope |
| `OPTIONS` | `*` | CORS-style empty response |

Routes check the group **contract** before running (same idea as ProcessManager preflight).

### Response envelope — `ControlResponse`

```typescript
{
  success: boolean;
  type?: "process" | "queue";
  data?: unknown;
  error?: string;
}
```

---

## What the control plane does not expose

| Surface | Notes |
| --- | --- |
| Schedule CRUD | Use `Process.scheduleControls` / `ProcessSchedule` service in-app |
| Polling wake / reset | In-process `Polling` only |
| Remote enqueue via ProcessManager | Local HTTP may reflect full group queue handle; PM client blocks enqueue |

---

## Single-group CLI — `createCli` / `runCli`

Re-exported from **`ControlService`** and main package. Talks to **`http://127.0.0.1:{port}`** (default **3001**).

### `createCli({ name, version, port? })`

Returns an Effect CLI runner (Effect `Command.runWith`).

### `runCli(config, argv?)`

Convenience: `createCli` + `process.argv`.

### Commands

| Command | Maps to |
| --- | --- |
| `ls` | List processes and queues |
| `status [name]` | Process or aggregate status |
| `start <name>` | POST start |
| `stop <name>` | POST stop |
| `restart <name>` | POST restart |
| `now <name>` | POST now |
| `pause <name>` | Queue pause |
| `resume <name>` | Queue resume |
| `clear <name>` | Queue clear |
| `queues` | Queue listing |

Requires **`HttpClient`** in the environment (e.g. `@effect/platform-node/NodeHttpClient`).

**Port** must match the running **`ControlService`**.

---

## ControlProtocol (related)

Shared between server and client:

- **`ControlProtocolRequest`** / **`ControlResponse`** envelopes
- **`ControlRouter`** — dispatches to `ProcessGroup` controls
- **`ControlTransportHttp`** — server + client transports

Used by **`ControlService`**, **`ProcessManager`**, and tests — not usually imported for app business logic.

---

## Typical layouts

### Dev: app + control in one Node process

1. `ProcessGroup.Service` with entries  
2. `Effect.provide(BillingGroup.layer)`  
3. `yield* BillingGroup` → `yield* ControlService.make({ group })`  
4. Optional: second terminal with `runCli({ port })`

### Dev: daemon + operator CLI

1. App runs `ControlService.make` + `Effect.never`  
2. Operator runs `runCli` or `ProcessManager.cli` pointing at same port  

### Prod: remote PM

1. Deployed app exposes `ControlService` on configured port (still localhost or behind your proxy)  
2. `ProcessManager.ConnectionRegistry` + `ProcessManager.cli` for ops  

---

## Related tools

| Tool | Role |
| --- | --- |
| **`ProcessGroup`** | Control target — [`process-group.md`](./process-group.md) |
| **`ProcessManager`** | Multi-group client — [`process-manager.md`](./process-manager.md) |
| **`ProcessStore`** | Richer status when layer provided at group fork site |

---

## Implementation reference

| Location | Contents |
| --- | --- |
| `src/ControlService.ts` | `make`, `layer`, `layerHttp`, CLI re-exports |
| `src/cli.ts` | `createCli`, `runCli` |
| `src/ControlProtocol.ts` | Protocol + router |
| `src/ControlTransportHttp.ts` | HTTP server/client |
