# Examples (`examples/`)

Runnable teaching scripts organized in two layers:

| Layer | Path | Purpose |
|-------|------|---------|
| **Forms** | [`forms/`](./forms/) | One API shape per file — minimal, focused references |
| **Scenarios** | [`scenarios/`](./scenarios/) | Descriptive compositions showing subsystems working together |
| **Shared** | [`shared/`](./shared/) | Test doubles, harness helpers, small shared utilities |

Cross-cutting narrative: [docs/legacy/PACKAGE-GUIDE.md](../docs/legacy/PACKAGE-GUIDE.md). API tables: [docs/legacy/PROCESS-API.md](../docs/legacy/PROCESS-API.md), [docs/legacy/HYPERLINK-API.md](../docs/legacy/HYPERLINK-API.md).

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
| **Start here** | [`forms/queue/workpool-priority-retry.ts`](./forms/queue/workpool-priority-retry.ts) → [Examples (docs)](../docs/examples.md#queue) |
| **Dashboard / TUI** | [`hyperlink-tui/`](./hyperlink-tui/) — terminal dashboards over hyperlink tags |
| **Queues** | [`forms/queue/workpool-priority-retry.ts`](./forms/queue/workpool-priority-retry.ts) → [`forms/queue/workpool-priority-lanes.ts`](./forms/queue/workpool-priority-lanes.ts) |
| **Schedule controls** | `pnpm run example:schedule-control-basics` → `example:schedule-control-surfaces` → [`scenarios/schedule-sync-from-external-db.ts`](./scenarios/schedule-sync-from-external-db.ts) |
| **Daemon runtime** | `pnpm run example:daemon-supervisor-patterns` |
| **Polling patterns** | `pnpm run example:sports-polling-accelerating` |
| **Hyperlink gating** | [`forms/hyperlink/gate-unit-and-input.ts`](./forms/hyperlink/gate-unit-and-input.ts) → [`gate-store-readback.ts`](./forms/hyperlink/gate-store-readback.ts) → [`gate-runtime-observer.ts`](./forms/hyperlink/gate-runtime-observer.ts) → http-client → http-api forms |
| **Fleet glass** | `pnpm run example:telemetry-fleet-glass` → `example:fleet-health-glass` → `example:shardmap-sessions` |
| **Node module** | (1) `node-tag-addressed` → (2) `node-tag-bound` → (3) `node-clients` → (4) addressless → (5) nameless unix → (6) `node-prototype` → (7) `node-lookup` → (8) nameless `http`/`ws` siblings → identity coordinator (`node-identity-coordinator`). Keep protocol listens in sync — [§ Protocol listen siblings](../docs/handoffs/node-catalog-and-discovery.md#protocol-listen-siblings-keep-in-sync). |
| **Storage** | [`forms/daemon-store/daemon-layer-store-auto-write.ts`](./forms/daemon-store/daemon-layer-store-auto-write.ts) (execution events) → [`daemon-layer-typed-error-store.ts`](./forms/daemon-store/daemon-layer-typed-error-store.ts) |

---

## Forms catalog

### Queue

| File | Teaches |
|------|---------|
| [`forms/queue/workpool-priority-retry.ts`](./forms/queue/workpool-priority-retry.ts) | `WorkPool.Service`, priority, dedup key, handler retry |
| [`forms/queue/workpool-priority-lanes.ts`](./forms/queue/workpool-priority-lanes.ts) | `WorkPool.priority`, named lanes, `add(item, lane?)`, weighted take |

### Hyperlink

| File | Teaches |
|------|---------|
| [`forms/hyperlink/gate-unit-and-input.ts`](./forms/hyperlink/gate-unit-and-input.ts) | `Gate.Service` unit/input forms + concurrency + `Store.layerDefaultMemory` |
| [`forms/hyperlink/gate-store-readback.ts`](./forms/hyperlink/gate-store-readback.ts) | Engine auto-write + `Gate.store` + `Store.Service.at` readback |
| [`forms/hyperlink/gate-runtime-observer.ts`](./forms/hyperlink/gate-runtime-observer.ts) | Observable handle (`status`, counters) via `Subscribable` |
| [`forms/hyperlink/http-client-gate.ts`](./forms/hyperlink/http-client-gate.ts) | `HttpClientGate.transformClient` |
| [`forms/hyperlink/gate-http-api-client.ts`](./forms/hyperlink/gate-http-api-client.ts) | `Gate.HttpApiClient` Tag + nest metrics |
| [`forms/hyperlink/gate-http-api-layer-effect.ts`](./forms/hyperlink/gate-http-api-layer-effect.ts) | `Gate.httpApiClientLayer` + sidecar capture |
| [`forms/hyperlink/telemetry-fleet-glass.ts`](./forms/hyperlink/telemetry-fleet-glass.ts) | `Telemetry` leaf snapshot + fleet `inFlightByNode` / `fleetInFlight` |
| [`forms/hyperlink/fleet-health-glass.ts`](./forms/hyperlink/fleet-health-glass.ts) | `FleetHealth` leaf `local` + fleet `byNode` / `status` (`Reachable` \| `Unreachable`) |
| [`forms/hyperlink/node-tag-addressed.ts`](./forms/hyperlink/node-tag-addressed.ts) | `Node.Tag` with `{ path }` + `Node.unix` / `client` |
| [`forms/hyperlink/node-http-nameless-serve.ts`](./forms/hyperlink/node-http-nameless-serve.ts) | **(8a)** Nameless `Node.http(serve)` — Lookup **piped** |
| [`forms/hyperlink/node-ws-nameless-serve.ts`](./forms/hyperlink/node-ws-nameless-serve.ts) | **(8b)** Nameless `Node.ws(serve)` — Lookup **piped** |
| — | `Node.nPipe` — Windows named-pipe sibling of `unix` (same `IpcSocket` kind; see `test/node-npipe.test.ts`) |
| [`forms/hyperlink/node-tag-bound.ts`](./forms/hyperlink/node-tag-bound.ts) | Tag carries node — `Node.unix(Jobs, impl)` + `Hyperlink.client(Jobs)` |
| [`forms/hyperlink/node-clients.ts`](./forms/hyperlink/node-clients.ts) | Catalog `ROut` + `Node.clients(Worker, [Jobs, Emails])` |
| [`forms/hyperlink/node-tag-addressless-serve.ts`](./forms/hyperlink/node-tag-addressless-serve.ts) | Address-less serve — Lookup **piped** (`Lookup.layerOptions({ path })`; default is bare `Lookup.layer`) — terminal A |
| [`forms/hyperlink/node-tag-addressless-call.ts`](./forms/hyperlink/node-tag-addressless-call.ts) | Address-less call — `lookupClient` + Lookup **piped** — terminal B |
| [`forms/hyperlink/node-nameless-listen-serve.ts`](./forms/hyperlink/node-nameless-listen-serve.ts) | **(5)** Nameless `Node.unix([serve…])` — Lookup **piped**, terminal A |
| [`forms/hyperlink/node-nameless-listen-call.ts`](./forms/hyperlink/node-nameless-listen-call.ts) | Nameless call (`discoverClients(Jobs, Emails)`) — terminal B |
| [`forms/hyperlink/node-nameless-listen-demo.ts`](./forms/hyperlink/node-nameless-listen-demo.ts) | One-command proof — forks serve, then call |
| [`forms/hyperlink/node-prototype.ts`](./forms/hyperlink/node-prototype.ts) | `Node.Prototype.make` + `.listen(serves)` |
| [`forms/hyperlink/node-lookup.ts`](./forms/hyperlink/node-lookup.ts) | **(7)** `Node.asLookup` + `Lookup.layerNode` / `client` |
| [`forms/hyperlink/node-identity-coordinator.ts`](./forms/hyperlink/node-identity-coordinator.ts) | **One brain, many hands** — identity Router + Advice + N Workers ([guide](../docs/guides/identity-coordinator.md)) |
| [`forms/hyperlink/node-verify-connection.ts`](./forms/hyperlink/node-verify-connection.ts) | `Hyperlink.verifyConnection` tier-1 + `{ deep: true, resource }` |
| [`forms/hyperlink/shardmap-sessions.ts`](./forms/hyperlink/shardmap-sessions.ts) | `ShardMap` routed ops across distributed nodes |

### Daemon store (EventJournal)

| File | Teaches |
|------|---------|
| [`forms/daemon-store/daemon-layer-store-auto-write.ts`](./forms/daemon-store/daemon-layer-store-auto-write.ts) | **`Daemon.layer`** + **`Daemon.store(tag)`** — auto-append on terminal runs, app store override |
| [`forms/daemon-store/daemon-layer-typed-error-store.ts`](./forms/daemon-store/daemon-layer-typed-error-store.ts) | Tag `{ error }` → typed `Failed.error` in execution history |

Start here for execution history. **`Daemon.make`** does not auto-append.

Storage:

- **`Store.Service` + `Daemon.store(tag)`** — execution events (`Started` / `Completed` / `Failed` / `Interrupted`) on EventJournal; auto-write on **`Daemon.layer`** only.
- **Durable logs** — `Node.logs` / toolkit `*.store` on a `Store.Service`; `hyperlink-ts/Logs` handles capture/relay + `byNode` / `byHyperlink`.

### Schedule

| File | Teaches |
|------|---------|
| [`forms/schedule/schedule-at.ts`](./forms/schedule/schedule-at.ts) | `DaemonSchedule.at` (one-shot) |
| [`forms/schedule/schedule-window.ts`](./forms/schedule/schedule-window.ts) | `DaemonSchedule.window` (bounded) |
| [`forms/schedule/schedule-define.ts`](./forms/schedule/schedule-define.ts) | `DaemonSchedule.define` composition |
| [`forms/schedule/schedule-controls-initializer.ts`](./forms/schedule/schedule-controls-initializer.ts) | Controls from `schedule` initializer |
| [`forms/schedule/schedule-controls-in-effect.ts`](./forms/schedule/schedule-controls-in-effect.ts) | `Daemon.scheduleControls` in tick body |
| [`forms/schedule/schedule-controls-external-fiber.ts`](./forms/schedule/schedule-controls-external-fiber.ts) | External fiber via `DaemonSchedule` service |

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
| [`scenarios/multi-protocol-dual-serve.ts`](./scenarios/multi-protocol-dual-serve.ts) | One `{ http, ws }` node served over both transports (P3 boot guard) + a live round-trip over each |
| [`scenarios/nwslsoccer/`](./scenarios/nwslsoccer/) | Real HttpApi client against NWSL SDP (optional local tree) |

---

## npm scripts (from package root)

| Script | What it runs |
|--------|----------------|
| `pnpm run example:queue-hyperlink` | Queue form |
| `pnpm run example:daemon-patterns` | Alias for `example:daemon-supervisor-patterns` |
| `pnpm run example:daemon-supervisor-patterns` | Accelerating + delayed-start forms |
| `pnpm run example:sports-polling-accelerating` | All three sports polling forms |
| `pnpm run example:schedule-control-surfaces` | All three schedule control forms |
| `pnpm run example:schedule-control-basics` | `at` + `window` + `define` forms |
| `pnpm run example:schedule-control-db-sync` | DB sync scenario |
| `pnpm run example:gate` | Gate concurrency form |
| `pnpm run example:gate-store-readback` | Gate store auto-write + readback |
| `pnpm run example:http-client-gate` | HttpClient gate form |
| `pnpm run example:gate-http-api-client` | Gate.HttpApiClient form |
| `pnpm run example:gate-http-api-layer-effect` | `layerEffect` form |
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
2. `docs/legacy/PROCESS-API.md` / `docs/legacy/HYPERLINK-API.md` for tables
3. `docs/legacy/guides/toolkit-by-example.md` / `docs/legacy/guides/history-and-persistence.md` for patterns
4. **`forms/`** for a single API shape; **`scenarios/`** for composition patterns

Committed agent map: [docs/legacy/AGENTS.md](../docs/legacy/AGENTS.md).
