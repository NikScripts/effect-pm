# ProcessManager endpoint configuration

Implemented endpoint DX for `ProcessGroup.Service` third-argument config items and operator CLI `group-start` / `group-stop`.

## Canonical shape

```typescript
import { Endpoint, ProcessGroup, Transport } from "@nikscripts/effect-pm";

const workshop = Transport.http(32140);

export class WorkshopGroup extends ProcessGroup.Service<WorkshopGroup>()(
  "@app/WorkshopGroup",
  [Feeder, JobQueue] as const,
  [
    Endpoint.local(workshop, import.meta.url).default,
    Endpoint.production(workshop),
    Endpoint.define("preview", workshop),
  ],
) {}
```

- **`Transport.http`** — protocol descriptor (`port`, `host + port`, or full `baseUrl`).
- **`Endpoint.local(transport, entry)`** — child process launcher via packaged `effect-pm-group-child` (no separate `*-runtime.ts` required).
- **`Endpoint.production(transport)`** — remote control plane at `transport.baseUrl`.
- **`Endpoint.http({ transport })`** — builds an HTTP endpoint definition for remote-only endpoints.

## Child launch configuration

`ProcessManager.ChildLaunch` resolves launcher paths through Effect `Config`:

| Config key | Purpose |
|------------|---------|
| `EFFECT_PM_GROUP_CHILD_SCRIPT` | Path to `effect-pm-group-child` binary |
| `EFFECT_PM_EXECUTOR_IMPORT` | Node `--import` loader (default `tsx`) |
| `EFFECT_PM_LOG_DIRECTORY` | Log directory (default `.effect-pm/logs`) |
| `EFFECT_PM_RUN_DIRECTORY` | Run-state directory (default `.effect-pm/run/groups`) |

```typescript
import { Layer, ProcessManager } from "@nikscripts/effect-pm";

const layers = Layer.mergeAll(
  NodeServices.layer,
  NodeHttpClient.layerUndici,
  ProcessManager.operatorLayer, // ChildLaunch.layerFromEnv()
  ProcessManager.Config.layer([groupConfig]),
);
```

Tests and custom CLIs should prefer **`ProcessManager.ChildLaunch.layerConfig({ ... })`** over mutating `process.env`.

## Operator CLI

`ProcessManager.cli(groups)` requires platform layers plus `ProcessManager.operatorLayer` (or `ChildLaunch.layerConfig` in tests).

Child entry binary: **`effect-pm-group-child`** (also `pnpm exec effect-pm-group-child` from the package).

## Module layout

| Module | Role |
|--------|------|
| `processManagerTransport.ts` | `Transport`, `httpEndpoint` |
| `processManagerChildLaunch.ts` | Child paths `Config`, `ChildLaunch` service, `buildLaunchConfig` |
| `processManagerRunState.ts` | Run-state Schema + JSON encode/decode |
| `processManagerGroupRuntime.ts` | `groupLocalRuntime` for child processes |
| `groupChild.ts` | Child argv CLI + dynamic import |
| `ProcessManager.ts` | Remote client, endpoint normalization, operator CLI |

## Injectable remote client

- **`Endpoint` injectable factory** — `ProcessManager.Endpoint<MyTag>()(Group, { baseUrl })` for app-injected remote clients.


## Log files

`group-start` records paths like `.effect-pm/logs/<group>.out.log` and `.err.log` in run state. The operator drains the child process **stdout** and **stderr** streams into those files (append mode) via background fibers, so the paths reflect real process output instead of empty placeholder files.
