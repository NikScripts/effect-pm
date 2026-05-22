# Process — guide, forms, and runnable examples

A **process** in effect-pm is a named unit of background work: you supply an `Effect` that runs on each **repeat**, and the library runs a long-lived **driver** (`process.effect`) that applies optional **polling** (cadence between repeats) and **schedule** (whether repeats are allowed right now). The same body can be run once via `runImmediately()` without starting the driver. With `ProcessStore` in the environment, executions and lifecycle events are recorded for status APIs and (later) control surfaces.

This guide is the **examples-oriented** companion to the narrative rewrite in [`docs/rewrite/02-process.md`](../rewrite/02-process.md) and the spec reference [`docs/PROCESS-API.md`](../PROCESS-API.md). Those stay focused on concepts; this page lists **every main way to define a process**, when to pick each shape, configuration fields, types, related tools, and **commands to run forms**.

---

## Runnable examples (commands)

From the package root:

| Command | What it demonstrates |
| --- | --- |
| `pnpm run example:form:process-make-minimal` | [`process-make-minimal.ts`](../../examples/forms/process/process-make-minimal.ts) — `Process.make`, inline `polling`, fork driver |
| `pnpm run example:form:process-service` | [`process-service.ts`](../../examples/forms/process/process-service.ts) — `Process.Service` + `.layer` |
| `pnpm run example:form:process-run-immediately` | [`process-run-immediately.ts`](../../examples/forms/process/process-run-immediately.ts) — single tracked run, `ProcessStore` |
| `pnpm run example:form:process-external-layers` | [`process-external-layers.ts`](../../examples/forms/process/process-external-layers.ts) — provide `Polling` when forking `process.effect` |
| `pnpm run example:form:schedule-delayed-start` | [`schedule-delayed-start.ts`](../../examples/forms/polling/schedule-delayed-start.ts) — `schedule` on env + `TestClock` (pair with inline `schedule` on `make` in production) |
| `pnpm run example:form:polling-accelerating` | [`polling-accelerating.ts`](../../examples/forms/polling/polling-accelerating.ts) — accelerating cadence inside a process |
| `pnpm run example:process-patterns` | Chained polling + schedule forms |
| `pnpm run example:process-game-window` | [`game-window-polling-with-process-group.ts`](../../examples/scenarios/game-window-polling-with-process-group.ts) — process inside a `ProcessGroup` |

Run all process forms in one go:

```bash
pnpm run example:process-forms
```

---

## Ways to create a process

All paths share the same **config object** (`ProcessMakeOptions`): a required `effect` and optional `polling`, `schedule`, and `scheduleLayer`. The **id** is always the first argument (or the first argument to `Process.Service`), not a field inside config.

### 1. `Process.make(id, config)` — value handle

**Shape:** returns a `Process<R>` handle with `name`, `effect`, `runImmediately()`, and `getStatus()`.

```typescript
import { Duration, Effect } from "effect";
import { Polling, Process } from "@nikscripts/effect-pm";

const heartbeat = Process.make("@app/Heartbeat", {
  effect: Effect.logInfo("tick"),
  polling: Polling.spaced(Duration.seconds(5)),
});
```

**Benefits**

- Smallest API surface; no `Context` tag or `Layer` unless you want them.
- Good for scripts, one-off workers, and tests where the handle is passed around directly.
- Same config as `Process.Service`; easy to lift into a service class later.

**Tradeoffs**

- Not a `ProcessGroup` entry by itself — groups want a `ProcessDefinition` or `Process.Service` class.
- You compose `polling` / `schedule` layers yourself at the fork site unless you pass them on `make` (see below).

**Run:** `pnpm run example:form:process-make-minimal`

---

### 2. `Process.Service<Self>()(id, config)` — class + layer

**Shape:** Effect `Context.Service` subclass with static `id`, `kind`, `process`, `layer`, and `tag`. `yield* MyProcess` gives the same `Process<R>` handle as `make`.

```typescript
import { Duration, Effect } from "effect";
import { Polling, Process } from "@nikscripts/effect-pm";

class Heartbeat extends Process.Service<Heartbeat>()("@app/Heartbeat", {
  effect: Effect.logInfo("tick"),
  polling: Polling.spaced(Duration.seconds(5)),
}) {}

// In a program:
const proc = yield* Heartbeat;
// Provide: Heartbeat.layer (and ProcessStore.layer at app root when recording history)
```

**Benefits**

- **Typed `ProcessGroup` entries** — pass `Heartbeat` in the group tuple; controls resolve to this id.
- **Layer-first wiring** — `Heartbeat.layer` fits app roots and test harnesses like other Effect services.
- **Stable import** — one class symbol for CLI contracts, HTTP control, and `ProcessManager` remotes.

**Tradeoffs**

- More ceremony than `make` for a single throwaway worker.
- Service id should stay stable; renames affect contracts and store `entityId`s.

**Run:** `pnpm run example:form:process-service`

---

### 3. `Process.providePolling` / `Process.provideSchedule` — config builders

Attach layers **after** defining base options, without duplicating the whole config:

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
  ProcessSchedule.inMemory([ProcessSchedule.window("match", start, end)]),
);
```

**Benefits**

- Keeps shared `effect` config in one place when cadence and schedule vary by deployment.
- Same runtime wiring as passing `polling` / `scheduleLayer` on `make`.

**Tradeoffs**

- Still returns a plain handle (not a `Process.Service`); use `Service` when you need a tag.

---

### 4. Inline layers on `make` vs layers at the fork site

| Piece | Inline on `make` | At fork / app root |
| --- | --- | --- |
| **`polling`** | Yes — merged into `process.effect` | Yes — when omitted on `make`, provide `Polling` where you fork |
| **`schedule`** | Yes — always configure here (or via `provideSchedule`) | No — default `alwaysArmed` is baked into the driver; env `ProcessSchedule` does not replace it |

Inline (recommended for most apps):

```typescript
Process.make("@app/Tick", {
  effect: body,
  polling: Polling.spaced(Duration.seconds(1)),
  schedule: ProcessSchedule.empty,
});
```

External **polling** only (provide on the forked driver):

```typescript
const proc = Process.make("@app/Tick", { effect: body });

yield* Effect.forkChild(
  proc.effect.pipe(Effect.provide(Polling.spaced(Duration.millis(100)))),
);
```

Schedule windows belong on `make` (or `provideSchedule`). For delayed `startAt` with `TestClock`, see `pnpm run example:form:schedule-delayed-start`.

**Benefits of inline:** fewer `provide` call sites; `ProcessSupervisorRequirements` excludes merged tags from fork-time `R`.

**Benefits of external polling:** swap cadence implementations in tests without rebuilding the process value.

**Run:** `pnpm run example:form:process-external-layers`

---

## Which form should I use?

| Goal | Prefer |
| --- | --- |
| Script or test with one worker | `Process.make` |
| Register in `ProcessGroup` / control API | `Process.Service` |
| Share effect config, vary schedule/polling | `providePolling` / `provideSchedule` |
| Swap schedule implementation in tests | External layers at fork |
| Production app defaults | Inline `polling` / `schedule` on `make` or `Service` |

---

## Configuration (`ProcessMakeOptions`)

| Field | Required | Role |
| --- | --- | --- |
| `effect` | yes | `Effect<void, E, R>` — one **repeat** (full run to completion before next wait). |
| `polling` | no | `Layer` for cadence between repeats while **armed**. Omit → no polling layer merged (single run per armed window unless you provide `Polling` externally). |
| `schedule` | no | Schedule **layer**, **initializer** `(controls) => Effect`, or omit → `ProcessSchedule.alwaysArmed`. Use `ProcessSchedule.empty` to start **disarmed** until entries are added. |
| `scheduleLayer` | no | Explicit schedule layer; wins over `schedule` when both are set. |

### Schedule defaults (quick reference)

| What you pass | Behavior |
| --- | --- |
| Omit `schedule` and `scheduleLayer` | `ProcessSchedule.alwaysArmed` |
| `schedule: ProcessSchedule.empty` | Disarmed until `set` / `add` / initializer |
| `schedule: ProcessSchedule.inMemory([...])` | Starts with fixed entries |
| `schedule: (controls) => Effect` | Empty in-memory store; initializer runs at driver startup |

### Inside the running `effect`

| API | Purpose |
| --- | --- |
| `Process.currentScheduleId` | Optional id of the active schedule entry for this instance |
| `Process.scheduleControls` | `entries`, `set`, `add`, `clear` from inside the process body |

Deeper schedule and polling behavior: [`docs/PROCESS-API.md`](../PROCESS-API.md), [`docs/SCHEDULE-AND-PROCESSGROUP.md`](../SCHEDULE-AND-PROCESSGROUP.md).

---

## Handle API (after `make` or `yield* Service`)

| Member | Description |
| --- | --- |
| `name` | Stable process id (same string passed to `make` / `Service`). |
| `effect` | Driver — fork once per process lifecycle in this runtime (or let `ProcessGroup` fork it). |
| `runImmediately()` | One tracked execution; does **not** require schedule armed. |
| `getStatus(range?)` | Runtime snapshot; uses `ProcessStore` when available. |

**Run driver (scoped):**

```typescript
const program = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(heartbeat.effect);
  // ...
  yield* Fiber.interrupt(fiber);
}).pipe(Effect.scoped);
```

**Run:** `pnpm run example:form:process-make-minimal`

**One shot:**

```typescript
yield* heartbeat.runImmediately();
```

**Run:** `pnpm run example:form:process-run-immediately`

---

## Types and typing notes

| Symbol | Meaning |
| --- | --- |
| `Process<R>` | Handle; `R` is what **you** must still provide at fork when layers are **not** inlined on `make`. |
| `ProcessSupervisorRequirements<C>` | Inferred env for `process.effect` / `runImmediately()` from a config object `C`. |
| `ProcessDefinition<Id, R>` | `{ id, kind: "process", process }` — produced by `Process.Service` for groups |
| `ProcessMakeOptions<E, R>` | Config second argument to `make` / `Service` |

When `polling` or schedule layers are passed on `make`, they are merged into `process.effect`, so fork-time `R` typically excludes `Polling` and `ProcessSchedule` tags.

---

## Related tools (same package)

| Tool | How it relates to `Process` |
| --- | --- |
| **`Polling`** | Cadence between repeats (`spaced`, `accelerating`, …). |
| **`ProcessSchedule`** | Armed/disarmed windows, live `set` / `add`. |
| **`ProcessStore`** | Execution rows + lifecycle events (`ProcessStore.layer` at app root). |
| **`ProcessGroup`** | Owns fibers, `start` / `stop`, typed `process(Entry)` / `runImmediately(Entry)`; entries are `Process.Service` classes or `Process.make` definitions in a tuple. |
| **`ControlService`** | Localhost HTTP JSON over a running group. |
| **`ProcessManager`** | Typed remote client; see process-group forms. |

**Next guides (planned):** `QueueResource`, `ProcessGroup`, `ProcessManager` — same layout (paragraph → forms → config → types → commands).

---

## File map

| Path | Role |
| --- | --- |
| `src/Process.ts` | `Process.make`, `Service`, `provide*`, driver implementation |
| `examples/forms/process/` | Minimal runnable forms for this guide |
| `examples/forms/polling/` | Polling + schedule + process interaction |
| `docs/rewrite/02-process.md` | Narrative “book” chapter |
| `docs/PROCESS-API.md` | Spec-style API reference |
