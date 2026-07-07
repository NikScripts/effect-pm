# Process, polling, and schedule — API reference

This document complements the [README](../README.md) with a concise **spec-style** overview of the effect-first process engine (`Process.make`, `Polling`, the internal schedule primitive, disarmed idle policy). The **`Process`** module surfaces this stack as a location-transparent `Resource` — `Process.Tag` (a managed process) and `Process.Schedule` (a reusable schedule resource) — see [guides/toolkit-by-example.md](./guides/toolkit-by-example.md).

---

## Mental model

| Piece | Role |
|--------|------|
| **`Process.make`** | Builds `process.effect`: a long-lived **schedule driver** forked when the process starts. Each schedule entry can spawn one run instance. |
| **Schedule primitive** (internal) | Stores run windows (`startAt`, optional `stopAt`, optional `id`) and notifies the driver when entries change. Surfaced publicly via `Process.scheduleInMemory` / `Process.scheduleDefine` and the `Process.Schedule` resource. |
| **`Polling`** | **Cadence** between repeats inside a running instance (`awaitNextTick` → user `effect` → `afterTick`). |
| **Storage facets** | Optional analytics: execution rows + lifecycle events via `ProcessStorage` / durable adapters. |
| **`Process.Tag`** | The toolkit wrapper: this stack as a location-transparent `Resource` (lifecycle + observability + schedule control). |

**`start` / `runImmediately`** drive the schedule. Schedule entries control whether instances continue repeating; `stop` / interrupt tears down the driver scope.

---

## `Process.make` / `Process.provide*`

### `Process.make(id, config)`

- **`id`** — stable process id (CLI, HTTP, `entityId` in store; exposed as `process.name` on the handle).
- **`config`** — `ProcessMakeOptions<E, R>` (no `name` field).

### `ProcessMakeOptions<E, R>`

| Field | Required | Description |
|--------|----------|-------------|
| `effect` | yes | `Effect<void, E, R>` — one **tick** body; failures logged + recorded when storage facets are provided. |
| `polling` | no | `Layer.Layer<PollingService, never, never>` — repeat cadence inside an instance. Omit and provide at fork time. |
| `schedule` | no | Either a schedule initializer (`({ set, add, clear }) => Effect`) or a schedule layer (`Process.scheduleInMemory(…)` / `Process.scheduleDefine(…)`). When omitted, defaults to an **always-armed** schedule. Use `Process.scheduleInMemory()` (no argument) for an empty store (disarmed until mutation). |
| `scheduleLayer` | no | Explicit schedule service layer; takes precedence over `schedule`. When both are omitted, an **always-armed** schedule is used. |

### `Process.make` overloads

- **`Process.make(id, effect)`** — repeat body only.
- **`Process.make(id, effect, polling)`** / **`Process.make(id, effect, schedule)`** — one layer; order between polling and schedule does not matter when both are passed.
- **`Process.make(id, effect, polling, schedule)`** — both layers (either order).
- **`Process.make(id, config)`** — `ProcessMakeOptions` (initializer, `scheduleLayer`, etc.).

`Process.Service` exposes the same overloads.

### Handle shape `Process<R>`

| Member | Type (conceptually) | Notes |
|--------|---------------------|--------|
| `name` | `string` | |
| `type` | `"managed"` | |
| `effect` | `Effect<void, never, R \| storage facets>` | Schedule-driven runtime. If `polling` / schedule layers are passed on `Process.make`, those layers are merged into `process.effect`. |
| `getStatus(range?)` | `Effect<ProcessDetails, never, storage facets>` | Execution stats + mirror of last gate/cadence hints. |
| `runImmediately()` | `Effect<void, never, R \| storage facets>` | One tracked tick **even when disarmed** (separate from supervisor loop). |

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

## Schedule surface (`Process.Schedule` / schedule constructors)

The schedule primitive is internal; its public face is these constructors (for `make`'s
`scheduleLayer` and the inline `Process.schedule([…])` combinator) plus the `Process.Schedule`
resource.

| Constructor | Behavior |
|---------|----------|
| **`Process.scheduleInMemory(entries?)`** | In-memory mutable schedule layer (empty when called with no argument). |
| **`Process.at(startAt)` / `at(id, startAt)`** | One-shot window entry (no `stopAt`); `id` optional. |
| **`Process.window(startAt, stopAt)` / `window(id, startAt, stopAt)`** | Bounded run window; `id` optional. |
| **`Process.scheduleDefine((api) => [...])`** | Compositional layer builder using `at`, `window`, `fromStarts`, `all`. |
| **`Process.Schedule<Self>()(id)`** + **`Process.scheduleLayer` / `scheduleServe`** | A reusable schedule as a first-class `Resource` (CRUD + `reconcile` + `changes` stream + RPC), gate processes with `Process.schedule(Schedule)`. |

### Schedule service (`Process.ScheduleService`)

The shape behind a schedule layer. The inline `schedule` verb group on a scheduled `Process.Tag`
exposes the reactive-read/CRUD subset (`entries` / `set` / `add` / `clear`); a `Process.Schedule`
resource additionally exposes `get` / `has` / `upsert` / `remove` / `removeMany`.

| Member | Returns |
|--------|---------|
| `entries` | `Effect<ReadonlyArray<ProcessScheduleEntry>>` (on the process/`Schedule` service, a reactive `ref`: `entries.get` / `entries.changes`) |
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

## `ProcessStore`, `ProcessStorage`, and `RuntimeStorage`

`ProcessStore` is the public builder used by storage facets
(`ProcessStore.Service`, `ProcessStore.record`, `ProcessStore.read`).
Applications do not `yield* ProcessStore`.

`ProcessStorage` is the combined built-in storage layer host. Use
`ProcessStorage.layer` for in-memory development/tests, or
`@nikscripts/effect-pm/storage/sqlite`'s `layerProcessStore({ filename })` for
durable local storage. Both provide the same per-domain facets.

`RuntimeStorage` is the generic row storage port underneath those facets. Storage
adapters persist normalized `RuntimeRecord` rows; facets map domain operations
onto those rows and expose domain reads.

Dependency direction:

```text
runtime module -> store facet -> RuntimeStorage -> memory / SQLite / custom
```

Read through the facet that owns the domain:

```typescript
import { Effect } from "effect";
import { ProcessStorage } from "@nikscripts/effect-pm";
import { RunResourceStore } from "@nikscripts/effect-pm/store/RunResource";

const program = Effect.gen(function* () {
  const runs = yield* RunResourceStore;
  const facts = yield* runs.facts({ resourceId: "examples/Gate" });
  yield* Effect.log(`run-resource facts: ${String(facts.length)}`);
});

void Effect.runPromise(program.pipe(Effect.provide(ProcessStorage.layer)));
```

### `Process.store` (built-in execution contract)

On **`Process.layer`** / **`serve`** / **`serveRemote`**, the engine auto-appends terminal runs to
**`Process.store(tag)`** when the app provides **`StoreScopeBridgeTag`** (via `Store.Service.layerMemory`
at the root). Register the tag on an app store:

```typescript
import * as Store from "@nikscripts/effect-pm/Store";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(MyProcess),
) {}

Process.layer(MyProcess, { effect, polling }).pipe(Layer.provide(AppStore.layerMemory));
```

Legacy **`ProcessExecutionStore`** is not written by the Process engine. Query execution events via
`yield* MyProcess.store` → `events()`.

The removed monolith service (`yield* ProcessStore`, `ProcessStore.events`,
`ProcessStore.file`, `@nikscripts/effect-pm/storage/file`) is intentionally not
documented as a compatibility path.

---

## `RunResourceStore` (RunResource facts/state)

> The legacy generic `ProcessStoreRuntime` facet and its `RuntimeFact` /
> `RuntimeRef` / `RuntimeStateChange` / `RuntimeStateBase` vocabulary,
> together with the previous `FactEnvelope` plumbing module, have been
> removed. Each storage facet — `RunResourceStore`,
> `QueueResourceStore`, … — now owns its own per-domain facet
> with concrete typed shapes and its own `RuntimeRecord` codec.

| Member | Role |
|--------|------|
| `RunResourceRef` | Stable `{ kind: "@nikscripts/effect-pm/RunResource", id }` identity for a RunResource. |
| `RunResourceState` | Live counters for waiting, in-flight, completed, failed, interrupted, and total duration. |
| `RunResourceStateChange` | Transition record with previous/current `RunResourceState`. |
| `RunResourceRunStartedFact` / `RunResourceRunCompletedFact` / `RunResourceRunFailedFact` | Concrete per-event payload types. |
| `RunResourceFact` | Union of the three concrete fact types. |
| `RunResourceStore` | Storage facet for RunResource facts and state changes (replaces the removed `ProcessStoreRuntime` and `RuntimeObserver`). |
| `RunResourceStore.Type` / `.EmitType` | Type accessors merged via declaration namespace — full service shape / record-section emit shape. Use to type custom `Layer.succeed` / `provideService` mocks. |
| `RunResourceStore.recordRunStarted(fact)` | Static optional emitter — silent no-op when the facet is absent; persistent write when present. Storage failures surface unless the caller explicitly pipes through `ProcessStore.catchErrorAndLog(...)`. |
| `RunResourceStore.recordRunCompleted(fact)` / `recordRunFailed(fact)` | Same failure semantics for the other lifecycle facts. |
| `RunResourceStore.recordStateChange(change)` | Static optional emitter for state transitions; same failure semantics. |
| `RunResourceStore.recordFactBatch(facts)` / `recordStateChangeBatch(changes)` | Batched optional emitters. |
| `RunResourceStore.layerRuntimeStorage` / `.layer` | Facet over injected `RuntimeStorage` (or in-memory `layer`). |
| `(yield* RunResourceStore).facts({ resourceId, runId?, types? })` | Per-domain projection over persisted `run-resource.fact.recorded` events. |
| `(yield* RunResourceStore).stateHistory({ resourceId })` | Per-domain projection over persisted `run-resource.state.changed` events. |
| `(yield* RunResourceStore).latestState(resourceId)` | Latest persisted `RunResourceState` snapshot for a resource. |
| `(yield* RunResourceStore).runs(resourceId)` | Paired started + ended (completed / failed) history per run. |
| `(yield* RunResourceStore).byRun(runId)` | All facts for one specific run, ordered. |

`RunResource` publishes `run-resource.run.started`,
`run-resource.run.completed`, and `run-resource.run.failed` facts plus
`RunResourceState` transitions for waiting, started, completed, failed, and
interrupted runs through `RunResourceStore.recordRunStarted` /
`recordRunCompleted` / `recordRunFailed` / `recordStateChange`. Observation
is optional: when no `RunResourceStore` service is in the
environment, the static emitters no-op and the gated effect behavior is
unchanged.

When `RunResourceStore.layerRuntimeStorage` (or the full-stack
`ProcessStorage.layerRuntimeStorage` / `layerProcessStore` from
`@nikscripts/effect-pm/storage/sqlite`) is composed, facts and state changes
are persisted as `run-resource.fact.recorded` / `run-resource.state.changed`
analytics events. The same engine tap writes to **`RunResource.store(tag)`**
handles when an app **`Store.Service`** registers the gate scope. `LogStore`
covers structured log history; capture/relay uses `@nikscripts/effect-pm/Logs`.

For live in-process observation (no durability), read toolkit handle
**`Subscribable`** views (`status`, `waiting`, `inFlight`, …) or subscribe via
`.changes` — see `examples/forms/resource/run-resource-runtime-observer.ts`.
Custom **`RunResourceStore.Type`** services via `Effect.provideService` /
`Layer.succeed` remain supported for fan-out mocks. A planned
`RunResourceStore.live(resourceId): Stream<...>` projection will offer a
durable subscription stream.

---

## Runnable examples in this repo

Examples are split into **forms** (one API shape) and **scenarios** (compositions). See [examples/README.md](../examples/README.md).

| File | Focus |
|------|--------|
| [examples/forms/schedule/](../examples/forms/schedule/) | Schedule entries (`at`, `window`, `define`) and control surfaces. |
| [examples/forms/polling/](../examples/forms/polling/) | **`TestClock`**: accelerating polling, `resetCadence`, `peekCadence`, delayed start. |
| [examples/scenarios/schedule-sync-from-external-db.ts](../examples/scenarios/schedule-sync-from-external-db.ts) | Simulated DB-sync pattern. |
| [examples/forms/resource/](../examples/forms/resource/) | `RunResource`, `HttpClientRunGate`, `HttpApiResource`. |

See [examples/README.md](../examples/README.md) for **`pnpm run example:*`** commands and a guided reading order.

Run the patterns demo:

```bash
pnpm run example:process-supervisor-patterns
# or
npx tsx examples/forms/polling/polling-accelerating.ts
```
