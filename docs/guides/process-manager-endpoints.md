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

```bash
pnpm run demo:pm -- watch workshop-group
pnpm run demo:pm -- logs --limit 50
pnpm run demo:pm -- logs workshop-group --from 2026-05-22T19:00:00Z --to 2026-05-22T20:00:00Z
```

### `watch` (live + in-memory relay)

- **`watch <group>`** — recent relay prelude (`--lines` / `-n`, default 100) + live structured logs (`GET /logs/stream?follow=true&lines=…`, NDJSON). Live is implicit (no `--follow`).
- **`--snapshot`** — relay prelude only, then exit
- **`--no-interactive`** — disable TTY keys; non-TTY stdin disables interactive automatically
- Interactive keys (TTY): `f` freeze/unfreeze, `?` / `h` help, `q` or Ctrl+C quit

### `logs` (storage history — query-shaped)

- **`logs`** — query stored log rows (like a DB query). No args ⇒ all groups, default **`--limit`** (100), default **`--sort desc`** (newest first).
- Optional **`logs <group>`** — filter by group id
- **`--from` / `--to`** — optional ISO date bounds (both ends optional; if both set, `from` ≤ `to`)
- **`--after` / `--before`** — optional cursor bounds (entry id or ISO, per storage adapter)
- **`--limit`**, **`--sort asc|desc`**
- Storage append/query is not wired yet; the command validates flags and fails with a clear message until [plan 13](../plans/13-process-manager-log-transport.md) slice 2 lands
- Merge **`ProcessManager.operatorLoggerLayer`** into the operator CLI runtime so replay uses the same pretty/json logger as the PM process


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


## Structured log relay

| Piece | Role |
|-------|------|
| Child `captureLoggerLayer` | Captures Effect `Logger` calls as `ProcessManagerLogEntry` values |
| `ProcessManagerLogRelay` | In-process PubSub + tail history on the child |
| `GET /logs/stream` | NDJSON snapshot (+ live stream when `?follow=true`) |
| `streamGroupLogs` / `groupLogEntryStream` | PM operator HTTP client decodes entries and `replayLogEntry` through ambient `Logger` |

The child does not format logs locally for the operator; the PM CLI replays through `operatorLoggerLayer`.
