# Process

In application development, **background work** is logic that should keep running outside the request path: heartbeats, sync jobs, pollers, and other repeating tasks. You usually express that work as an `Effect`, but running it safely in the background still requires a stable name, a way to repeat it on a schedule, visibility into failures, and a clear stop path.

Without a dedicated abstraction, you might use Effect’s own repetition tools and fork the result—but you still wire identity, calendar gates, history, and lifecycle yourself. The same concerns show up in every app: separating **how often** work runs from **when** it is allowed to run, recording executions, and stopping cleanly.

effect-pm introduces a **process**: a named wrapper around an `Effect` that adds observability and controls. You supply the effect that runs on each repeat; the library runs a long-lived **driver** (`process.effect`) that applies polling cadence and schedule rules. Each repeat runs your effect to completion before the next wait begins.

## Repeating work by hand

Imagine you want to log a heartbeat every five seconds. Effect already gives you `Effect.repeat` and `Schedule.spaced` for cadence—you fork that in the background and interrupt it when you are done:

```typescript
import { Duration, Effect, Fiber, Schedule } from "effect"

const tick = Effect.logInfo("heartbeat")

const repeating = tick.pipe(Effect.repeat(Schedule.spaced(Duration.seconds(5))))

const program = Effect.gen(function* () {
  const worker = yield* Effect.forkChild(repeating)

  yield* Effect.sleep(Duration.seconds(12))
  yield* Fiber.interrupt(worker)
}).pipe(Effect.scoped)

Effect.runPromise(program)
```

That is idiomatic Effect for fixed spacing, but it is still just an anonymous fiber: no stable id for ops tools, no execution history, no schedule gate separate from cadence, and no shared stop/run-once API. `Fiber.interrupt` can still stop the fiber in the middle of `tick`, not only between repeats.

## Managing background work with effect-pm

effect-pm keeps your business logic as a normal `Effect` and moves orchestration behind `Process.make` and `process.effect`:

**Named unit of work.** A stable string `id` identifies the process in logs, stores, and (later) control APIs.

**Observability.** `getStatus` reflects runtime state; with `ProcessStore` in the environment, executions and lifecycle events are recorded.

**Controls.** Fork `process.effect` to start repeating work; call `runImmediately` for a single tracked run without the driver loop.

**Cadence and schedule.** Optional `polling` controls the wait between completed repeats. Optional `schedule` controls whether repeats are allowed at the current time.

Let's walk through using a process step by step:

1. **Creating a process** — define the repeat effect and optional polling / schedule with `Process.make`.
2. **Running the driver** — fork `process.effect` inside a scoped program.
3. **Running one repeat** — use `runImmediately` when you need a single execution.

## How it works

Until you fork `process.effect`, nothing runs. Forking starts the **driver**: a supervisor fiber that watches the schedule and, while **armed**, runs repeats in a loop.

A repeat is one full execution of the `effect` you passed to `Process.make`. While the schedule is armed and `polling` is configured, the driver cycles:

```
wait for next tick → run your effect → update cadence → wait again
```

If you omit `polling` (and do not provide `Polling` when forking), each armed window runs your effect **once** instead of on a cadence.

`polling` and `schedule` are Effect layers. When you pass them on `Process.make`, they are merged into `process.effect`, so you usually do not provide separate `Polling` or `ProcessSchedule` layers at the fork site.

Two states are easy to confuse at first:

| Concept | Meaning |
| --- | --- |
| Driver **started** | You forked `process.effect` (or started a `ProcessGroup` on a later page). |
| Schedule **armed** | At least one schedule entry covers the current time, so the driver may repeat. |

Let's summarize the concepts covered so far:

| Concept | Description |
| --- | --- |
| process | A named wrapper around an `Effect` with a driver, optional cadence, and optional schedule gate. |
| repeat | One execution of the `effect` callback inside the driver (or via `runImmediately`). |
| driver | `process.effect` — the long-lived supervisor you fork once. |
| polling | Cadence between completed repeats while the schedule is armed. |
| schedule | Whether repeats are allowed at the current time. |
| armed | The schedule currently allows the driver to repeat. |

## Creating a process

To create a process, you need:

1. **An `id`** — a stable string (for example `@app/Heartbeat`). Exposed as `process.name` on the handle.
2. **A config object** — `ProcessMakeOptions` with a required `effect` and optional `polling`, `schedule`, or `scheduleLayer`.

`Process.make` takes both arguments together. `Process.make("id")` without a second argument is a type error.

When you omit `schedule` and `scheduleLayer`, the default is `ProcessSchedule.alwaysArmed`: the process may repeat as soon as the driver is running (if `polling` is set). Pass `schedule: ProcessSchedule.empty` when the driver should run but stay disarmed until you add entries elsewhere.

| What you pass | Behavior |
| --- | --- |
| Nothing (omit `schedule`) | Same as `ProcessSchedule.alwaysArmed`. |
| `schedule: ProcessSchedule.alwaysArmed` | Explicit always-on. |
| `schedule: ProcessSchedule.empty` | Disarmed until you `set` / `add` / `upsert` entries. |
| `schedule: ProcessSchedule.inMemory([...])` | Starts with the entries you supply. |
| `schedule: (controls) => Effect` | Empty `inMemory` backing; initializer runs once at driver startup. |

Example (Defining a heartbeat process)

```typescript
import { Duration, Effect } from "effect"
import { Process, Polling } from "@nikscripts/effect-pm"

const heartbeat = Process.make("@app/Heartbeat", {
  effect: Effect.logInfo("heartbeat tick"),
  polling: Polling.spaced(Duration.seconds(5)),
})
```

`Process.make` returns a **handle** with:

| Member | Description |
| --- | --- |
| `name` | The `id` you passed to `make`. |
| `effect` | Driver `Effect` — fork this to start the supervisor. |
| `runImmediately` | One tracked repeat outside the driver loop. |
| `getStatus` | Best-effort status; uses `ProcessStore` when provided. |

Example (Starting disarmed until you publish a window)

```typescript
import { Process, Polling, ProcessSchedule } from "@nikscripts/effect-pm"
import { Duration, Effect } from "effect"

const gameSync = Process.make("@app/GameSync", {
  effect: Effect.logInfo("sync scores"),
  polling: Polling.spaced(Duration.seconds(15)),
  schedule: ProcessSchedule.empty,
})

// Elsewhere, with ProcessSchedule in context:
// const schedule = yield* ProcessSchedule
// yield* schedule.set([ProcessSchedule.window("match-1", start, end)])
```

For typed entries in a `ProcessGroup`, use the same `id` and config shape with `Process.Service`:

Example (Defining a process with `Process.Service`)

```typescript
import { Duration, Effect } from "effect"
import { Process, Polling } from "@nikscripts/effect-pm"

class Heartbeat extends Process.Service<Heartbeat>()("@app/Heartbeat", {
  effect: Effect.logInfo("heartbeat tick"),
  polling: Polling.spaced(Duration.seconds(5)),
}) {}
```

## Running the driver

Run the driver inside a **scoped** program so child fibers can be interrupted when the scope closes. Provide `ProcessStorage.layer` at the application root when you want execution history persisted.

Example (Forking the driver and stopping)

```typescript
import { Duration, Effect, Fiber } from "effect"
import { ProcessStorage } from "@nikscripts/effect-pm"

const program = Effect.gen(function* () {
  const driverFiber = yield* Effect.forkChild(heartbeat.effect)

  yield* Effect.sleep(Duration.seconds(12))

  yield* Fiber.interrupt(driverFiber)
}).pipe(Effect.scoped)

Effect.runPromise(program.pipe(Effect.provide(ProcessStorage.layer)))
```

Forking `heartbeat.effect` starts the supervisor. While the schedule is armed, it repeats: wait, run your effect, update cadence. Interrupting the driver fiber stops further repeats.

If the repeat effect needs other services (a database, `HttpClient`, and so on), provide those layers together with `ProcessStorage.layer` where you run the program.

## Running one repeat

Sometimes you need a **single** execution — a test, a manual run, or a script — without starting the supervisor loop. `runImmediately` runs the same effect body with tracking. It does not require the schedule to be armed.

Example (Using `runImmediately`)

```typescript
import { Effect } from "effect"
import { ProcessStorage } from "@nikscripts/effect-pm"
import { ProcessStoreProcessExecution } from "@nikscripts/effect-pm/store/ProcessExecution"

const once = Effect.gen(function* () {
  yield* heartbeat.runImmediately()

  const store = yield* ProcessStoreProcessExecution
  const rows = yield* store.executions({ processId: heartbeat.name })
  console.log(`executions recorded: ${rows.length}`)
}).pipe(Effect.provide(ProcessStorage.layer))

Effect.runPromise(once)
```

Later pages cover **Polling** (cadence presets), **ProcessSchedule** (windows and live updates), and **ProcessGroup** (bundling processes, `start` / `stop`, and localhost control).
