# Examples (`examples/`)

Scripts in this folder are **teaching and integration references**. They are **not** published inside the npm tarball (see package `files` / `.npmignore`), but they **are** in the Git repository so humans and tools can read them alongside `src/` and `docs/`.

**`examples/mocks/`** — long-form comments + **test doubles** / scenario setup + **`demo-harness.mock.ts`** (`forkSupervisedAndSideThenAdvanceTime`, `runNodeProgramOrExit`). Not published to npm.

---

## Prerequisites

- **Node.js** compatible with the repo `engines` field in `package.json`.
- **Dependencies** installed from the package root (`pnpm install`, or `npm install` if you use the lockfile there).
- Most examples use **`tsx`** via `npx` or npm scripts so you do not need a separate build step.

---

## Suggested learning order

Read in this order if you are new to effect-pm:

1. **[`example.ts`](./example.ts)** — Full **ProcessGroup**: two queues, one **Process** (`Polling` + `ProcessSchedule`), **ProcessStore**, **ControlService** (`serve`), **`awaitShutdown`**, and how to **`Layer.mergeAll`** dependencies at the program root.
2. **[`cli.ts`](./cli.ts)** — Minimal script that runs **`runCli`** against the control port while `example.ts` is up.
3. **[`process-supervisor-patterns.ts`](./process-supervisor-patterns.ts)** — **TestClock**-driven patterns: accelerating polling plus runtime schedule mutation (`set` / `clear`).
4. **[`schedule-gates-and-cron.ts`](./schedule-gates-and-cron.ts)** — **`ProcessSchedule`** composition (`at`, `window`, `define`) and dynamic updates while a process is running.
5. **[`process-game-window-with-group.ts`](./process-game-window-with-group.ts)** — **`ProcessGroup.startProcess`** with schedule ids (`Process.currentScheduleId`); read **[`docs/SCHEDULE-AND-PROCESSGROUP.md`](../docs/SCHEDULE-AND-PROCESSGROUP.md)**.
6. **[`sports-polling-accelerating.ts`](./sports-polling-accelerating.ts)** — **Three demos:** basic **`Polling.spaced`**, accelerating + **`resetCadence`** (minimal tick), then verbose **`peekCadence`**; feed + **`demo-harness`** in **`examples/mocks/`**.
7. **[`run-resource.ts`](./run-resource.ts)** — **`RunResource`**: throttle + concurrency gate for arbitrary effects.
8. **[`http-client-run-gate.ts`](./http-client-run-gate.ts)** — Gate an **`HttpClient`** pipeline (same idea as gating HttpApi clients).
9. **[`http-api-resource.ts`](./http-api-resource.ts)** — **`HttpApiResource.make`**: typed HttpApi client as a **Context.Service** + `layer`.
10. **[`http-api-resource-layer-effect.ts`](./http-api-resource-layer-effect.ts)** — Advanced **`layerEffect`** composition with an extra capture service.

Cross-cutting narrative: [docs/PACKAGE-GUIDE.md](../docs/PACKAGE-GUIDE.md). API tables: [docs/PROCESS-API.md](../docs/PROCESS-API.md). Schedule + group: [docs/SCHEDULE-AND-PROCESSGROUP.md](../docs/SCHEDULE-AND-PROCESSGROUP.md).

---

## npm scripts (from package root)

| Script | What it runs |
|--------|----------------|
| `pnpm run example` | Full ProcessGroup demo (`example.ts`). |
| `pnpm run cli …` | CLI against the demo control port (pass args after `--`). |
| `pnpm run example:process-supervisor-patterns` | Supervisor patterns with TestClock. |
| `pnpm run example:sports-polling-accelerating` | Accelerating poll + score-driven `resetCadence` (`readScore` facade). |
| `pnpm run example:schedule-gates-and-cron` | Compositional schedule entries + live schedule updates. |
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
| [`cli.ts`](./cli.ts) | Wiring **`runCli`** with port from `HOME_SERVER_PORT` (must match the demo). |
| [`process-supervisor-patterns.ts`](./process-supervisor-patterns.ts) | Deterministic tests: **accelerating** polling and schedule disarm/re-arm with in-memory entries. |
| [`schedule-gates-and-cron.ts`](./schedule-gates-and-cron.ts) | Schedule entry composition + `ProcessSchedule` mutation; links to **`test/process-schedule.test.ts`** + **`test/process.test.ts`**. |
| [`process-game-window-with-group.ts`](./process-game-window-with-group.ts) | **`startProcess`** / **`stopProcess`**, schedule windows + `Process.currentScheduleId`; doc **`docs/SCHEDULE-AND-PROCESSGROUP.md`**. |
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
2. `docs/plans/09-process-v2-effect-first.md` for supervisor semantics  
3. `docs/PROCESS-API.md` for quick tables  
4. These examples for **composition patterns**

Committed agent map: [docs/AGENTS.md](../docs/AGENTS.md).
