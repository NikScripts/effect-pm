# Process

A **process** is a named unit of background work in effect-pm. You provide an `Effect` that runs to completion on each **repeat**; the library runs a long-lived **driver** (`process.effect`) that coordinates optional **polling** (how long to wait between repeats while allowed) and **schedule** (whether repeats are allowed at the current time). The same repeat body can run once through `runImmediately()` without starting the driver. When `ProcessStore` is in the environment, executions and lifecycle events are recorded for status and control surfaces.

This guide documents **every supported way to define a process**, when to choose each shape, configuration fields, the handle API, types, and how `Process` fits next to polling, schedule, storage, and groups. It is separate from [`docs/rewrite/02-process.md`](../rewrite/02-process.md) and [`docs/PROCESS-API.md`](../PROCESS-API.md); those can be merged later.

---

## Ways to define a process

The process **id** is always the first argument. After that you either pass the repeat **`effect`** plus optional **polling** / **schedule** layers in any order, or a single **config object** when you need a schedule initializer or `scheduleLayer`.

### `Process.make(id, effect, …layers?)`

Returns a **`Process<R>`** handle: `name`, `effect` (driver), `runImmediately()`, `getStatus()`.

```typescript
import { Duration, Effect } from "effect";
import { Polling, Process, ProcessSchedule } from "@nikscripts/effect-pm";

const sync = Process.make(
  "@app/Sync",
  Effect.logInfo("sync"),
  Polling.spaced(Duration.seconds(30)),
  ProcessSchedule.inMemory([
    ProcessSchedule.window("match-1", startAt, stopAt),
  ]),
);

// polling and schedule can be swapped
const heartbeat = Process.make(
  "@app/Heartbeat",
  Effect.logInfo("tick"),
  ProcessSchedule.empty,
  Polling.spaced(Duration.seconds(5)),
);
```

**Benefits**

- Direct call site: effect first, then layers — no config object for the common case.
- Polling and schedule order does not matter.
- Still a plain value; easy in tests and scripts.

**Tradeoffs**

- Not a `ProcessGroup` entry by itself.
- Schedule **initializers** `(controls) => Effect` require the config-object form (below).

---

### `Process.make(id, config)`

Same runtime as the positional form. Use when you need **`schedule: (controls) => Effect`**, **`scheduleLayer`**, or a single object for clarity.

```typescript
const gameSync = Process.make("@app/GameSync", {
  effect: Effect.logInfo("sync scores"),
  polling: Polling.spaced(Duration.seconds(15)),
  schedule: ProcessSchedule.empty,
});
```

**Benefits**

- Full `ProcessMakeOptions` surface (initializer, explicit `scheduleLayer`).
- Familiar when migrating from older object-only call sites.

---

### `Process.Service<Self>()(id, effect, …layers?)` or `(id, config)`

Same overloads as **`Process.make`**, but returns a **`Context.Service`** subclass with `id`, `kind: "process"`, `process`, `layer`, and `tag`.

```typescript
class Heartbeat extends Process.Service<Heartbeat>()(
  "@app/Heartbeat",
  Effect.logInfo("tick"),
  Polling.spaced(Duration.seconds(5)),
) {}

// const proc = yield* Heartbeat;
// Provide Heartbeat.layer (+ ProcessStore.layer at app root when recording)
```

```typescript
class GameSync extends Process.Service<GameSync>()("@app/GameSync", {
  effect: Effect.logInfo("sync"),
  schedule: (controls) =>
    controls.set([ProcessSchedule.window("match", start, end)]),
  polling: Polling.spaced(Duration.seconds(15)),
}) {}
```

**Benefits**

- **Typed `ProcessGroup` membership** and layer-first app wiring.
- Stable class symbol for contracts and `ProcessManager`.

**Tradeoffs**

- More ceremony than `make` for a one-off worker.
- Ids are part of your public contract.

---

## Layer wiring

| Concern | Positional / config on `make` | At fork site |
| --- | --- | --- |
| **`polling`** | `Polling.spaced`, `Polling.accelerating`, etc. (effect-pm presets) | Omit on `make`; `Effect.provide(Polling…)` on `proc.effect` when forking |
| **`schedule`** | `ProcessSchedule.*` presets, initializer, or `scheduleLayer` on config | Not replaceable via env alone — configure on `make` / `Service` |

Positional layers must be **effect-pm polling or schedule presets** (or other layers branded by those factories) so the runtime can tell them apart when order varies.

**External polling at fork:**

```typescript
const proc = Process.make("@app/Tick", Effect.logInfo("tick"));

yield* Effect.forkChild(
  proc.effect.pipe(Effect.provide(Polling.spaced(Duration.millis(100)))),
);
```

---

## Choosing a form

| Goal | Prefer |
| --- | --- |
| Script, spike, or test with one worker | `Process.make(id, effect, …)` |
| Schedule initializer or `scheduleLayer` | `Process.make(id, config)` or `Service` config form |
| Entry in `ProcessGroup` / control API | `Process.Service` |
| Production default | Inline polling + schedule on `make` / `Service` |

---

## Configuration (`ProcessMakeOptions`)

Used by the **config-object** overload only.

| Field | Required | Role |
| --- | --- | --- |
| `effect` | yes | `Effect<void, E, R>` — one repeat. |
| `polling` | no | Cadence between repeats while **armed**. |
| `schedule` | no | Layer, initializer, or omit → **`ProcessSchedule.alwaysArmed`**. Use **`ProcessSchedule.empty`** to start disarmed. |
| `scheduleLayer` | no | Explicit schedule layer; wins over `schedule`. |

### Schedule defaults

| What you pass | Behavior |
| --- | --- |
| Omit `schedule` and `scheduleLayer` | `ProcessSchedule.alwaysArmed` |
| `schedule: ProcessSchedule.empty` | Disarmed until `set` / `add` / initializer |
| `schedule: ProcessSchedule.inMemory([...])` | Fixed initial entries |
| `schedule: (controls) => Effect` | Empty store; initializer at driver startup |

### Inside the running `effect`

| API | Purpose |
| --- | --- |
| `Process.currentScheduleId` | Optional id of the active schedule entry |
| `Process.scheduleControls` | `entries`, `set`, `add`, `clear` from the tick body |

See [`docs/SCHEDULE-AND-PROCESSGROUP.md`](../SCHEDULE-AND-PROCESSGROUP.md) and [`docs/PROCESS-API.md`](../PROCESS-API.md).

---

## Driver and handle API

| Member | Description |
| --- | --- |
| `name` | Stable id. |
| `effect` | Driver — fork once per lifecycle (or let `ProcessGroup` fork it). |
| `runImmediately()` | One tracked repeat; schedule need not be armed. |
| `getStatus(range?)` | Snapshot; uses `ProcessStore` when available. |

```typescript
import { Effect, Fiber } from "effect";

const program = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(heartbeat.effect);
  yield* Fiber.interrupt(fiber);
}).pipe(Effect.scoped);
```

Provide **`ProcessStore.layer`** at the app root when you want execution history.

---

## Types

| Symbol | Meaning |
| --- | --- |
| `Process<R>` | Handle. |
| `ProcessMakeOptions<E, R>` | Config-object form. |
| `ProcessPollingInput` | Polling layer positional argument. |
| `ProcessScheduleInput<R>` | Schedule layer or initializer. |
| `ProcessSupervisorRequirements<C>` | Inferred env for `process.effect` from config `C`. |
| `ProcessDefinition<Id, R>` | On `Process.Service` for groups. |

Merged `polling` / `schedule` on `make` are excluded from fork-time `R`.

---

## Related tools

| Tool | Role |
| --- | --- |
| **`Polling`** | Cadence between repeats. |
| **`ProcessSchedule`** | Armed/disarmed windows. |
| **`ProcessStore`** | Executions and lifecycle events. |
| **`ProcessGroup`** | Fibers, `start` / `stop`, typed controls. |
| **`ControlService`** | Localhost HTTP control. |
| **`ProcessManager`** | Typed remote client. |

---

## Implementation reference

| Location | Contents |
| --- | --- |
| `src/Process.ts` | `make`, `Service`, driver |
| `src/Polling.ts` | Cadence presets |
| `src/ProcessSchedule.ts` | Schedule presets |
| `src/ProcessStore.ts` | Analytics |

Planned guides: **QueueResource**, **ProcessGroup**, **ProcessManager**.
