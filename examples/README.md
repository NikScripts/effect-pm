# Examples (`examples/`)

Scripts in this folder are **teaching and integration references**. They live alongside `src/` and `docs/` so humans and tools can read them as runnable API examples.

**`examples/mocks/`** — long-form comments + **test doubles** / scenario setup + **`demo-harness.mock.ts`** (`forkSupervisedAndSideThenAdvanceTime`, `runNodeProgramOrExit`).

---

## Prerequisites

- **Node.js** compatible with the repo `engines` field in `package.json`.
- **Dependencies** installed from the package root (`pnpm install`, or `npm install` if you use the lockfile there).
- Most examples use **`tsx`** via `npx` or npm scripts so you do not need a separate build step.

---

## Suggested tracks

Pick a track based on what you are building.

| Track | Read in this order |
|------|---------------------|
| **Start here** | [`example.ts`](./example.ts) → [`typed-process-group.ts`](./typed-process-group.ts) → [`cli.ts`](./cli.ts) |
| **Queues** | [`queue-resource.ts`](./queue-resource.ts) → [`example.ts`](./example.ts) |
| **Schedule controls** | [`schedule-control-basics.ts`](./schedule-control-basics.ts) → [`schedule-control-surfaces.ts`](./schedule-control-surfaces.ts) → [`schedule-control-db-sync.ts`](./schedule-control-db-sync.ts) |
| **Process runtime behavior** | [`process-supervisor-patterns.ts`](./process-supervisor-patterns.ts) → [`process-game-window-with-group.ts`](./process-game-window-with-group.ts) |
| **Polling patterns** | [`sports-polling-accelerating.ts`](./sports-polling-accelerating.ts) |
| **Resource gating** | [`run-resource.ts`](./run-resource.ts) → [`http-client-run-gate.ts`](./http-client-run-gate.ts) → [`http-api-resource.ts`](./http-api-resource.ts) → [`http-api-resource-layer-effect.ts`](./http-api-resource-layer-effect.ts) |

Cross-cutting narrative: [docs/PACKAGE-GUIDE.md](../docs/PACKAGE-GUIDE.md). Process API tables: [docs/PROCESS-API.md](../docs/PROCESS-API.md). Resource APIs: [docs/RESOURCE-API.md](../docs/RESOURCE-API.md). Schedule + group: [docs/SCHEDULE-AND-PROCESSGROUP.md](../docs/SCHEDULE-AND-PROCESSGROUP.md).

---

## npm scripts (from package root)

| Script | What it runs |
|--------|----------------|
| `pnpm run example` | Full ProcessGroup demo (`example.ts`). |
| `pnpm run example:typed-process-group` | Typed ProcessGroup declarations, injectable group service, and `GET /contract`. |
| `pnpm run example:queue-resource` | QueueResource priority + retry demo. |
| `pnpm run cli …` | CLI against the demo control port (pass args after `--`). |
| `pnpm run example:process-supervisor-patterns` | Supervisor patterns with TestClock. |
| `pnpm run example:sports-polling-accelerating` | Accelerating poll + score-driven `resetCadence` (`readScore` facade). |
| `pnpm run example:schedule-gates-and-cron` | Alias for `schedule-control-surfaces` example (initializer/effect/external controls). |
| `pnpm run example:schedule-control-surfaces` | Schedule controls from initializer, effect, and external controller fibers. |
| `pnpm run example:schedule-control-basics` | Intro schedule entry patterns (`at`, `window`, `define`). |
| `pnpm run example:schedule-control-db-sync` | Simulated DB-to-runtime schedule sync using controls. |
| `pnpm run example:process-game-window` | `ProcessGroup` + schedule windows + `TestClock`. |
| `pnpm run example:run-resource` | RunResource demo. |
| `pnpm run example:http-client-run-gate` | HttpClient + RunResource gate. |
| `pnpm run example:http-api-resource` | HttpApiResource basic. |
| `pnpm run example:http-api-resource-layer-effect` | HttpApiResource `layerEffect` demo. |

If a script is missing, run the file directly:

```bash
npx tsx examples/<file>.ts
```

---

## File reference

| File | Teaches |
|------|---------|
| [`example.ts`](./example.ts) | End-to-end **ProcessGroup.make**, **queues**, **Process.make** (polling + schedule inlined), **ProcessStore.layer**, **serve** + **awaitShutdown**, **Layer.mergeAll** for root `provide`. |
| [`typed-process-group.ts`](./typed-process-group.ts) | **`Process.Service`**, **`QueueResource.Service`**, **`ProcessGroup.make(id, entries)`**, **`ProcessGroup.Service`**, typed queue controls, **`ControlService` `GET /contract`**, and remote **`ProcessManager.connect`**. |
| [`queue-resource.ts`](./queue-resource.ts) | Focused **QueueResource.Service** example: priority enqueue, dedup key, handler-driven retry, and effectful status properties. |
| [`cli.ts`](./cli.ts) | Wiring **`runCli`** with port from `HOME_SERVER_PORT` (must match the demo). |
| [`schedule-control-basics.ts`](./schedule-control-basics.ts) | Minimal schedule entry patterns: one-shot starts, bounded windows, and `ProcessSchedule.define` composition. |
| [`process-supervisor-patterns.ts`](./process-supervisor-patterns.ts) | Deterministic tests: **accelerating** polling and schedule disarm/re-arm with in-memory entries. |
| [`schedule-control-surfaces.ts`](./schedule-control-surfaces.ts) | End-to-end schedule control surfaces (`schedule` initializer, `Process.scheduleControls`, `ProcessSchedule` service from external fibers). |
| [`schedule-control-db-sync.ts`](./schedule-control-db-sync.ts) | Simulated DB sync strategy: startup `set` + in-effect re-sync to keep runtime schedule aligned with external data. |
| [`process-game-window-with-group.ts`](./process-game-window-with-group.ts) | **`ProcessGroup.start`** / **`ProcessGroup.stop`**, schedule windows + `Process.currentScheduleId`; doc **`docs/SCHEDULE-AND-PROCESSGROUP.md`**. |
| [`sports-polling-accelerating.ts`](./sports-polling-accelerating.ts) | **3 demos** (basic → minimal → verbose); mocks + **`demo-harness.mock.ts`**; **`TestClock.setTime(0)`** between sections. |
| [`run-resource.ts`](./run-resource.ts) | **RunResource.make** (unit and `(input) => Effect` forms) + limits. |
| [`http-client-run-gate.ts`](./http-client-run-gate.ts) | **HttpClientRunGate.withRunner** after building a fetch client. |
| [`http-api-resource.ts`](./http-api-resource.ts) | **HttpApiResource** tag + layer + optional limits. |
| [`http-api-resource-layer-effect.ts`](./http-api-resource-layer-effect.ts) | **`layerEffect`**, capture sidecar service, shared gate. |

---

## Prisma-backed **ProcessStore**

There is no separate “prisma example” file: the adapter ships as **`@nikscripts/effect-pm/prisma`**. From your app:

```bash
npx effect-pm add prisma
npx prisma generate
npx prisma migrate dev --name add_effect_pm_event
```

Then provide `PrismaProcessStore.layer({ client })` in your `Effect` program. See the main [README](../README.md) for full setup, flags (`--dry-run`, `--separate-file`), and `layerFromContext`.

---

## Control port

Examples and the CLI default to port **3001** unless **`HOME_SERVER_PORT`** is set. Keep the demo and CLI on the **same** port.

---

## For AI assistants

When answering questions about **behavior**, prefer **source of truth** in this order:

1. `src/*.ts` implementation + TSDoc  
2. `src/Process.ts` TSDoc and `docs/SCHEDULE-AND-PROCESSGROUP.md` for supervisor semantics
3. `docs/PROCESS-API.md` for quick tables  
4. These examples for **composition patterns**

Committed agent map: [docs/AGENTS.md](../docs/AGENTS.md).
