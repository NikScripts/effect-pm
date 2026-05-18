# effect-pm — package guide (humans & tooling)

This document is the **narrative companion** to the API tables in [PROCESS-API.md](./PROCESS-API.md) and the **architecture contracts** in [plans/README.md](./plans/README.md). Read it when you need *why* things exist and *how* pieces connect, not just signature-level *what*.

---

## What you are looking at

**effect-pm** (`@nikscripts/effect-pm`) is an [Effect](https://effect.website/)-first library for:

1. **Managed processes** — a schedule-entry-driven runtime: a driver watches `ProcessSchedule` entries, spawns instances, and each instance repeats a user `Effect` on a **polling cadence** until its window closes.
2. **Queue resources** — priority queues with concurrency, optional throttling, and lifecycle controls.
3. **Orchestration** — a **`ProcessGroup`** bundles processes + queue tags, tracks status, forks schedule drivers, and exposes **localhost HTTP control** + a **CLI**.
4. **Remote control** — **`ProcessManager`** connects to a group contract over HTTP, and **`ProcessGroup.remoteLayer`** can provide the same injectable group service key through a `ProcessManager.Endpoint`.

`ProcessManager.ConnectionRegistry.layer` provides registry-backed group URLs so
application code can `yield* ProcessManager.connect(Group)`. The multi-group CLI
is `ProcessManager.cli([GroupA, GroupB] as const)` on top of that same registry;
see
[examples/forms/process-group/process-manager-multi-group-cli-ux.md](../examples/forms/process-group/process-manager-multi-group-cli-ux.md)
for the operator flow. Multi-host coordination, `RemoteService`, and
remote queue enqueue stay planned until schema-backed queue item contracts land.

---

## Mental model (keep this picture)

```
┌───────────────────────────────────────────────────────────────────┐
│ ProcessGroup.make(id, entries) / ProcessGroup.Service(id, entries)│
│  • acquires queue instances (Effect services)                     │
│  • exposes typed process/queue controls + serializable contract   │
│  • drives contract-aligned ControlService and ProcessManager APIs │
└───────────────────────────────────────────────────────────────────┘
         │ start / forkIn(process.effect, scope)
         ▼
┌───────────────────────────────────────────────────────────────────┐
│ Process.make(id, { effect, polling?, schedule? })                 │
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
| Run the full demo + CLI | [examples/README.md](../examples/README.md) → `examples/scenarios/full-process-group-with-queues-and-control-cli.ts` |
| Queue / run / HTTP resource APIs | [RESOURCE-API.md](./RESOURCE-API.md) |
| Schedule composition + runtime updates | [examples/forms/schedule/](../examples/forms/schedule/) |
| Schedule + **`ProcessGroup`** / API-driven arm | [docs/SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md) + [examples/scenarios/game-window-polling-with-process-group.ts](../examples/scenarios/game-window-polling-with-process-group.ts) |
| Understand process runtime semantics | [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md) + `src/Process.ts` TSDoc |
| API tables (make, Polling, Schedule, ProcessGroup) | [PROCESS-API.md](./PROCESS-API.md) |
| ProcessStore storage (memory / file / Prisma) | [PROCESS-API.md](./PROCESS-API.md) + [examples/forms/process-store/](../examples/forms/process-store/) + `src/prisma/` |
| AI / agent onboarding (repo map, conventions) | [AGENTS.md](./AGENTS.md) |

---

## Package subpaths

Root imports from `@nikscripts/effect-pm` remain backwards compatible. Prefer
dedicated subpaths for focused imports:

- `@nikscripts/effect-pm/Process`
- `@nikscripts/effect-pm/QueueResource`
- `@nikscripts/effect-pm/ProcessGroup`
- `@nikscripts/effect-pm/ProcessStore`
- `@nikscripts/effect-pm/ProcessManager`
- `@nikscripts/effect-pm/ControlService`
- `@nikscripts/effect-pm/storage/file`
- `@nikscripts/effect-pm/storage/prisma`

Storage adapters use lowercase path segments. File-backed storage is preferred
from `@nikscripts/effect-pm/storage/file`; root `ProcessStore.file` /
`ProcessStore.fileLayer` remain current compatibility helpers. The legacy
`@nikscripts/effect-pm/prisma` path remains available, but new Prisma storage
examples use `@nikscripts/effect-pm/storage/prisma`.

---

## Public entry points (from `src/index.ts`)

| Export area | Role |
|-------------|------|
| `Process`, `Polling`, `ProcessSchedule` | Build supervised processes and gate/cadence layers. |
| `ProcessGroup` | Orchestrate processes + queues; typed contracts, controls, and `awaitShutdown`. |
| `ProcessManager` | Typed remote client and endpoint service for group control contracts. |
| `QueueResource` | Priority queues + workers. Public handle: `QueueHandle<T, E, EEnqueue, R>` (**requirements `R` last**); class services: `QueueResource.Service<Self, T, E, R>`. |
| `ProcessStore` | In-memory (or Prisma) analytics: executions + lifecycle events. |
| `RunResource`, `HttpClientRunGate` | Concurrency + throttle gates for arbitrary effects / `HttpClient`. |
| `HttpApiResource`, `Resource` | Typed HttpApi client as a service + layers. |
| `ControlService` | Localhost JSON control server consumed by `createCli` / `runCli`. |
| `createCli`, `runCli` | Build a CLI that talks to `ControlService`. |
| `disarmedIdleSleep` exports | Compatibility helpers for custom schedule logic. |

TSDoc on each module repeats details; this guide stays **concept-shaped**.

`RunResource` publishes runtime facts and `RunResourceState` transitions through
the optional `RuntimeObserver` service. `RuntimeObserver.layerProcessStore`
persists facts as `runtime.fact.recorded` events and state changes as
`runtime.state.changed` events. Scoped listener layers are implemented; stream
helpers remain planned.

---

## Dependencies and layers (practical rules)

1. **`ProcessGroup.make(id, entries)`** returns an `Effect` that requires the **queue tag identifiers** from queue entries (so queues are acquired exactly once in that scope).
2. **Forking** `process.effect` needs **`R | ProcessStore`** where `R` is whatever remains on the process after optional inlined `polling` / `schedule` layers. Use **`ProcessSupervisorRequirements<C>`** (exported type) if you build configs generically.
3. Prefer **`Layer.mergeAll(...)`** + **one** `Effect.provide` at the app root when you have many independent layers (clearer dependency graph; matches Effect lint guidance).
4. **Control service** listens on **127.0.0.1** only — designed for local ops, not public exposure.
5. **Remote control assumes a private network today.** Do not expose a
   `ControlService` or `ProcessManager` target on the public internet. Current
   HTTP control routes have no built-in authentication, authorization, replay
   protection, rate limits, or transport encryption.
6. **Remote group layers** keep the same group service key, but widen control errors to include remote failures and unsupported controls. Remote queue enqueue-style methods intentionally fail until queue item schemas are part of the group contract.

Planned remote-security work should cover, at minimum:

- TLS/mTLS or an equivalent authenticated transport boundary,
- signed control requests or short-lived bearer credentials,
- explicit authorization scopes for status vs mutation controls,
- operator/audit metadata on every remote command,
- replay protection and request timestamps/nonces,
- rate limits and defensive request-size limits,
- safe defaults that keep localhost/private-network usage easy while making
  public exposure opt-in and visibly unsafe without security layers.

---

## Examples directory

All runnable scripts live under `examples/`:

- **`examples/forms/`** — one API shape per file
- **`examples/scenarios/`** — descriptive compositions
- **`examples/shared/`** — test doubles and harness helpers

See [examples/README.md](../examples/README.md) for commands, learning paths, and file purposes. They are the **best teaching surface** after this guide.

---

## Architecture plans (`docs/plans/`)

These are **specs**: if code disagrees with a living plan, treat the plan as the intended design and reconcile deliberately. [plans/README.md](./plans/README.md) lists each document and reading order.

---

## Version and toolchain

Package version and scripts live in `package.json`. Effect major line follows the repo’s pinned `effect` dependency; check `peerDependencies` before upgrading downstream apps.
