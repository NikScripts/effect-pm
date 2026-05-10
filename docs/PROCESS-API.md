# Process, polling, and schedule — API reference

This document complements the [README](../README.md) with a concise **spec-style** overview of the v0.7 **effect-first** process stack (`Process`, `Polling`, `ProcessSchedule`, disarmed idle policy, and `ProcessGroup` lifecycle). For **when schedules run vs `startProcess`**, **API-driven gates**, and **disarm vs `stopProcess`**, see [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md). For migration from older `Process.make({ crons })`, see [MIGRATION_0.7.0-process-v2.md](../MIGRATION_0.7.0-process-v2.md). For **npm publish** steps from `0.6.0-beta.2` → `0.7.0-beta.0`, see [MIGRATION_0.6-beta.2-to-0.7-beta.0.md](./MIGRATION_0.6-beta.2-to-0.7-beta.0.md).

---

## Mental model

| Piece | Role |
|--------|------|
| **`Process`** | Builds `process.effect`: a long-lived **schedule driver** forked by `ProcessGroup`. Each schedule entry can spawn one run instance. |
| **`ProcessSchedule`** | Stores run windows (`startAt`, optional `stopAt`, optional `id`) and notifies the driver when entries change. |
| **`Polling`** | **Cadence** between repeats inside a running instance (`awaitNextTick` → user `effect` → `afterTick`). |
| **`ProcessStore`** | Optional analytics: execution rows + lifecycle events. |
| **`ProcessGroup`** | Owns scopes, fibers, `startProcess` / `stopProcess`, control HTTP/CLI. |

**One `startProcess` (or `startAll`)** attaches the schedule driver. Schedule entries control whether instances continue repeating; `stop` / interrupt tears down the driver scope.

---

## `Process.make` / `Process.provide*`

### `ProcessMakeConfig<E, R>`

| Field | Required | Description |
|--------|----------|-------------|
| `name` | yes | Stable id (CLI, HTTP, `entityId` in store). |
| `effect` | yes | `Effect<void, E, R>` — one **tick** body; failures logged + recorded when `ProcessStore` is provided. |
| `polling` | no | `Layer.Layer<PollingService, never, never>` — repeat cadence inside an instance. Omit and provide at fork time. |
| `schedule` | no | Either a `ProcessScheduleInitializer` (`({ set, add, clear }) => Effect`) or a `Layer.Layer<ProcessScheduleService, never, never>`. |
| `scheduleLayer` | no | Explicit schedule service layer. Defaults to `ProcessSchedule.inMemory()`. |

### Static helpers

- **`Process.make(config)`** — build handle + baked layers from config.
- **`Process.providePolling(base, layer)`** — set/replace polling layer on a config object.
- **`Process.provideSchedule(base, layer)`** — set/replace schedule layer.

### Handle shape `Process<R>`

| Member | Type (conceptually) | Notes |
|--------|---------------------|--------|
| `name` | `string` | |
| `type` | `"managed"` | |
| `effect` | `Effect<void, never, R \| ProcessStore>` | Schedule-driven runtime. If `polling` / schedule layers are passed on `Process.make`, those layers are merged into `process.effect`. |
| `getStatus(range?)` | `Effect<ProcessDetails, never, ProcessStore>` | Execution stats + mirror of last gate/cadence hints. |
| `runImmediately()` | `Effect<void, never, R \| ProcessStore>` | One tracked tick **even when disarmed** (separate from supervisor loop). |

### `ProcessDetails`

Includes `lastRun`, `executions`, `firstStartup`, `armed`, `nextScheduleTransition`, `nextPollCadence`, `activeInstances`, `nextTriggerRun` (best-effort mirrors).

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
| **`ProcessSchedule.inMemory(entries?)`** | In-memory mutable schedule storage. |
| **`ProcessSchedule.at(startAt)` / `at(id, startAt)`** | One-shot entry (no `stopAt`). |
| **`ProcessSchedule.window(startAt, stopAt)` / `window(id, startAt, stopAt)`** | Bounded run window. |
| **`ProcessSchedule.fromStarts([...])`** | Convenience constructor for many `at(...)` entries. |
| **`ProcessSchedule.define((api) => [...])`** | Compositional layer builder using `at`, `window`, `fromStarts`, `all`. |

### `ProcessScheduleService`

| Member | Returns |
|--------|---------|
| `entries` | `Effect<ReadonlyArray<ProcessScheduleEntry>>` |
| `set(entries)` | `Effect<void>` |
| `add(entry)` | `Effect<void>` |
| `clear` | `Effect<void>` |
| `changed` | `Effect<void>` (completes when any mutation occurs) |

`Process.currentScheduleId` exposes the optional entry id to the currently running instance.
`Process.scheduleControls` exposes the same schedule controls available in the `schedule` initializer (`entries`, `set`, `add`, `clear`) from inside the running process effect.

---

## Disarmed idle policy helpers

These exports remain for custom schedule implementations and migration tooling; the schedule-driven runtime no longer relies on a disarmed supervisor polling loop.

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

Stopping interrupts the schedule driver fiber and child instances; removing/closing entries does not stop the driver — active instances exit naturally on their stop checks.

---

## Runnable examples in this repo

| File | Focus |
|------|--------|
| [examples/example.ts](../examples/example.ts) | Full `ProcessGroup` + queues + control `serve` + `awaitShutdown` + root `Layer.mergeAll`. |
| [examples/process-supervisor-patterns.ts](../examples/process-supervisor-patterns.ts) | **`TestClock`**: accelerating polling + `resetCadence`, with schedule windows. |
| [examples/schedule-control-surfaces.ts](../examples/schedule-control-surfaces.ts) | Schedule control surfaces: initializer controls, in-effect controls, and external service-driven controls. |
| [examples/process-game-window-with-group.ts](../examples/process-game-window-with-group.ts) | **`ProcessGroup.startProcess`** + schedule ids with `Process.currentScheduleId`; narrative [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md). |
| [examples/sports-polling-accelerating.ts](../examples/sports-polling-accelerating.ts) | **Three demos** (basic spaced → minimal accel+**`resetCadence`** → verbose **`peekCadence`**); [mocks/sports-score-feed.mock.ts](../examples/mocks/sports-score-feed.mock.ts), [mocks/demo-harness.mock.ts](../examples/mocks/demo-harness.mock.ts). |
| [examples/run-resource.ts](../examples/run-resource.ts) | `RunResource` throttle + concurrency. |
| [examples/http-client-run-gate.ts](../examples/http-client-run-gate.ts) | `HttpClientRunGate` on a fetch `HttpClient`. |
| [examples/http-api-resource.ts](../examples/http-api-resource.ts) | `HttpApiResource.make` tag + layer. |
| [examples/http-api-resource-layer-effect.ts](../examples/http-api-resource-layer-effect.ts) | `HttpApiResource.layerEffect` + sidecar service. |

See [examples/README.md](../examples/README.md) for **`pnpm run example:*`** commands and a guided reading order.

Run the patterns demo:

```bash
pnpm run example:process-supervisor-patterns
# or
npx tsx examples/process-supervisor-patterns.ts
```
