# Examples (`examples/`)

Runnable teaching scripts organized in two layers:

| Layer | Path | Purpose |
|-------|------|---------|
| **Forms** | [`forms/`](./forms/) | One API shape per file — minimal, focused references |
| **Scenarios** | [`scenarios/`](./scenarios/) | Descriptive compositions showing subsystems working together |
| **Shared** | [`shared/`](./shared/) | Test doubles, harness helpers, small shared utilities |

Cross-cutting narrative: [docs/PACKAGE-GUIDE.md](../docs/PACKAGE-GUIDE.md). API tables: [docs/PROCESS-API.md](../docs/PROCESS-API.md), [docs/RESOURCE-API.md](../docs/RESOURCE-API.md).

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
| **Start here** | [`scenarios/process-manager-playground/`](./scenarios/process-manager-playground/) (`pnpm run demo:pm`) → [`scenarios/full-process-group-with-queues-and-control-cli.ts`](./scenarios/full-process-group-with-queues-and-control-cli.ts) → [`forms/process-group/`](./forms/process-group/) |
| **Queues** | [`forms/queue/queue-resource-priority-retry.ts`](./forms/queue/queue-resource-priority-retry.ts) → main scenario |
| **Schedule controls** | `pnpm run example:schedule-control-basics` → `example:schedule-control-surfaces` → [`scenarios/schedule-sync-from-external-db.ts`](./scenarios/schedule-sync-from-external-db.ts) |
| **Process runtime** | `pnpm run example:process-supervisor-patterns` → [`scenarios/game-window-polling-with-process-group.ts`](./scenarios/game-window-polling-with-process-group.ts) |
| **Polling patterns** | `pnpm run example:sports-polling-accelerating` |
| **Resource gating** | [`forms/resource/run-resource-unit-and-input.ts`](./forms/resource/run-resource-unit-and-input.ts) → http-client → http-api forms |
| **Storage** | [`forms/process-store/process-store-memory.ts`](./forms/process-store/process-store-memory.ts) → [`process-store-events-file-layer.ts`](./forms/process-store/process-store-events-file-layer.ts) → [`process-store-prisma-structural-client.ts`](./forms/process-store/process-store-prisma-structural-client.ts) |

---

## Forms catalog

### Queue

| File | Teaches |
|------|---------|
| [`forms/queue/queue-resource-priority-retry.ts`](./forms/queue/queue-resource-priority-retry.ts) | `QueueResource.Service`, priority, dedup key, handler retry |

### Resource

| File | Teaches |
|------|---------|
| [`forms/resource/run-resource-unit-and-input.ts`](./forms/resource/run-resource-unit-and-input.ts) | `RunResource.make` unit and input forms + concurrency |
| [`forms/resource/run-resource-runtime-observer.ts`](./forms/resource/run-resource-runtime-observer.ts) | `ProcessStoreRunResource` per-type facts + `RunResourceState` transitions |
| [`forms/resource/http-client-run-gate.ts`](./forms/resource/http-client-run-gate.ts) | `HttpClientRunGate.transformClient` |
| [`forms/resource/http-api-resource-tag-layer.ts`](./forms/resource/http-api-resource-tag-layer.ts) | `HttpApiResource.make` tag + layer |
| [`forms/resource/http-api-resource-layer-effect.ts`](./forms/resource/http-api-resource-layer-effect.ts) | `HttpApiResource.layerEffect` + sidecar capture |

### ProcessStore

| File | Teaches |
|------|---------|
| [`forms/process-store/process-store-memory.ts`](./forms/process-store/process-store-memory.ts) | `ProcessStore.layer` / `memory` + `events(query)` |
| [`forms/process-store/process-store-events-sqlite-layer.ts`](./forms/process-store/process-store-events-sqlite-layer.ts) | `ProcessStore.events(query)` + `ProcessStore.layerRuntimeStorage` + SQLite adapter |
| [`forms/process-store/process-store-events-file-layer.ts`](./forms/process-store/process-store-events-file-layer.ts) | **Legacy** NDJSON `fileLayer` (do not copy) |
| [`forms/process-store/process-store-prisma-structural-client.ts`](./forms/process-store/process-store-prisma-structural-client.ts) | Placeholder showing Prisma adapter unavailability pending RuntimeStorage rewrite |

Storage options:

- `ProcessStore.layer` / `ProcessStore.memory` — in-memory analytics for tests and demos.
- `ProcessStore.layerRuntimeStorage` + `@nikscripts/effect-pm/storage/sqlite` — durable local SQLite runtime records (preferred).
- `ProcessStore.GroupLog` — structured group log history (`record`, `query`); `@nikscripts/effect-pm/Logs` for capture/relay in group children.
- `ProcessStore.QueueResource` — queue semantic storage helpers.
- `file(filePath)` / `fileLayer(filePath)` from `@nikscripts/effect-pm/storage/file` — **legacy** NDJSON only; do not use for new code.
- `PrismaProcessStore` from `@nikscripts/effect-pm/storage/prisma` — placeholder for the upcoming RuntimeStorage-backed Prisma rewrite.

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

### ProcessGroup

| File | Teaches |
|------|---------|
| [`forms/process-group/process-group-make-entries.ts`](./forms/process-group/process-group-make-entries.ts) | `ProcessGroup.make(id, entries)` |
| [`forms/process-group/process-group-service.ts`](./forms/process-group/process-group-service.ts) | `ProcessGroup.Service` |
| [`forms/process-group/process-group-contract-http.ts`](./forms/process-group/process-group-contract-http.ts) | `GET /contract` + `ProcessManager.connect` |
| [`forms/process-group/process-manager-connection-registry.ts`](./forms/process-group/process-manager-connection-registry.ts) | `ProcessManager.ConnectionRegistry.layer` + registry-backed `connect` |
| [`forms/process-group/process-manager-endpoint-service.ts`](./forms/process-group/process-manager-endpoint-service.ts) | `ProcessManager.Endpoint` + `ProcessGroup.remoteLayer` |
| [`forms/process-group/process-group-remote-layer.ts`](./forms/process-group/process-group-remote-layer.ts) | `ProcessGroup.remoteLayer` |
| [`forms/process-group/process-group-remote-contract-drift.ts`](./forms/process-group/process-group-remote-contract-drift.ts) | Remote group contract drift detection |
| [`forms/process-group/process-manager-multi-group-cli-ux.md`](./forms/process-group/process-manager-multi-group-cli-ux.md) | Multi-group `ProcessManager.cli` UX |

---

## Scenarios catalog

| File | Teaches |
|------|---------|
| [`scenarios/process-manager-playground/`](./scenarios/process-manager-playground/) | **ProcessManager.cli** — two groups, `group-start` / `group-stop`, processes + queues |
| [`scenarios/full-process-group-with-queues-and-control-cli.ts`](./scenarios/full-process-group-with-queues-and-control-cli.ts) | End-to-end ProcessGroup + queues + `ControlService.make` + `awaitShutdown` + legacy `pnpm run cli` |
| [`scenarios/game-window-polling-with-process-group.ts`](./scenarios/game-window-polling-with-process-group.ts) | `ProcessGroup.start` + schedule windows + `TestClock` |
| [`scenarios/schedule-sync-from-external-db.ts`](./scenarios/schedule-sync-from-external-db.ts) | DB-to-runtime schedule sync pattern |
| [`scenarios/nwslsoccer/`](./scenarios/nwslsoccer/) | Real HttpApi client against NWSL SDP (optional local tree) |

---

## npm scripts (from package root)

| Script | What it runs |
|--------|----------------|
| `pnpm run demo:pm -- …` | ProcessManager playground CLI (`groups`, `group-start`, `start`, queue controls) |
| `pnpm run example` | In-process scenario (`full-process-group-with-queues-and-control-cli`) + legacy `pnpm run cli` |
| `pnpm run example:typed-process-group` | ProcessGroup + ProcessManager forms |
| `pnpm run example:queue-resource` | Queue form |
| `pnpm run cli …` | CLI against the demo control port |
| `pnpm run example:process-patterns` | Alias for `example:process-supervisor-patterns` |
| `pnpm run example:process-supervisor-patterns` | Accelerating + delayed-start forms |
| `pnpm run example:sports-polling-accelerating` | All three sports polling forms |
| `pnpm run example:schedule-control-surfaces` | All three schedule control forms |
| `pnpm run example:schedule-control-basics` | `at` + `window` + `define` forms |
| `pnpm run example:schedule-control-db-sync` | DB sync scenario |
| `pnpm run example:process-game-window` | **`Process.Service` + typed `make(id, entries)`**, schedule windows + **`TestClock`** |
| `pnpm run example:run-resource` | RunResource form |
| `pnpm run example:http-client-run-gate` | HttpClient gate form |
| `pnpm run example:http-api-resource` | HttpApiResource form |
| `pnpm run example:http-api-resource-layer-effect` | `layerEffect` form |
| `pnpm run example:form:*` | Individual form scripts that are registered in `package.json` |

Run any file directly:

```bash
npx tsx examples/forms/schedule/schedule-at.ts
npx tsx examples/scenarios/game-window-polling-with-process-group.ts
```

---

## Control port

Examples and the CLI default to port **3001** unless **`HOME_SERVER_PORT`** is set. Keep the scenario and CLI on the **same** port.

---

## For AI assistants

When answering questions about **behavior**, prefer **source of truth** in this order:

1. `src/*.ts` implementation + TSDoc
2. `docs/SCHEDULE-AND-PROCESSGROUP.md` for supervisor semantics
3. `docs/PROCESS-API.md` / `docs/RESOURCE-API.md` for tables
4. **`forms/`** for a single API shape; **`scenarios/`** for composition patterns

Committed agent map: [docs/AGENTS.md](../docs/AGENTS.md).
