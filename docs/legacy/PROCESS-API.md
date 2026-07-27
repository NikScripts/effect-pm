# Daemon, polling, and schedule — API reference

This document complements the [README](../README.md) with a concise **spec-style** overview of the effect-first process engine (`Daemon.make`, `Polling`, the internal schedule primitive, disarmed idle policy). The **`Daemon`** module surfaces this stack as a location-transparent `Hyperlink` — `Daemon.Tag` (a managed process) and `Daemon.Schedule` (a reusable schedule resource) — see [guides/toolkit-by-example.md](./guides/toolkit-by-example.md).

---

## Mental model

| Piece | Role |
|--------|------|
| **`Daemon.make`** | Builds `process.effect`: a long-lived **schedule driver** forked when the process starts. Each schedule entry can spawn one run instance. **Does not** auto-append execution store rows. |
| **Schedule primitive** (internal) | Stores run windows (`startAt`, optional `stopAt`, optional `id`) and notifies the driver when entries change. Surfaced publicly via `Daemon.scheduleInMemory` / `Daemon.scheduleDefine` and the `Daemon.Schedule` resource. |
| **`Polling`** | **Cadence** between repeats inside a running instance (`awaitNextTick` → user `effect` → `afterTick`). |
| **`Daemon.Tag` + toolkit layers** | Location-transparent `Hyperlink` (lifecycle + observation + schedule). **`Daemon.layer` / `serve` / `serveRemote`** auto-append terminal runs to **`Daemon.store(tag)`** and merge a default in-memory **`Store.Storage`**. |
| **Legacy `DaemonStorage` facets** | Optional analytics rows (`RuntimeStorage`) — queue entries, lifecycle, logs. **Not** process execution history (that is **`Daemon.store`** on the EventJournal `Store`). |

**`start` / `run`** drive supervision and manual execution. Schedule entries control whether instances continue repeating; `stop` / interrupt tears down the driver scope.

---

## `Daemon.make` / `Daemon.provide*`

### `Daemon.make(id, config)`

- **`id`** — stable process id (CLI, HTTP, `entityId` in store; exposed as `process.name` on the handle).
- **`config`** — `ProcessMakeOptions<E, R>` (no `name` field).

### `ProcessMakeOptions<E, R>`

| Field | Required | Description |
|--------|----------|-------------|
| `effect` | yes | `Effect<void, E, R>` — one **tick** body; failures logged + recorded when storage facets are provided. |
| `polling` | no | `Layer.Layer<PollingService, never, never>` — repeat cadence inside an instance. Omit and provide at fork time. |
| `schedule` | no | Either a schedule initializer (`({ set, add, clear }) => Effect`) or a schedule layer (`Daemon.scheduleInMemory(…)` / `Daemon.scheduleDefine(…)`). When omitted, defaults to an **always-armed** schedule. Use `Daemon.scheduleInMemory()` (no argument) for an empty store (disarmed until mutation). |
| `scheduleLayer` | no | Explicit schedule service layer; takes precedence over `schedule`. When both are omitted, an **always-armed** schedule is used. |

**Persistence:** `Daemon.make` does **not** wire execution store appends. Use **`Daemon.layer`** /
**`serve`** / **`serveRemote`** for automatic terminal-run history, or **`Daemon.store(tag)`** and
`store.record` for manual writes.

### `Daemon.make` overloads

- **`Daemon.make(id, effect)`** — repeat body only.
- **`Daemon.make(id, effect, polling)`** / **`Daemon.make(id, effect, schedule)`** — one layer; order between polling and schedule does not matter when both are passed.
- **`Daemon.make(id, effect, polling, schedule)`** — both layers (either order).
- **`Daemon.make(id, config)`** — `ProcessMakeOptions` (initializer, `scheduleLayer`, etc.).

`Daemon.Service` exposes the same overloads.

### Handle shape `Daemon<R>`

| Member | Type (conceptually) | Notes |
|--------|---------------------|--------|
| `name` | `string` | |
| `type` | `"managed"` | |
| `effect` | `Effect<void, never, R \| storage facets>` | Schedule-driven runtime. If `polling` / schedule layers are passed on `Daemon.make`, those layers are merged into `process.effect`. |
| `getStatus(range?)` | `Effect<ProcessDetails, never, storage facets>` | Execution stats + mirror of last gate/cadence hints. |
| `run()` | `Effect<A, E, R \| storage facets>` | One tracked tick **even when disarmed** (typed `success`/`error` when stamped on tag). Toolkit: `yield* Tag.run`. |

### `ProcessDetails`

Includes `lastRun`, `executions`, `firstStartup`, `armed`, `nextScheduleTransition`, `nextPollCadence`, `activeInstances`, `nextTriggerRun` (best-effort mirrors).

---

## `Polling` (`PollingService`)

Built-in factories:

| Factory | Behavior |
|---------|----------|
| **`Polling.spaced(duration)`** | Fixed delay between ticks; `resetCadence` = `requestWake`. |
| **`Polling.accelerating({ fastest, slowest, decay?, excitement? })`** | Delay **shortens** with each tick (`afterTick` increments iteration); **`resetCadence`** sets iteration **0** + **wake** (back toward initial long spacing). |
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

## Schedule surface (`Daemon.Schedule` / schedule constructors)

The schedule primitive is internal; its public face is these constructors (for `make`'s
`scheduleLayer` and the inline `Daemon.schedule([…])` combinator) plus the `Daemon.Schedule`
resource.

| Constructor | Behavior |
|---------|----------|
| **`Daemon.scheduleInMemory(entries?)`** | In-memory mutable schedule layer (empty when called with no argument). |
| **`Daemon.at(startAt)` / `at(id, startAt)`** | One-shot window entry (no `stopAt`); `id` optional. |
| **`Daemon.window(startAt, stopAt)` / `window(id, startAt, stopAt)`** | Bounded run window; `id` optional. |
| **`Daemon.scheduleDefine((api) => [...])`** | Compositional layer builder using `at`, `window`, `fromStarts`, `all`. |
| **`Daemon.Schedule<Self>()(id)`** + **`Daemon.scheduleLayer` / `scheduleServe`** | A reusable schedule as a first-class `Hyperlink` (CRUD + `reconcile` + `changes` stream + RPC), gate processes with `Daemon.schedule(Schedule)`. |

### Schedule service (`Daemon.ScheduleService`)

The shape behind a schedule layer. The inline `schedule` verb group on a scheduled `Daemon.Tag`
exposes the reactive-read/CRUD subset (`entries` / `set` / `add` / `clear`); a `Daemon.Schedule`
resource additionally exposes `get` / `has` / `upsert` / `remove` / `removeMany`.

| Member | Returns |
|--------|---------|
| `entries` | `Effect<ReadonlyArray<DaemonScheduleEntry>>` (on the process/`Schedule` service, a reactive `ref`: `entries.get` / `entries.changes`) |
| `set(entries)` | `Effect<void>` |
| `add(entry)` | `Effect<void>` |
| `clear` | `Effect<void>` |
| `changed` | `Effect<void>` (completes when any mutation occurs) |

`Daemon.currentScheduleId` exposes the optional entry id to the currently running instance.
`Daemon.scheduleControls` exposes the same schedule controls available in the `schedule` initializer (`entries`, `set`, `add`, `clear`) from inside the running process effect.

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

## Storage: two planes

| Plane | API | Backing | Daemon execution history? |
|-------|-----|---------|----------------------------|
| **Store (EventJournal)** | `Store.Service`, `Daemon.store(tag)` | `layerMemory` / SQLite `SqlEventJournal` | **Yes** — `Started` / `Completed` / `Failed` / `Interrupted` |
| **Legacy facets** | `DaemonStorage`, `src/store/*` facets | `RuntimeStorage` / `layerDaemonStore` | **No** — queue entries, lifecycle, logs only |

### `Daemon.store` (built-in execution contract)

**Registration** — one line on your app store:

```typescript
class AppStore extends Store.Service<AppStore>("@app/Store")(
  Daemon.store(MyProcess),
) {}
```

**Handle** — `yield* MyDaemon.store` exposes:

| Method | Role |
|--------|------|
| `record(event)` | Append one terminal execution row |
| `events({ limit? })` | Read rows newest-first (optional limit) |
| `hasPriorExecutions()` | Whether any row exists for this process |

**Auto-append** — only on **`Daemon.layer` / `serve` / `serveRemote`**. Those layers merge
**`Store.layerDefaultMemory`** so the engine always has **`Store.Storage`**. Override at the app root:

```typescript
Daemon.layer(MyProcess, { effect, polling }).pipe(
  Layer.provideMerge(AppStore.layerMemory),
);
```

**Wire rows** (PascalCase `_tag`):

| `_tag` | When | Notable fields |
|--------|------|----------------|
| `Started` | Tick began | Base timing fields + `isStartupRun` |
| `Completed` | Tick succeeded | Optional **`success`** iff tag stamps `success` |
| `Failed` | Tick failed (non-interrupt) | **`error`** — typed if tag stamps `error`, else `string` |
| `Interrupted` | Tick interrupted | Base timing fields only |

Shared base fields: `processId`, `scheduleKey`, `startedAt`, `completedAt`, `durationMs`, `isStartupRun`.

**`Failed.error` encoding (store path):** On terminal failure the engine calls `recordStoreFailed`
(`src/Daemon.ts`). When the tag stamps an `error` schema (`Daemon.Tag(…, { error })`), the persisted
value is the **typed** failure from the tick `Effect` (same schema). When the tag omits `error`, the
engine writes `String(cause)` per store-core §5. Journal codecs round-trip stamped schemas on append —
see `test/process-store-engine.test.ts` and `test/process-store-sqlite.test.ts`.

**RPC `run` slot:** Per-tag `buildProcessSpec` wires tag `success` / `error` onto the manual **`run`**
verb (`Hyperlink.effect` — inputless `Effect`, not `effectFn`). Remote `yield* Tag.run` returns typed
success and fails with typed `E` when the worker fails — store rows are still written on failure.
Lifecycle verbs (`start`, `stop`) are `effectFn` void commands; schedule mutations use `effectFn` with
payload. Per-invocation input on manual run is a future separate `effectFn` member, not payload on
`Hyperlink.effect`.

**Removed:** `ProcessExecutionStore` facet, `hyperlink-ts/store/ProcessExecution`,
`process.execution.completed` runtime facet. Do not import execution history from `DaemonStorage`.

### `DaemonStorage` and legacy facets (optional)

`DaemonStorage` composes built-in **RuntimeStorage** facets (queue rows, lifecycle, logs). It does
**not** replace **`Daemon.store`**. Use `DaemonStorage.layer` or `layerDaemonStore({ filename })`
when you need facet analytics; use **`Daemon.store`** + **`Store.Service`** for execution events.

### `Gate.store` (run facts / state history)

> The legacy **`GateStore`** DaemonStorage facet and `hyperlink-ts/store/Gate`
> subpath are removed. Run persistence goes through the app **Store bridge** only.

| Member | Role |
|--------|------|
| `Gate.store(tag)` | Registers built-in `fact` + `state` shapes on an app **`Store.Service`**. |
| `Store.layerDefaultMemory` | In-memory store bridge — merged by **`Gate.layer` / `serve` / `Service.layer`**; override via `Layer.provideMerge(AppStore.layerMemory)`. |
| `(yield* store).record(fact)` | Append a run lifecycle fact (`run-resource.run.started` / `.completed` / `.failed`). |
| `(yield* store).facts(payload?)` | Read persisted facts (optional `limit`, `runId`). |
| `(yield* store).recordStateChange(change)` | Append a gate state transition row. |
| `(yield* store).stateHistory(payload?)` | Read persisted state transitions. |

The gate engine writes automatically when **`Store.Storage`** is in context (via
**`Store.layerDefaultMemory`** or a real **`Store.Service`**). Writes use
**`Store.catchWriteErrors`** so storage failures do not fail gated work.

For live in-process observation (no durability), read toolkit handle
**`Subscribable`** views (`status`, `waiting`, `inFlight`, …) or subscribe via
`.changes` — see `examples/forms/hyperlink/gate-runtime-observer.ts`.

---

## Runnable examples in this repo

Examples are split into **forms** (one API shape) and **scenarios** (compositions). See [examples/README.md](../examples/README.md).

| File | Focus |
|------|--------|
| [examples/forms/schedule/](../examples/forms/schedule/) | Schedule entries (`at`, `window`, `define`) and control surfaces. |
| [examples/forms/polling/](../examples/forms/polling/) | **`TestClock`**: accelerating polling, `resetCadence`, `peekCadence`, delayed start. |
| [examples/scenarios/schedule-sync-from-external-db.ts](../examples/scenarios/schedule-sync-from-external-db.ts) | Simulated DB-sync pattern. |
| [examples/forms/hyperlink/](../examples/forms/hyperlink/) | `Gate`, `HttpClientRunGate`, `HttpApiClient`. |

See [examples/README.md](../examples/README.md) for **`pnpm run example:*`** commands and a guided reading order.

Run the patterns demo:

```bash
pnpm run example:process-supervisor-patterns
# or
npx tsx examples/forms/polling/polling-accelerating.ts
```
