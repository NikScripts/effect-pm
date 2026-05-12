# effect-pm — package guide (humans & tooling)

This document is the **narrative companion** to the API tables in [PROCESS-API.md](./PROCESS-API.md) and the **architecture contracts** in [plans/README.md](./plans/README.md). Read it when you need *why* things exist and *how* pieces connect, not just signature-level *what*.

---

## What you are looking at

**effect-pm** (`@nikscripts/effect-pm`) is an [Effect](https://effect.website/)-first library for:

1. **Managed processes** — a schedule-entry-driven runtime: a driver watches `ProcessSchedule` entries, spawns instances, and each instance repeats a user `Effect` on a **polling cadence** until its window closes.
2. **Queue resources** — priority queues with concurrency, optional throttling, and lifecycle controls.
3. **Orchestration** — a **`ProcessGroup`** bundles processes + queue tags, tracks status, forks schedule drivers, and exposes **localhost HTTP control** + a **CLI**.

A future **`ProcessManager`** (multi-host) is planned but **not implemented**; use one `ProcessGroup` per deployable bundle today.

---

## Mental model (keep this picture)

```
┌───────────────────────────────────────────────────────────────────┐
│ ProcessGroup.make({ queues, processes })                          │
│  • acquires queue instances (Effect services)                     │
│  • holds Map(name → Process handle) + status + Scope per fork     │
└───────────────────────────────────────────────────────────────────┘
         │ start / forkIn(process.effect, scope)
         ▼
┌───────────────────────────────────────────────────────────────────┐
│ Process.make({ name, effect, polling?, schedule? })               │
│  • builds process.effect = schedule driver                        │
│  • eligible schedule start -> spawn process instance              │
│  • instance loop: schedule check -> poll -> user effect           │
│  • polling/schedule Layers can be inlined into process.effect     │
└───────────────────────────────────────────────────────────────────┘
         │ each tick
         ▼
┌───────────────────────────────────────────────────────────────────┐
│ user `effect` (your Effect<void, E, R>)                           │
│  • may yield queue tags, DB, HTTP, etc.                           │
│  • failures: logged + optional ProcessStore execution rows        │
└───────────────────────────────────────────────────────────────────┘
```

**Key distinction:** `Polling` answers “how often does an armed instance repeat?” `ProcessSchedule` answers “should this instance keep running right now?” Stopping a process interrupts driver + child instances; disarming makes instances exit naturally.

---

## Where to read next (by goal)

| Goal | Start here |
|------|------------|
| Run the full demo + CLI | [examples/README.md](../examples/README.md) → `examples/example.ts` |
| Queue / run / HTTP resource APIs | [RESOURCE-API.md](./RESOURCE-API.md) |
| Schedule composition + runtime updates | [examples/schedule-control-surfaces.ts](../examples/schedule-control-surfaces.ts) |
| Schedule + **`ProcessGroup`** / API-driven arm | [docs/SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md) + [examples/process-game-window-with-group.ts](../examples/process-game-window-with-group.ts) |
| Understand process runtime semantics | [plans/09-process-runtime.md](./plans/09-process-runtime.md) |
| API tables (make, Polling, Schedule, ProcessGroup) | [PROCESS-API.md](./PROCESS-API.md) |
| Prisma-backed analytics | [README.md](../README.md) Prisma section + `src/prisma/` |
| AI / agent onboarding (repo map, conventions) | [AGENTS.md](./AGENTS.md) |

---

## Public entry points (from `src/index.ts`)

| Export area | Role |
|-------------|------|
| `Process`, `Polling`, `ProcessSchedule` | Build supervised processes and gate/cadence layers. |
| `ProcessGroup` | Orchestrate processes + queues; `serve`, `awaitShutdown`, lifecycle APIs. |
| `QueueResource` | Priority queues + workers. |
| `ProcessStore` | In-memory (or Prisma) analytics: executions + lifecycle events. |
| `RunResource`, `HttpClientRunGate` | Concurrency + throttle gates for arbitrary effects / `HttpClient`. |
| `HttpApiResource`, `Resource` | Typed HttpApi client as a service + layers. |
| `ControlService` | Localhost JSON control server consumed by `createCli` / `runCli`. |
| `createCli`, `runCli` | Build a CLI that talks to `ControlService`. |
| `disarmedIdleSleep` exports | Compatibility helpers for custom schedule logic. |

TSDoc on each module repeats details; this guide stays **concept-shaped**.

---

## Dependencies and layers (practical rules)

1. **`ProcessGroup.make`** returns an `Effect` that requires the **queue tag identifiers** you passed in `queues` (so queues are acquired exactly once in that scope).
2. **Forking** `process.effect` needs **`R | ProcessStore`** where `R` is whatever remains on the process after optional inlined `polling` / `schedule` layers. Use **`ProcessSupervisorRequirements<C>`** (exported type) if you build configs generically.
3. Prefer **`Layer.mergeAll(...)`** + **one** `Effect.provide` at the app root when you have many independent layers (clearer dependency graph; matches Effect lint guidance).
4. **Control service** listens on **127.0.0.1** only — designed for local ops, not public exposure.

---

## Examples directory

All runnable scripts live under `examples/`; **`examples/mocks/`** holds test doubles and long-form scenario docs for some scripts. See [examples/README.md](../examples/README.md) for commands, learning paths, and file purposes. They are the **best teaching surface** after this guide.

---

## Architecture plans (`docs/plans/`)

These are **specs**: if code disagrees with a living plan, treat the plan as the intended design and reconcile deliberately. [plans/README.md](./plans/README.md) lists each document and reading order.

---

## Version and toolchain

Package version and scripts live in `package.json`. Effect major line follows the repo’s pinned `effect` dependency; check `peerDependencies` before upgrading downstream apps.
