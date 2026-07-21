# Examples (`examples/`)

Runnable teaching scripts organized in two layers:

| Layer | Path | Purpose |
|-------|------|---------|
| **Forms** | [`forms/`](./forms/) | One API shape per file — minimal, focused references |
| **Scenarios** | [`scenarios/`](./scenarios/) | Descriptive compositions showing subsystems working together |
| **Shared** | [`shared/`](./shared/) | Test doubles, harness helpers, small shared utilities |

Cross-cutting narrative: [docs/legacy/PACKAGE-GUIDE.md](../docs/legacy/PACKAGE-GUIDE.md). API tables: [docs/legacy/PROCESS-API.md](../docs/legacy/PROCESS-API.md), [docs/legacy/RESOURCE-API.md](../docs/legacy/RESOURCE-API.md).

**Conventions:** Each file has a one-line module header (what + how to run). Teaching notes live **inline next to the code** they describe. Imports omit `.js` extensions — examples run via `tsx` on `.ts` sources directly.

---

## Prerequisites

- **Node.js** compatible with the repo `engines` field in `package.json`.
- **Dependencies** installed from the package root (`pnpm install`).
- Most examples use **`tsx`** via `pnpm run example:*` or `npx tsx`.

---

## Suggested tracks

| Track | Read / run in this order |
|-------|--------------------------|
| **Start here** | [`forms/queue/queue-resource-priority-retry.ts`](./forms/queue/queue-resource-priority-retry.ts) → [Examples (docs)](../docs/examples.md#queue) |
| **Dashboard / TUI** | [`resource-tui/`](./resource-tui/) — terminal dashboards over the resource tags |
| **Queues** | [`forms/queue/queue-resource-priority-retry.ts`](./forms/queue/queue-resource-priority-retry.ts) → [`forms/queue/custom-queue-resource-n-level.ts`](./forms/queue/custom-queue-resource-n-level.ts) |
| **Schedule controls** | `pnpm run example:schedule-control-basics` → `example:schedule-control-surfaces` → [`scenarios/schedule-sync-from-external-db.ts`](./scenarios/schedule-sync-from-external-db.ts) |
| **Process runtime** | `pnpm run example:process-supervisor-patterns` |
| **Polling patterns** | `pnpm run example:sports-polling-accelerating` |
| **Resource gating** | [`forms/resource/run-resource-unit-and-input.ts`](./forms/resource/run-resource-unit-and-input.ts) → [`run-resource-store-readback.ts`](./forms/resource/run-resource-store-readback.ts) → [`run-resource-runtime-observer.ts`](./forms/resource/run-resource-runtime-observer.ts) → http-client → http-api forms |
| **Fleet glass** | `pnpm run example:telemetry-fleet-glass` → `example:fleet-health-glass` → `example:shardmap-sessions` |
| **Node module** | `node-tag-addressed` → `node-tag-bound` → `node-clients` → addressless serve/call → nameless serve/call → `node-prototype` → `node-lookup` |
| **Storage** | [`forms/process-store/process-layer-store-auto-write.ts`](./forms/process-store/process-layer-store-auto-write.ts) (execution events) → [`process-layer-typed-error-store.ts`](./forms/process-store/process-layer-typed-error-store.ts) |

---

## Forms catalog

### Queue

| File | Teaches |
|------|---------|
| [`forms/queue/queue-resource-priority-retry.ts`](./forms/queue/queue-resource-priority-retry.ts) | `QueueResource.Service`, priority, dedup key, handler retry |
| [`forms/queue/custom-queue-resource-n-level.ts`](./forms/queue/custom-queue-resource-n-level.ts) | `CustomQueueResource.Tag`, named lanes, `add(item, level?)`, weighted take |

### Resource

| File | Teaches |
|------|---------|
| [`forms/resource/run-resource-unit-and-input.ts`](./forms/resource/run-resource-unit-and-input.ts) | `RunResource.Service` unit/input forms + concurrency + `Store.layerDefaultMemory` |
| [`forms/resource/run-resource-store-readback.ts`](./forms/resource/run-resource-store-readback.ts) | Engine auto-write + `RunResource.store` + `Store.Service.at` readback |
| [`forms/resource/run-resource-runtime-observer.ts`](./forms/resource/run-resource-runtime-observer.ts) | Observable handle (`status`, counters) via `Subscribable` |
| [`forms/resource/http-client-run-gate.ts`](./forms/resource/http-client-run-gate.ts) | `HttpClientRunGate.transformClient` |
| [`forms/resource/http-api-resource-tag-layer.ts`](./forms/resource/http-api-resource-tag-layer.ts) | `HttpApiResource.Service` + `ApiMetrics.Tag` |
| [`forms/resource/http-api-resource-layer-effect.ts`](./forms/resource/http-api-resource-layer-effect.ts) | `HttpApiResource.layerEffect` + sidecar capture |
| [`forms/resource/telemetry-fleet-glass.ts`](./forms/resource/telemetry-fleet-glass.ts) | `Telemetry` leaf snapshot + fleet `inFlightByNode` / `fleetInFlight` |
| [`forms/resource/fleet-health-glass.ts`](./forms/resource/fleet-health-glass.ts) | `FleetHealth` leaf `local` + fleet `byNode` / `status` (`Reachable` \| `Unreachable`) |
| [`forms/resource/node-tag-addressed.ts`](./forms/resource/node-tag-addressed.ts) | `Node.Tag` with `{ path }` + `Node.unix` / `client` |
| [`forms/resource/node-http-nameless-serve.ts`](./forms/resource/node-http-nameless-serve.ts) | Nameless `Node.http(serve)` — localhost Http + Lookup |
| [`forms/resource/node-ws-nameless-serve.ts`](./forms/resource/node-ws-nameless-serve.ts) | Nameless `Node.ws(serve)` — localhost WebSocket + Lookup |
| — | `Node.nPipe` — Windows named-pipe sibling of `unix` (same `IpcSocket` kind; see `test/node-npipe.test.ts`) |
| [`forms/resource/node-tag-bound.ts`](./forms/resource/node-tag-bound.ts) | Tag carries node — `Node.unix(Jobs, impl)` + `Resource.client(Jobs)` |
| [`forms/resource/node-clients.ts`](./forms/resource/node-clients.ts) | Catalog `ROut` + `Node.clients(Worker, [Jobs, Emails])` |
| [`forms/resource/node-tag-addressless-serve.ts`](./forms/resource/node-tag-addressless-serve.ts) | Address-less serve — Lookup **piped** (`bootstrapLookup: false`) — terminal A |
| [`forms/resource/node-tag-addressless-call.ts`](./forms/resource/node-tag-addressless-call.ts) | Address-less call — `lookupClient` + Lookup **piped** — terminal B |
| [`forms/resource/node-nameless-listen-serve.ts`](./forms/resource/node-nameless-listen-serve.ts) | Nameless `Node.unix([serve…])` — two resources, terminal A |
| [`forms/resource/node-nameless-listen-call.ts`](./forms/resource/node-nameless-listen-call.ts) | Nameless call (`discoverClients(Jobs, Emails)`) — terminal B |
| [`forms/resource/node-nameless-listen-demo.ts`](./forms/resource/node-nameless-listen-demo.ts) | One-command proof — forks serve, then call |
| [`forms/resource/node-prototype.ts`](./forms/resource/node-prototype.ts) | `Node.Prototype.make` + `.listen(serves)` |
| [`forms/resource/node-lookup.ts`](./forms/resource/node-lookup.ts) | `Node.Lookup` + `Lookup.bootstrapDefaultLocal` / `client` |
| [`forms/resource/shardmap-sessions.ts`](./forms/resource/shardmap-sessions.ts) | `ShardMap` routed ops across distributed nodes |

### Process store (EventJournal)

| File | Teaches |
|------|---------|
| [`forms/process-store/process-layer-store-auto-write.ts`](./forms/process-store/process-layer-store-auto-write.ts) | **`Process.layer`** + **`Process.store(tag)`** — auto-append on terminal runs, app store override |
| [`forms/process-store/process-layer-typed-error-store.ts`](./forms/process-store/process-layer-typed-error-store.ts) | Tag `{ error }` → typed `Failed.error` in execution history |

Start here for execution history. **`Process.make`** does not auto-append.

Storage:

- **`Store.Service` + `Process.store(tag)`** — execution events (`Started` / `Completed` / `Failed` / `Interrupted`) on EventJournal; auto-write on **`Process.layer`** only.
- **Durable logs** — `Node.logs` / toolkit `*.store` on a `Store.Service`; `@nikscripts/effect-pm/Logs` handles capture/relay + `byNode` / `byResource`.

### Schedule

| File | Teaches |
|------|---------|
| [`forms/schedule/schedule-at.ts`](./forms/schedule/schedule-at.ts) | `ProcessSchedule.at` (one-shot) |
| [`forms/schedule/schedule-window.ts`](./forms/schedule/schedule-window.ts) | `ProcessSchedule.window` (bounded) |
| [`forms/schedule/schedule-define.ts`](./forms/schedule/schedule-define.ts) | `ProcessSchedule.define` composition |
| [`forms/schedule/schedule-controls-initializer.ts`](./forms/schedule/schedule-controls-initializer.ts) | Controls from `schedule` initializer |
| [`forms/schedule/schedule-controls-in-effect.ts`](./forms/schedule/schedule-controls-in-effect.ts) | `Process.scheduleControls` in tick body |
| [`forms/schedule/schedule-controls-external-fiber.ts`](./forms/schedule/schedule-controls-external-fiber.ts) | External fiber via `ProcessSchedule` service |

### Polling

| File | Teaches |
|------|---------|
| [`forms/polling/polling-accelerating.ts`](./forms/polling/polling-accelerating.ts) | `Polling.accelerating` |
| [`forms/polling/schedule-delayed-start.ts`](./forms/polling/schedule-delayed-start.ts) | Disarmed until `startAt` |
| [`forms/polling/polling-spaced-read.ts`](./forms/polling/polling-spaced-read.ts) | `Polling.spaced` + feed read |
| [`forms/polling/polling-accelerating-reset-cadence.ts`](./forms/polling/polling-accelerating-reset-cadence.ts) | `resetCadence` on score change |
| [`forms/polling/polling-accelerating-peek-cadence.ts`](./forms/polling/polling-accelerating-peek-cadence.ts) | `peekCadence` + event buffer |


## Scenarios catalog

| File | Teaches |
|------|---------|
| [`scenarios/schedule-sync-from-external-db.ts`](./scenarios/schedule-sync-from-external-db.ts) | DB-to-runtime schedule sync pattern |
| [`scenarios/nwslsoccer/`](./scenarios/nwslsoccer/) | Real HttpApi client against NWSL SDP (optional local tree) |

---

## npm scripts (from package root)

| Script | What it runs |
|--------|----------------|
| `pnpm run example:queue-resource` | Queue form |
| `pnpm run example:process-patterns` | Alias for `example:process-supervisor-patterns` |
| `pnpm run example:process-supervisor-patterns` | Accelerating + delayed-start forms |
| `pnpm run example:sports-polling-accelerating` | All three sports polling forms |
| `pnpm run example:schedule-control-surfaces` | All three schedule control forms |
| `pnpm run example:schedule-control-basics` | `at` + `window` + `define` forms |
| `pnpm run example:schedule-control-db-sync` | DB sync scenario |
| `pnpm run example:run-resource` | RunResource concurrency form |
| `pnpm run example:run-resource-store-readback` | RunResource store auto-write + readback |
| `pnpm run example:http-client-run-gate` | HttpClient gate form |
| `pnpm run example:http-api-resource` | HttpApiResource form |
| `pnpm run example:http-api-resource-layer-effect` | `layerEffect` form |
| `pnpm run example:form:*` | Individual form scripts that are registered in `package.json` |

Run any file directly:

```bash
npx tsx examples/forms/schedule/schedule-at.ts
```

---

## Control port

Examples and the CLI default to port **3001** unless **`HOME_SERVER_PORT`** is set. Keep the scenario and CLI on the **same** port.

---

## For AI assistants

When answering questions about **behavior**, prefer **source of truth** in this order:

1. `src/*.ts` implementation + TSDoc
2. `docs/legacy/PROCESS-API.md` / `docs/legacy/RESOURCE-API.md` for tables
3. `docs/legacy/guides/toolkit-by-example.md` / `docs/legacy/guides/history-and-persistence.md` for patterns
4. **`forms/`** for a single API shape; **`scenarios/`** for composition patterns

Committed agent map: [docs/legacy/AGENTS.md](../docs/legacy/AGENTS.md).
