# Process

In effect-pm, a **process** is a reusable, named unit of background work. You give it a stable **id**, an **effect** that runs on each repeat (one **tick**), and optionally **polling** (how often to repeat while active) and **schedule** (when repeating is allowed). The library runs a long-lived **driver** (`process.effect`) that applies those rules and, when `ProcessStore` is in the environment, records executions and lifecycle events.

Processes are the smallest orchestration building block. Later you will group them with queues in a `ProcessGroup` and expose controls over HTTP. This page covers **creating** a process with `Process.make` and **running** it.

## Background jobs without a process

You can run recurring work in Effect by forking a fiber and sleeping in a loop:

```typescript
const loop = Effect.gen(function* () {
  while (true) {
    yield* Effect.logInfo("tick")
    yield* Effect.sleep("5 seconds")
  }
})
```

That works for demos, but most applications reimplement the same concerns: stable naming for ops tools, separating **cadence** from **calendar windows**, tracking failures, and shutting down cleanly. A **process** wraps those behind `Process.make` and `process.effect`.

## Managing work with a process

effect-pm splits responsibilities so each piece can change independently:

| Piece | Role |
| --- | --- |
| `effect` | One **tick** — the `Effect` that runs on each repeat. |
| `polling` | How long to wait between ticks **while the schedule is armed**. |
| `schedule` | Whether a run instance is **armed** right now (windows, always-on, and so on). |
| `process.effect` | Long-lived **driver** you start once; it runs the supervisor loop. |

The driver's `Effect` type includes whatever your tick needs, after optional `polling` and `schedule` layers are merged in at `Process.make`.

Let's walk through using a process step by step:

1. **Creating a process** — `Process.make(id, config)`.
2. **Running the driver** — fork `process.effect` inside a scoped program.
3. **Running one tick** — `runImmediately` without the supervisor loop.

## How it works

Until you fork `process.effect`, nothing runs. Forking starts the **schedule driver**: a supervisor fiber that watches the schedule and, when armed, runs **wait for poll → run your tick → afterTick** (when polling is provided).

Two ideas are easy to confuse at first:

| Concept | Meaning |
| --- | --- |
| Driver **started** | You forked `process.effect` (or called `ProcessGroup.start` on a later page). |
| Schedule **armed** | At least one schedule entry covers the current time, so a run instance may tick. |

While armed, one run instance repeats when polling is configured:

```
awaitNextTick  →  your effect  →  polling.afterTick
       ↑___________________________________|
```

Without **polling** (and without providing `Polling` at the fork site), a run instance executes the tick **once** per schedule entry instead of looping on a cadence.

Polling and schedule are Effect **layers**. When you pass them on `Process.make`, they are merged into `process.effect`, so you usually do not provide separate `Polling` or `ProcessSchedule` layers when forking.

## Default schedule

When you omit both `schedule` and `scheduleLayer` on `Process.make`, the library uses **`ProcessSchedule.alwaysArmed`**: the process is eligible to tick as soon as the driver is running.

| What you pass | Behavior |
| --- | --- |
| Nothing (omit `schedule`) | Same as `alwaysArmed` — ticks allowed once the driver is up (if polling is set). |
| `schedule: ProcessSchedule.alwaysArmed` | Explicit always-on (same default). |
| `schedule: ProcessSchedule.empty` | Driver runs, but **disarmed** until you `set` / `add` / `upsert` entries (or use a schedule initializer). |
| `schedule: ProcessSchedule.inMemory([...])` | Starts with the entries you supply. |
| `schedule: (controls) => Effect` | Backing store is **empty** `inMemory`; initializer runs once at driver startup to seed or subscribe. |

If you previously omitted `schedule` expecting a disarmed process until external code added windows, pass **`schedule: ProcessSchedule.empty`** explicitly.

## Creating a process

`Process.make` takes two arguments so the id cannot be forgotten:

1. **`id`** — stable string (`@app/Heartbeat`, `@repo/package/SyncInvoices`, and so on). Exposed as `process.name` on the handle.
2. **`config`** — `ProcessMakeOptions`: `effect`, optional `polling`, optional `schedule` / `scheduleLayer` (no `name` field).

`Process.make("id")` alone is a **type error**; you must pass the config object as the second argument.

### Example (Heartbeat)

```typescript
import { Duration, Effect } from "effect"
import { Process, Polling } from "@nikscripts/effect-pm"

const heartbeat = Process.make("@app/Heartbeat", {
  effect: Effect.logInfo("heartbeat tick"),
  polling: Polling.spaced(Duration.seconds(5)),
  // schedule omitted → ProcessSchedule.alwaysArmed
})
```

### Example (Disarmed until you add a window)

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

### Example (`Process.Service`)

For typed `ProcessGroup` entries, use the same `id` and config shape as `make`:

```typescript
class Heartbeat extends Process.Service<Heartbeat>()("@app/Heartbeat", {
  effect: Effect.logInfo("heartbeat tick"),
  polling: Polling.spaced(Duration.seconds(5)),
}) {}
```

`Process.make` returns a **handle**:

| Member | Description |
| --- | --- |
| `name` | The `id` you passed to `make`. |
| `effect` | Driver `Effect` — fork this to start the supervisor. |
| `runImmediately` | One tracked tick outside the supervisor loop. |
| `getStatus` | Best-effort status; uses `ProcessStore` when provided. |

| Concept | Description |
| --- | --- |
| tick | A single run of your `effect` callback. |
| driver | `process.effect` — the long-lived supervisor fiber. |
| polling | Cadence between ticks while armed. |
| schedule | Gate that decides whether an instance may tick now. |
| armed | At least one schedule entry covers the current time. |

## Running the driver

Run the driver inside a **scoped** program so child fibers can be interrupted when the scope closes. Provide `ProcessStore.layer` when you want execution history.

### Example (Fork and stop)

```typescript
import { Duration, Effect, Fiber } from "effect"
import { ProcessStore } from "@nikscripts/effect-pm"

const program = Effect.gen(function* () {
  const driverFiber = yield* Effect.forkChild(heartbeat.effect)

  yield* Effect.sleep(Duration.seconds(12))

  yield* Fiber.interrupt(driverFiber)
}).pipe(Effect.scoped)

Effect.runPromise(program.pipe(Effect.provide(ProcessStore.layer)))
```

What happens:

1. `forkChild(heartbeat.effect)` starts the supervisor. While armed, it repeats the poll → tick → `afterTick` loop (with `Polling.spaced` above).
2. `Fiber.interrupt` stops the driver. In a long-running app you might use OS signals or `ProcessGroup.awaitShutdown` instead.

If the tick needs other services (database, `HttpClient`, and so on), provide those layers together with `ProcessStore.layer` at the application root.

## Running one tick

Sometimes you need a **single** execution — a test, a manual "run now", or a script — without starting the supervisor loop.

### Example (`runImmediately`)

```typescript
import { Effect } from "effect"
import { ProcessStore } from "@nikscripts/effect-pm"

const once = Effect.gen(function* () {
  yield* heartbeat.runImmediately()

  const store = yield* ProcessStore
  const rows = yield* store.getProcessExecutions(heartbeat.name)
  console.log(`executions recorded: ${rows.length}`)
}).pipe(Effect.provide(ProcessStore.layer))

Effect.runPromise(once)
```

`runImmediately` runs the same tick body with tracking. It does **not** require the schedule to be armed. The driver loop is separate.

## Attaching polling or schedule later

You can build options first, then attach layers with the same **id**:

```typescript
import type { ProcessMakeOptions } from "@nikscripts/effect-pm"

const base: ProcessMakeOptions<never, never> = {
  effect: Effect.logInfo("bare tick"),
}

const withPolling = Process.providePolling("@app/Bare", base, Polling.spaced("1 second"))
const withSchedule = Process.provideSchedule(
  "@app/Bare",
  base,
  ProcessSchedule.empty,
)
```

For application code, passing `polling` and `schedule` on `Process.make(id, { ... })` keeps wiring in one place.

## Next steps

| Topic | What you will learn |
| --- | --- |
| Polling | `spaced`, `jittered`, `backoff`, `accelerating`, and waking the cadence early. |
| ProcessSchedule | Entries, windows, `reconcile`, and mutating the schedule while the driver runs. |
| ProcessGroup | Bundling processes and queues, `start` / `stop`, and localhost control. |
