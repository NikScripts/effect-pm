# Process, polling, and schedule — API reference

This document complements the [README](../README.md) with a concise **spec-style** overview of the v0.7 **effect-first** process stack (`Process`, `Polling`, `ProcessSchedule`, disarmed idle policy, and `ProcessGroup` lifecycle). For migration from older `Process.make({ crons })`, see [MIGRATION_0.7.0-process-v2.md](../MIGRATION_0.7.0-process-v2.md). For **npm publish** steps from `0.6.0-beta.2` → `0.7.0-beta.0`, see [MIGRATION_0.6-beta.2-to-0.7-beta.0.md](./MIGRATION_0.6-beta.2-to-0.7-beta.0.md).

---

## Mental model

| Piece | Role |
|--------|------|
| **`Process`** | Builds `process.effect`: a **single-fiber supervisor** forked by `ProcessGroup`. |
| **`ProcessSchedule`** | **Gate**: armed → scheduled ticks allowed; disarmed → supervisor **waits** (no ticks). |
| **`Polling`** | **Cadence** while armed: time between tick **attempts** (`awaitNextTick` → user `effect` → `afterTick`). |
| **`ProcessStore`** | Optional analytics: execution rows + lifecycle events. |
| **`ProcessGroup`** | Owns scopes, fibers, `startProcess` / `stopProcess`, control HTTP/CLI. |

**One `startProcess` (or `startAll`)** keeps the supervisor fiber attached. Arm/disarm toggles **whether ticks run**, not whether the fiber exists (until `stop` / interrupt).

---

## `Process.make` / `Process.provide*`

### `ProcessMakeConfig<E, R>`

| Field | Required | Description |
|--------|----------|-------------|
| `name` | yes | Stable id (CLI, HTTP, `entityId` in store). |
| `effect` | yes | `Effect<void, E, R>` — one **tick** body; failures logged + recorded when `ProcessStore` is provided. |
| `polling` | no | `Layer.Layer<PollingService, never, never>` — often `Polling.spaced(d)` or `Polling.acceleratingScoped(…)`. Omit and provide at fork time. |
| `schedule` | no | `Layer.Layer<ProcessScheduleService, never, never>` — `alwaysArmed`, `cronMatch`, `fromArmedRef`, or custom. Omit and provide at fork time. |
| `schedulePollWhileDisarmed` | no | When disarmed and `status.nextScheduleTransition` is **none**, sleep this long between gate re-checks (default **5s**, floored at **100ms**). |

### Static helpers

- **`Process.make(config)`** — build handle + baked layers from config.
- **`Process.providePolling(base, layer)`** — set/replace polling layer on a config object.
- **`Process.provideSchedule(base, layer)`** — set/replace schedule layer.

### Handle shape `Process<R>`

| Member | Type (conceptually) | Notes |
|--------|---------------------|--------|
| `name` | `string` | |
| `type` | `"managed"` | |
| `effect` | `Effect<void, never, R \| ProcessStore>` | Supervisor; requires merged `Polling` + `ProcessSchedule` + `ProcessStore` at runtime unless inlined on `make`. |
| `getStatus(range?)` | `Effect<ProcessDetails, never, ProcessStore>` | Execution stats + mirror of last gate/cadence hints. |
| `runImmediately()` | `Effect<void, never, R \| ProcessStore>` | One tracked tick **even when disarmed** (separate from supervisor loop). |

### `ProcessDetails`

Includes `lastRun`, `executions`, `firstStartup`, `armed`, `nextScheduleTransition`, `nextPollCadence` (mirrors are best-effort).

---

## `Polling` (`PollingService`)

Built-in factories:

| Factory | Behavior |
|---------|----------|
| **`Polling.spaced(duration)`** | Fixed delay between ticks; `resetCadence` = `requestWake`. |
| **`Polling.acceleratingScoped(initial)`** | Allocates refs and returns a layer: delay **shortens** with each tick (`afterTick` increments iteration); **`resetCadence`** sets iteration **0** + **wake** (back toward initial long spacing). |
| **`Polling.accelerating({ config, iteration, excitement })`** | Same curve; you own the `Ref`s (e.g. wire HTTP handlers to tweak `excitement` or `config`). |

### `PollingService` methods

| Method | Purpose |
|--------|---------|
| `awaitNextTick` | Wait until next poll (races internal wake). |
| `requestWake` | End current wait early; cadence recomputes. |
| `resetCadence` | **Accelerating:** `n → 0` + wake. **Spaced:** same as `requestWake`. |
| `afterTick` | Run after each tick (accelerating: bumps iteration). |
| `peekCadence` | `Effect<Option<Duration>>` — hint for `getStatus`. |

### `AcceleratingPollConfig`

- `minIntervalMs` — floor delay (ms).
- `maxIntervalMs` — delay at iteration **0** (ms).
- `decayK` — steepness of `delay(n) = min + (max-min) * e^(-k * n * excitement)`.

---

## `ProcessSchedule` (`ProcessScheduleService`)

| Factory | Behavior |
|---------|----------|
| **`ProcessSchedule.alwaysArmed`** | Gate always true; no transition hint. |
| **`ProcessSchedule.cronMatch({ crons, sampleInterval? })`** | Background fiber updates armed + `nextScheduleTransition` on **`Clock`** (default sample **1s**). |
| **`ProcessSchedule.fromArmedRef({ armed, nextScheduleTransition? })`** | Gate + optional transition from refs (tests, feature flags). |

### `ProcessScheduleService`

| Member | Returns |
|--------|---------|
| `armed` | `Effect<boolean>` |
| `status` | `Effect<{ armed, nextScheduleTransition: Option<Date> }>` |

While **disarmed**, `Process` uses `nextScheduleTransition` when **some**, to choose idle sleep (clamped); when **none**, uses `schedulePollWhileDisarmed` / default.

---

## Disarmed idle policy (exported helpers)

Useful for **custom schedule layers** and **unit tests** so behavior matches `Process`:

| Export | Role |
|--------|------|
| `computeDisarmedIdleSleep({ now, nextScheduleTransition, fallbackPoll })` | Pure sleep duration before next `status` read while disarmed. |
| `resolveDisarmedFallbackPoll(configured?)` | Applies default **5s** and **100ms** minimum. |
| `DEFAULT_SCHEDULE_POLL_WHILE_DISARMED`, `MIN_SCHEDULE_POLL_WHILE_DISARMED` | Constants. |
| `DISARMED_HINT_SLEEP_MIN`, `DISARMED_HINT_SLEEP_MAX` | Hint clamp (1s … 5min). |

---

## `ProcessGroup` (process lifecycle)

Typical control (requires the group’s `R` + `ProcessStore` where applicable):

- `startProcess(name)` / `stopProcess(name)` / `restartProcess(name)`
- `startAll()` / `stopAll()`
- `runProcessImmediately(name)` — tracked run without requiring armed schedule
- `getProcessStatus` / `getAllProcessStatus` / `listProcesses`

Stopping interrupts the supervisor fiber; **disarming** does not stop the fiber — it only stops **scheduled** ticks until armed again.

---

## Runnable examples in this repo

| File | Focus |
|------|--------|
| [examples/example.ts](../examples/example.ts) | Full `ProcessGroup` + queues + CLI + `Polling.spaced` + `alwaysArmed`. |
| [examples/process-supervisor-patterns.ts](../examples/process-supervisor-patterns.ts) | **`TestClock`**: accelerating polling + `resetCadence`, `schedulePollWhileDisarmed`, `fromArmedRef`. |

Run the patterns demo:

```bash
npx tsx examples/process-supervisor-patterns.ts
```
