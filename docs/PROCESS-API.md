# Process, polling, and schedule — API reference

This document complements the [README](../README.md) with a concise **spec-style** overview of the effect-first process stack (`Process`, `Polling`, `ProcessSchedule`, disarmed idle policy, and `ProcessGroup` lifecycle). For **when schedules run vs `ProcessGroup.start`**, **API-driven gates**, and **disarm vs `ProcessGroup.stop`**, see [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md).

---

## Mental model

| Piece | Role |
|--------|------|
| **`Process`** | Builds `process.effect`: a long-lived **schedule driver** forked by `ProcessGroup`. Each schedule entry can spawn one run instance. |
| **`ProcessSchedule`** | Stores run windows (`startAt`, optional `stopAt`, optional `id`) and notifies the driver when entries change. |
| **`Polling`** | **Cadence** between repeats inside a running instance (`awaitNextTick` → user `effect` → `afterTick`). |
| **`ProcessStore`** | Optional analytics: execution rows + lifecycle events. |
| **`ProcessGroup`** | Owns scopes, fibers, typed process/queue controls, group contracts, control HTTP/CLI. |
| **`ProcessManager`** | Typed remote client for a `ProcessGroup` contract. |

**One `start` (or `startAll`)** attaches the schedule driver. Schedule entries control whether instances continue repeating; `stop` / interrupt tears down the driver scope.

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

These exports remain for custom schedule implementations; the schedule-driven runtime no longer relies on a disarmed supervisor polling loop.

| Export | Role |
|--------|------|
| `computeDisarmedIdleSleep({ now, nextScheduleTransition, fallbackPoll })` | Pure sleep duration before next `status` read while disarmed. |
| `resolveDisarmedFallbackPoll(configured?)` | Applies default **5s** and **100ms** minimum. |
| `DEFAULT_SCHEDULE_POLL_WHILE_DISARMED`, `MIN_SCHEDULE_POLL_WHILE_DISARMED` | Constants. |
| `DISARMED_HINT_SLEEP_MIN`, `DISARMED_HINT_SLEEP_MAX` | Hint clamp (1s … 5min). |

---

## `ProcessGroup` (process lifecycle and group contracts)

Typical control (requires the group’s `R` + `ProcessStore` where applicable):

- `start(name)` / `stop(name)` / `restart(name)`
- `startAll()` / `stopAll()`
- `runImmediately(name)` — tracked run without requiring armed schedule
- `processStatus(name)` / `status`

Typed group construction also supports canonical runtime entries:

```typescript
const group = yield* ProcessGroup.make("@app/BillingGroup", [
  SyncBilling,
  EmailQueue,
] as const);

yield* group.process(SyncBilling).runImmediately;
yield* group.queue(EmailQueue).pause;
```

`ProcessGroup.Service` creates an injectable group class with `id`, `entries`,
`contract`, `make`, and `layer`. `ProcessGroup.remoteLayer(Group, Endpoint)`
provides that same service key from a remote `ProcessManager.Endpoint`, with
process controls plus queue `pause`, `resume`, `clear`, and `status`.

Remote queue `add`, `enqueue`, `prioritize`, and `defer` intentionally fail with
`UnsupportedRemoteControlError` until queue item schemas are represented in the
group contract.

Stopping interrupts the schedule driver fiber and child instances; removing/closing entries does not stop the driver — active instances exit naturally on their stop checks.

---

## `ProcessManager` (remote group client)

| Member | Role |
|--------|------|
| `ProcessManager.ConnectionRegistry.layer([Group], { [Group.id]: url })` | Provide registry-backed remote group URLs as an Effect layer. |
| `ProcessManager.connect(Group)` | Build a typed remote client by reading the group URL from `ProcessManagerConnectionRegistry`. |
| `ProcessManager.connect(Group, { baseUrl })` | Build a typed remote client from a group service/definition. |
| `ProcessManager.connect({ baseUrl, contract })` | Build from a raw contract for generated or contract-only clients. |
| `ProcessManager.Endpoint<Self>()(Group, { baseUrl })` | Injectable endpoint service that yields the remote manager. |
| `manager.verifyContract` | Fetches `GET /contract` and compares group id, version, process ids, queue ids, and control sets. |
| `manager.process(id)` | Remote process start/stop/restart/run/status controls. |
| `manager.queue(id)` | Remote queue pause/resume/clear/status controls. |

Registry-backed connections are the preferred shape for application wiring:

```typescript
const RemoteGroupsLive = ProcessManager.ConnectionRegistry.layer(
  [BillingGroup] as const,
  {
    [BillingGroup.id]: "http://127.0.0.1:32130",
  },
);

const program = Effect.gen(function* () {
  const billing = yield* ProcessManager.connect(BillingGroup);
  yield* billing.verifyContract;
  yield* billing.process(SyncBilling.id).runImmediately;
}).pipe(Effect.provide(RemoteGroupsLive));
```

This same registry is the planned foundation for
`ProcessManager.cli([BillingGroup, StripeGroup] as const)`, where the CLI can
derive valid group ids and command targets from the group tuple.

---

## Runnable examples in this repo

Examples are split into **forms** (one API shape) and **scenarios** (compositions). See [examples/README.md](../examples/README.md).

| File | Focus |
|------|--------|
| [examples/scenarios/full-process-group-with-queues-and-control-cli.ts](../examples/scenarios/full-process-group-with-queues-and-control-cli.ts) | Full `ProcessGroup` + queues + control `serve` + `awaitShutdown` + root `Layer.mergeAll`. |
| [examples/forms/schedule/](../examples/forms/schedule/) | Schedule entries (`at`, `window`, `define`) and control surfaces. |
| [examples/forms/polling/](../examples/forms/polling/) | **`TestClock`**: accelerating polling, `resetCadence`, `peekCadence`, delayed start. |
| [examples/scenarios/schedule-sync-from-external-db.ts](../examples/scenarios/schedule-sync-from-external-db.ts) | Simulated DB-sync pattern. |
| [examples/scenarios/game-window-polling-with-process-group.ts](../examples/scenarios/game-window-polling-with-process-group.ts) | **`ProcessGroup.start`** + schedule ids; [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md). |
| [examples/forms/process-group/](../examples/forms/process-group/) | Typed group entries, contracts, `ProcessManager.Endpoint`, and `ProcessGroup.remoteLayer`. |
| [examples/forms/resource/](../examples/forms/resource/) | `RunResource`, `HttpClientRunGate`, `HttpApiResource`. |

See [examples/README.md](../examples/README.md) for **`pnpm run example:*`** commands and a guided reading order.

Run the patterns demo:

```bash
pnpm run example:process-supervisor-patterns
# or
npx tsx examples/forms/polling/polling-accelerating.ts
```
