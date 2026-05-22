# Process

A **process** is a named unit of background work in effect-pm. You provide an `Effect` that runs to completion on each **repeat**; the library runs a long-lived **driver** (`process.effect`) that coordinates optional **polling** (how long to wait between repeats while allowed) and **schedule** (whether repeats are allowed at the current time). The same repeat body can run once through `runImmediately()` without starting the driver. When `ProcessStore` is in the environment, executions and lifecycle events are recorded for status and control surfaces.

This guide documents **every supported way to define a process**, when to choose each shape, configuration fields, the handle API, types, and how `Process` fits next to polling, schedule, storage, and groups. It is separate from the narrative chapter [`docs/rewrite/02-process.md`](../rewrite/02-process.md) and the spec tables in [`docs/PROCESS-API.md`](../PROCESS-API.md); those can be merged later.

---

## Ways to define a process

All definitions share **`ProcessMakeOptions`**: required `effect`, optional `polling`, `schedule`, and `scheduleLayer`. The process **id** is always the first argument to `Process.make` or `Process.Service` — never a field inside the config object.

### `Process.make(id, config)`

Returns a **`Process<R>`** value: a handle with `name`, `effect` (the driver), `runImmediately()`, and `getStatus()`.

```typescript
import { Duration, Effect } from "effect";
import { Polling, Process, ProcessSchedule } from "@nikscripts/effect-pm";

const heartbeat = Process.make("@app/Heartbeat", {
  effect: Effect.logInfo("tick"),
  polling: Polling.spaced(Duration.seconds(5)),
  schedule: ProcessSchedule.empty,
});
```

**Benefits**

- Minimal API: no `Context.Tag` or `Layer` unless you choose to add them at the app root.
- The handle is a plain value — easy to pass into tests, scripts, or ad hoc wiring.
- Same config shape as `Process.Service`; you can promote to a service class when you need a group entry.

**Tradeoffs**

- Not a `ProcessGroup` entry on its own; groups expect a `Process.Service` class or a definition produced from `make`.
- If you omit `polling` / `schedule` on `make`, you must supply them when forking `process.effect` (polling only) or accept baked-in schedule defaults (see [Layer wiring](#layer-wiring-inline-vs-fork-site)).

---

### `Process.Service<Self>()(id, config)`

Returns an Effect **`Context.Service`** subclass. Static fields include `id`, `kind: "process"`, `contract` metadata via the group system, `process` (the handle), `layer`, and `tag`. In a program, `yield* MyProcess` is the same `Process<R>` as `Process.make` would produce.

```typescript
import { Duration, Effect, Layer } from "effect";
import { Polling, Process, ProcessStore } from "@nikscripts/effect-pm";

class Heartbeat extends Process.Service<Heartbeat>()("@app/Heartbeat", {
  effect: Effect.logInfo("tick"),
  polling: Polling.spaced(Duration.seconds(5)),
}) {}

// Provide at app root, then:
// const proc = yield* Heartbeat;
```

**Benefits**

- **Typed `ProcessGroup` membership** — list `Heartbeat` in the group entry tuple; `group.process(Heartbeat)` / `runImmediately(Heartbeat)` stay type-safe.
- **Layer-first composition** — `Heartbeat.layer` merges like any other Effect service.
- **Stable symbol** for contracts, HTTP control, and `ProcessManager` remotes.

**Tradeoffs**

- More boilerplate than `make` for a one-off worker.
- The id string is part of your public contract; changing it breaks store `entityId`s and remote control paths.

---

### `Process.providePolling` and `Process.provideSchedule`

Build a handle from a **base config** plus a layer attached in a second step:

```typescript
const base = { effect: Effect.logInfo("sync") } as const;

const withCadence = Process.providePolling(
  "@app/Sync",
  base,
  Polling.spaced(Duration.seconds(30)),
);

const withWindow = Process.provideSchedule(
  "@app/Sync",
  base,
  ProcessSchedule.inMemory([
    ProcessSchedule.window("match-1", startAt, stopAt),
  ]),
);
```

**Benefits**

- One shared `effect` (and shared error/requirement typing) with swappable cadence or schedule layers per environment.
- Identical runtime wiring to passing `polling` / `scheduleLayer` directly on `make`.

**Tradeoffs**

- Still a value handle, not a `Process.Service`; use `Service` when the process is a first-class module boundary or group entry.

---

### Layer wiring: inline vs fork site

| Concern | On `Process.make` / `Service` | At fork or app root |
| --- | --- | --- |
| **`polling`** | Pass `polling: SomePollingLayer` — merged into `process.effect` | Omit on `make`; `Effect.provide(Polling...)` on `proc.effect` (or parent env) when forking |
| **`schedule`** | Pass `schedule`, `scheduleLayer`, or `provideSchedule` — always configure here | Providing `ProcessSchedule` only in the parent env **does not** replace the driver’s baked schedule; omitting schedule on `make` defaults to **`ProcessSchedule.alwaysArmed`** inside the driver |

**Inline (typical production shape)**

```typescript
Process.make("@app/Tick", {
  effect: body,
  polling: Polling.spaced(Duration.seconds(1)),
  schedule: ProcessSchedule.empty,
});
```

**External polling only**

```typescript
const proc = Process.make("@app/Tick", { effect: body });

yield* Effect.forkChild(
  proc.effect.pipe(Effect.provide(Polling.spaced(Duration.millis(100)))),
);
```

**Benefits of inline layers:** fewer `provide` sites; `ProcessSupervisorRequirements` excludes merged `Polling` / `ProcessSchedule` from fork-time `R`.

**Benefits of external polling:** swap cadence implementations in tests without rebuilding the process value.

---

## Choosing a form

| Goal | Prefer |
| --- | --- |
| Script, spike, or test with one worker | `Process.make` |
| Entry in `ProcessGroup`, control API, or `ProcessManager` | `Process.Service` |
| Same tick body, different cadence/schedule per deploy | `providePolling` / `provideSchedule` or inline fields on a shared base config |
| Production default | Inline `polling` and `schedule` on `make` or `Service` |

---

## Configuration (`ProcessMakeOptions`)

| Field | Required | Role |
| --- | --- | --- |
| `effect` | yes | `Effect<void, E, R>` — one repeat; runs to completion before the next wait. |
| `polling` | no | `Layer` for cadence between repeats while the schedule is **armed** for that entry. If omitted and not provided at fork, each armed window runs the body once (no poll loop). |
| `schedule` | no | Schedule layer, initializer `(controls) => Effect`, or omit for **`ProcessSchedule.alwaysArmed`**. Use **`ProcessSchedule.empty`** to start disarmed until entries are added. |
| `scheduleLayer` | no | Explicit schedule layer; takes precedence over `schedule` when both are set. |

### Schedule behavior

| What you pass | Behavior |
| --- | --- |
| Omit `schedule` and `scheduleLayer` | `ProcessSchedule.alwaysArmed` |
| `schedule: ProcessSchedule.alwaysArmed` | Explicit always-on |
| `schedule: ProcessSchedule.empty` | Disarmed until `set` / `add` / initializer |
| `schedule: ProcessSchedule.inMemory([...])` | Starts with the given entries |
| `schedule: (controls) => Effect` | In-memory store; initializer runs once when the driver starts |

### Inside the running `effect`

| API | Purpose |
| --- | --- |
| `Process.currentScheduleId` | Optional id of the schedule entry for the current instance |
| `Process.scheduleControls` | `entries`, `set`, `add`, `clear` from inside the tick body |

Schedule vs cadence semantics and `ProcessGroup.start`: [`docs/SCHEDULE-AND-PROCESSGROUP.md`](../SCHEDULE-AND-PROCESSGROUP.md). Polling factories and service methods: [`docs/PROCESS-API.md`](../PROCESS-API.md).

---

## Driver and handle API

Fork **`process.effect`** inside a **scoped** program (or let **`ProcessGroup`** fork it). That starts the supervisor: it watches the schedule, and while armed runs the repeat loop (wait → `effect` → cadence update → wait).

| Member | Description |
| --- | --- |
| `name` | Stable id (same string as passed to `make` / `Service`). |
| `effect` | Driver `Effect` — long-lived supervisor. |
| `runImmediately()` | One tracked repeat; schedule does not need to be armed. |
| `getStatus(range?)` | Runtime snapshot; reads `ProcessStore` when available. |

**Start and stop the driver**

```typescript
import { Effect, Fiber } from "effect";

const program = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(heartbeat.effect);
  // ... application runs ...
  yield* Fiber.interrupt(fiber);
}).pipe(Effect.scoped);
```

**Single repeat**

```typescript
yield* heartbeat.runImmediately();
```

Provide **`ProcessStore.layer`** (and any `R` from your `effect`) at the application root when you want execution history and richer `getStatus`.

---

## Types

| Symbol | Meaning |
| --- | --- |
| `Process<R>` | Handle after `make` or `yield* Service`. `R` is user requirements not merged into `process.effect`. |
| `ProcessMakeOptions<E, R>` | Config object (second argument). |
| `ProcessSupervisorRequirements<C>` | Inferred environment for `process.effect` / `runImmediately()` from config `C`. |
| `ProcessDefinition<Id, R>` | `{ id, kind: "process", process }` — carried on `Process.Service` for groups. |

When `polling` or schedule layers are set on `make`, they are merged into `process.effect`, so fork-time `R` usually excludes `Polling` and `ProcessSchedule`.

---

## Related tools

| Tool | Role relative to `Process` |
| --- | --- |
| **`Polling`** | Cadence between repeats (`spaced`, `acceleratingScoped`, custom layers). |
| **`ProcessSchedule`** | Armed/disarmed windows; `set` / `add` / `clear` / `changed`. |
| **`ProcessStore`** | Execution and lifecycle events; optional at app root via `ProcessStore.layer`. |
| **`ProcessGroup`** | Fiber ownership, `start` / `stop`, typed controls; process entries are `Process.Service` or definitions from `make`. |
| **`ControlService`** | Localhost HTTP JSON control for a running group. |
| **`ProcessManager`** | Typed remote client over a group contract. |

---

## Implementation reference

| Location | Contents |
| --- | --- |
| `src/Process.ts` | `make`, `Service`, `providePolling`, `provideSchedule`, driver |
| `src/Polling.ts` | Cadence layers and `PollingService` |
| `src/ProcessSchedule.ts` | Schedule storage and presets |
| `src/ProcessStore.ts` | Analytics facade |
| `src/ProcessGroup.ts` | Orchestration over processes and queues |

---

## Planned doc work

Later guides in this series (same structure: overview → definition forms → config → types → related tools): **QueueResource**, **ProcessGroup**, **ProcessManager**. Runnable example commands will be added when dedicated example scripts exist; this page does not depend on them.
