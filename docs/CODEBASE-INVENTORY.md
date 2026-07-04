# effect-pm — concept inventory

Flat catalog of **every teachable idea** in the package: what each thing is, every form it takes, every way to configure or wire it, and every control surface (in-process vs local HTTP vs remote HTTP). For doc planning and linearization — not a file tree.


---

## Cross-cutting (how pieces combine)

- **Effect `Layer`** — polling, schedule, queues, storage facets (`ProcessStoreRunResource`, `ProcessStoreLog`, `ProcessStoreQueueResource`, `ProcessStoreProcessLifecycle`, `ProcessStoreProcessExecution`), platform (`FileSystem`/`Path`, `HttpClient`) merged at app root; `Process.make` can inline polling/schedule into `process.effect` so fork-time `R` excludes those tags when merged.
- **`Effect.scoped`** — `QueueResource.make`, remote layers acquire/release with scope.
- **Storage optional** — when relevant facets are present in env, processes/queues/resources append analytics; when absent, behavior continues without failing.
- **Canonical ids** — slash-separated strings (`@scope/Segment/ServiceName`); CLI/remote accept normalized kebab suffix aliases; ambiguous suffixes error with candidate list.
- **Contract-first control** — each process/queue entry declares which controls exist; HTTP and CLI check locally before mutating; remote `verifyContract` compares local contract to `GET /contract`.
- **Three lifetimes to keep separate** — (1) group constructed, (2) process driver **started** (`start`/`startAll`), (3) schedule **armed** (entries cover “now”) vs instance **ticking** (polling between user `effect` runs).

---

## Polling

**What it is:** `Layer` providing **`PollingService`** (Context tag `Polling` / `PollingTag`). Answers: *how long between repeats of the user tick while a run instance is armed?* Does not decide *whether* the instance runs — the **schedule** does.

### Service contract (`PollingService`)

- **`overlap`** — `"serial"` | `"concurrent"` (all presets use **serial**: one tick at a time).
- **`awaitNextTick`** — wait until next poll (internally races sleep vs wake `Deferred`).
- **`requestWake`** — end current wait early; next delay recomputed on next `awaitNextTick`.
- **`resetCadence`** — preset-specific reset (see presets).
- **`afterTick`** — post-tick hook (accelerating presets bump iteration here).
- **`peekCadence`** — `Effect<Option<Duration>>` best-effort hint for status UIs / `Process.getStatus` mirrors.

### Preset forms (cadence curves)

| Preset | Delay behavior | `resetCadence` | `afterTick` | `peekCadence` |
|--------|----------------|----------------|-------------|---------------|
| **`Polling.spaced(interval)`** | Fixed `Duration` every tick | Same as `requestWake` (wake only) | no-op | fixed interval |
| **`Polling.jittered(interval, { jitter })`** | Fixed ± `jitter` fraction of base | same as spaced | no-op | base interval (not jittered value) |
| **`Polling.backoff({ initial, max, factor? })`** | Multiply delay each tick, cap at `max`; default `factor` 2 | reset delay to `initial` + wake | multiply current delay | current delay from ref |
| **`Polling.accelerating({ fastest, slowest, decay?, excitement? })`** | Exponential decay from `slowest` toward `fastest` as iteration rises | iteration → 0 + wake | increment iteration | delay for current iteration |
| **`Polling.acceleratingWithRefs({ config, iteration, excitement })`** | Same curve but **`Ref`**-backed config/iteration/excitement for live tuning from outside the tick | iteration ref → 0 + wake | increment iteration ref | read all refs |

### Custom form

- **`Layer.succeed(Polling, customPollingService)`** — full manual implementation of all `PollingService` fields.

### Ways to attach polling to a process

- **`Process.make(id, { polling: SomePollingLayer })`** or **`Process.make(id, effect, pollingLayer, …)`** — merged into `process.effect`; **`PollingTag` removed from process `R`** at fork time. Positional args accept **preset** layers only (`Polling.spaced`, `Polling.accelerating`, …); custom layers belong on the config object.
- **Omit `polling` on `Process.make`** — caller must provide `Polling` in environment when forking/running `process.effect` (same merge rules if provided at fork site).

### In-process control (during a running instance)

- **`yield* Polling`** then:
  - **`requestWake`** — skip remainder of current sleep.
  - **`resetCadence`** — spaced: wake; accelerating: reset iteration + wake; backoff: back to initial + wake.
  - **`afterTick`** — normally supervisor calls this; can call from tick if needed.
  - **`peekCadence`** — read hint without waiting.
- **External `Ref` mutation** — only with `acceleratingWithRefs` (excitement, config, iteration).

### Remote / HTTP / CLI


### Status / introspection

- **`peekCadence`** feeds **`ProcessDetails.nextPollCadence`** (mirrors, best-effort).

### Related types

- **`AcceleratingPollConfig`** — `fastest`, `slowest`, optional `decay`, `excitement` (`Duration` inputs).
- **`PollingService`**, **`PollingTag`** — exported types.

---

## Schedule (run windows)

**What it is:** The set of **run windows** the supervisor watches to decide *whether* a run instance should continue. Backed by an internal engine primitive (`src/internal/processSchedule.ts`); its public face is the **`Process`** namespace — window builders, schedule-layer factories, in-tick controls, and the standalone **`Process.Schedule`** resource. A process can stay up while its schedule is empty (disarmed).

### Window form (`Process.ScheduleEntry` / `ScheduleWindow`)

- **`id`** — `Option<string>`; stable identity for CRUD, `Process.currentScheduleId`, reconcile, removal. **Optional** — windows may be nameless.
- **`startAt`** — `Date`; when the instance becomes eligible.
- **`stopAt`** — `Option<Date>`; absent = open-ended from `startAt`; present = bounded window.

### Window builders (pure data, used in schedules/initializers)

- **`Process.at(startAt)`** — nameless one-shot, no stop.
- **`Process.at(id, startAt)`** — identified one-shot.
- **`Process.window(startAt, stopAt)`** — nameless bounded window.
- **`Process.window(id, startAt, stopAt)`** — identified bounded window.

### Schedule-layer factories (storage + initial data)

- **`Process.scheduleInMemory(entries?)`** — mutable in-process store seeded with `entries` (call with no argument for an empty, disarmed schedule). The `Layer` handed to `make`'s `schedule` / `scheduleLayer`.
- **`Process.scheduleDefine(({ at, window }) => entries[])`** — declarative builder for the same in-memory layer.
- **Default** (neither `schedule` nor `scheduleLayer` on `Process.make`) — an **always-armed** in-memory schedule (one open-ended window from the epoch), so the process runs immediately.
- **Custom layer** — any `Layer` implementing the full schedule service.

### Schedule service — read

- **`entries`** — a reactive **`ref`** (`entries.get` / `entries.changes`), all entries sorted by `startAt`.
- **`get(id)`** — `Option<entry>`; none if missing or the window has no id.
- **`has(id)`** — boolean.

### Schedule service — mutate

- **`set(entries)`** — replace the entire list.
- **`add(entry)`** — append.
- **`upsert(entry)`** — insert or replace by id.
- **`remove(id)`** — returns whether removed.
- **`removeMany(ids)`** — count removed.
- **`clear`** — wipe all.

### Schedule service — sync (engine-only)

- **`reconcile(nextEntries)`** — diff vs current: returns **`Process.ScheduleReconcileResult`** `{ added, updated, removed, unchanged }` (id-keyed; nameless windows matched by reference only); applies atomically. Available on the internal service, **not** on the `Process.Schedule` RPC surface.

### Ways to attach a schedule to a `Process`

- **Inline on the tag** — `Process.Tag<T>()("id").pipe(Process.schedule([Process.window(...)]))`: bakes windows into the definition **and** exposes a `schedule` verb group (`entries` ref + `set` / `add` / `clear`) on the service.
- **`Process.make(id, { schedule })`** — a schedule **layer** (`Process.scheduleInMemory(...)` / `scheduleDefine(...)`) **or** an **initializer** `(controls) => Effect` that runs once at start and receives **`Process.ScheduleControls`** (`entries`, `set`, `add`, `clear`).
- **`Process.make(id, { scheduleLayer })`** — explicit schedule layer (parallel to `schedule`).
- **Positional** — `Process.make(id, effect, polling?, schedule?)` accepts a schedule layer/initializer positionally.

### In-tick control surfaces

| Surface | API available | Typical use |
|---------|---------------|-------------|
| **Initializer** (`schedule: (controls) => …`) | `Process.ScheduleControls` — `entries`, `set`, `add`, `clear` | Seed on boot, subscribe once |
| **`Process.scheduleControls`** inside the tick | same subset | tick-driven schedule changes |
| **`Process.Schedule`** resource (own tag) | full CRUD + `entries` ref | HTTP handler, DB poller, game API sync |
| **`Process.currentScheduleId`** inside the tick | `Option<string>` | branch logic per match/job id |

### Standalone schedule resource (`Process.Schedule`)

- **`class Cron extends Process.Schedule<Cron>()("app/Cron") {}`** — a reusable window manager as its own `Resource` (kind `@nikscripts/effect-pm/Process/Schedule`).
- **`Process.scheduleLayer(tag, { initial? })`** / **`Process.scheduleServe(tag, { initial? })`** — local / served layers (`initial` seeds `ScheduleWindow`s).
- Gate any number of processes with `Process.schedule(TheSchedule)`.

### Armed vs disarmed (behavioral, not separate types)

- **No window covers “now”** — disarmed: instances exit at the stop check; the **driver fiber can still run** if the process was started.
- **At least one window covers “now”** — armed: the inner loop runs `Polling.awaitNextTick` → the user `effect`.
- **Default schedule** — always has a covering window after the driver starts.

### Related types (on the `Process` namespace)

- **`Process.ScheduleEntry`**, **`Process.ScheduleService`**, **`Process.ScheduleReconcileResult`**, **`Process.ScheduleControls`**, **`ScheduleWindow`**, **`ProcessScheduleInitializer`**, **`ProcessScheduleLayerInput`**, **`ScheduleDefineApi`**.

### Compatibility helpers (custom schedule authors)

- See **`disarmedIdleSleep`** section — not used by default schedule-driven supervisor loop but exported for custom layers.

---

## Process (managed process)

**What it is:** Named **`Process<R>`** with long-lived **`effect`** (schedule driver + optional merged polling/schedule layers) and per-tick user **`effect`** in config. **`type: "managed"`**.

### Construction forms

- **`Process.make(id, { effect, polling?, schedule?, scheduleLayer? })`** or **`Process.make(id, effect, polling?, schedule?)`** — returns handle + baked layers (`process.name === id`). Third/fourth positional args may be polling preset, schedule preset, or schedule initializer (order-independent).
- **`Process.Service<Self>()(id, effect, …)`** / **`Process.Service<Self>()(id, { effect, … })`** — class-style Context tag + `.layer`; id becomes `name`.

### Config fields (`ProcessMakeOptions`)

- **`effect`** — `Effect<void, E, RUser>` — one **tick** body.
- **`polling`** — optional `Layer<PollingService>`.
- **`schedule`** — optional initializer **or** schedule `Layer`.
- **`scheduleLayer`** — optional explicit schedule layer override.

### Handle members

- **`name`**, **`type`**, **`effect`**, **`getStatus(dateRange?)`**, **`runImmediately()`**.
- **`effect` requirements** — `R` after inline layer merge, plus optional storage facets (analytics when present).
- **`getStatus`** — returns **`ProcessDetails`**; uses store for execution history when available.
- **`runImmediately`** — one tracked tick **without** requiring armed schedule; separate from supervisor loop.

### `ProcessDetails` (status shape)

- **`lastRun`**, **`executions`**, **`firstStartup`**, **`armed`**, **`nextScheduleTransition`**, **`nextPollCadence`**, **`activeInstances`**, **`nextTriggerRun`** — mirrors from supervisor + store (best-effort where noted in TSDoc).

### Tick-context exports

- **`Process.currentScheduleId`** — `Option<string>` for active schedule entry id.
- **`Process.scheduleControls`** — `entries`, `set`, `add`, `clear` inside running instance.

### Supervisor semantics (contractual behavior)

- **Outer loop** — schedule driver: waits for arm state / schedule changes.
- **Inner loop** (per spawned instance while armed) — `awaitNextTick` → user `effect` → polling `afterTick`; instance ends when entry window closes or stop check fails.
- **Failures in user `effect`** — logged; **`process.execution.completed`** with `failed` when storage facets are present.
- **Execution record fields** — `scheduleKey`, `startedAt`, `completedAt`, `durationMs`, `status` (`completed` | `failed` | `interrupted`), optional `error`, `isStartupRun`.

### Typing helpers

- **`ProcessSupervisorRequirements<C>`** — fork-time `R` from config.
- **`ProcessEffectRequirements<P>`** — extract `R` from process type.
- **`ProcessDefinition`**, **`ProcessServiceDefinition`**, **`ProcessInterface`** (type export name).

### Remote / HTTP / CLI


---

## QueueResource

**What it is:** Three-level **priority** queue (`high` | `normal` | `low`) + worker pool; Context service with optional **item schema** for validated enqueue.

### Construction forms

- `QueueResource.Service<Self, T, E>()(name, config)` — tag + baked **`.layer`**; requirements are inferred from config.
- **`QueueResource.Tag<Self, T, E, R>()(name)`** + **`QueueResource.layer(tag, config)`** — DI / env-specific impls.
- **`QueueResource.make(config)`** — scoped `Effect` → **`QueueHandle`** (requires **`Scope`**).
- **`Layer.effect(tag)(QueueResource.make(config))`** — manual.

### Config without item schema (`QueueResourceConfigWithoutItemSchema`)

**Base fields (`QueueResourceConfigBase`):**
- **`name?`** — default `"anonymous"`.
- **`paused?`** — start paused; default false.
- **`concurrency?`** — workers; default 5.
- **`capacity?`** — per-priority cap; default 50_000.
- **`key?`** — dedup: drop if key already in-flight.
- **`retries?`** — max lifecycle hook `event.retry` re-enqueues; default Infinity.
- **`onEnqueued?`**, **`onStarted?`**, **`onExit?`**, **`onCompleted?`**, **`onFailed?`**, **`onRetryScheduled?`**, **`onRetryExhausted?`**, **`onReleased?`**, **`onDropped?`**, **`onDeadLettered?`** — fire-and-forget item lifecycle hooks with queue-bound controls.
- **`effect(item, ctx)`** — required worker body.
- **`onStart?(event, queueHandle)`** — queue-bound hook that runs once when workers start.
- **`onDrained?(event, queueHandle)`** — queue-bound hook after pending work drains empty (or after `clear`); not triggered by cold-start idle worker waits.
- **`onCleared?(event, queueHandle)`** — queue-bound hook after pending entries are cleared.

**Enqueue error channel on contexts:** `QueueItemValidationError | QueueBatchValidationError` only when schema path used; without schema, still typed but validation never fails.

### Config with item schema (`QueueResourceConfigWithItemSchema`)

- **`itemSchema`** — Effect `Schema` for items.
- Same **`effect`** and lifecycle hooks as above.
- Public **`add`/`enqueue`/…** and hook enqueues can fail validation.

### `QueueHandle` operations

**Enqueue (iterable batch):** `add`, `enqueue` (alias semantics same priority as add), `prioritize`, `defer`.

**Observe:** `size`, `sizes` `{ high, normal, low }`, `isEmpty`, `completed`.

**Lifecycle/routing:** `start`, `pause`, `resume`, `shutdown` (permanent; further enqueue dropped/warned), `clear` → count removed, `release` → decoded pending entries for local handoff, `releaseEncoded` → schema-backed JSON payloads for remote handoff, `drop` / `deadLetter` → remove matching pending entries.

### `EffectContext` (in worker `effect`)

- **`attempts`**, **`enqueuedAt`**, **`priority`**.
- **`add` / `prioritize` / `defer`** — **guarded**: self-enqueue by ref or key → warn + drop.

### Lifecycle hook envelopes

- **`QueueEntry<T>`** — item, entry id, key, priority, attempts, timestamps, batch/release/source/attributes.
- **`QueueBatch<T>`** — batch of queue entries plus priority.
- **`QueueExitEvent<T, E>`** — entry, `Exit`, elapsed duration, and **`retry`**.
- **Queue-bound controls** — `add`, `prioritize`, `defer`, lifecycle controls, and status reads.

### Priority type

- **`Priority`** — `"high"` | `"normal"` | `"low"`.

### Errors

- **`QueueShutdownError`** — enqueue after shutdown (often logged/dropped in practice).
- **`QueueItemValidationError`**, **`QueueBatchValidationError`** — schema path.

### Queue store events (when storage facets are present)

- **`queue.item.completed`** — `status`: `completed` | `failed` | `retried` | `exhausted`; priority, durationMs, attempts, optional error.
- **`queue.lifecycle.changed`** — `Started`, `Paused`, `Resumed`, `Shutdown`, `Cleared` (+ optional `itemsCleared`).

### Remote


### Queue rate limit

- **`rateLimit?: QueueResourceRateLimitOptions`** on **`QueueResourceConfig`** — Effect **`RateLimiter`** (`effect/unstable/persistence`): linked `consume` shape (`limit`, `window`, `algorithm`, `key`, `onExceeded`, `tokens`, `record`). Runs before semaphore; auto `queue.ratelimit.exceeded` storage when `record` is `"exceeded"` (default). Hook **`onRateLimitExceeded`**. In-memory store auto-composed; app can supply Redis for cross-process limits.

---

## RunResource

**What it is:** Semaphore-style **concurrency gate** around an **`effect`** (or arbitrary effect via **runner**). Not a queue.

### Construction forms

- **`RunResource.make({ name?, effect, concurrency? })`** — scoped gate callable.
- **`RunResource.Service<Self, T, A, E>()(name, config)`** — tag + `.layer`.
- **`RunResource.Tag` + `RunResource.layer`** — DI.
- **`RunResource.makeRunner({ name, concurrency? })`** — tag + layer; **`yield* runner(anyEffect)`** wraps any `Effect`.

### Config

- **`effect(input)`** — worker for parameterized gates.
- **`concurrency?`** — default 1.
- **`name?`** — resource id for observer (`@app/...`).

### Unit vs parameterized gates

- **Parameterized** — `T` input, call `gate(input)`.
- **Unit** — `void` input, call `gate(undefined)`.

### `RunResourceState` (observer snapshot)

- **`ref`**, **`observedAt`**, **`configVersion`**, **`concurrency`**, **`waiting`**, **`inFlight`**, **`completed`**, **`failed`**, **`interrupted`**, **`totalDurationMs`**.

### `ProcessStoreRunResource` facts (when facet layer composed)

**Fact types:** `run-resource.run.started`, `run-resource.run.completed`, `run-resource.run.failed`.

**State transition types (examples):** `run-resource.run.waiting`, `run-resource.run.started`, `run-resource.run.completed`, `run-resource.run.failed`, `run-resource.run.interrupted`, `run-resource.run.wait.interrupted`.

### Remote

- None.

---

## HttpClientRunGate

**What it is:** Wrap **`HttpClient`** so each request's **full execute pipeline** runs through a **`RunResourceRunner`**.

### Forms

- **`HttpClientRunGate.withRunner(runner)`** — pipe-friendly curried transform.
- **`HttpClientRunGate.transformClient(client, runner)`** — explicit argument order.
- **Namespace object** — both names.

### vs HttpApiResource

- **RunGate** — entire transport (DNS/TLS/body) gated.
- **HttpApiResource `transformResponse`** — only post-fetch decode stage (documented distinction).

---

## HttpApiResource

**What it is:** **`HttpApi`** schema → Context service client; optional transport concurrency gate.

### Construction forms

- **`HttpApiResource.make(api, { name, baseUrl?, transformClient?, transformResponse?, concurrency? })`** — tag + `.layer`; requires **`HttpClient`** in env.
- **`HttpApiResource.layerEffect(tag, clientBuildEffect, { concurrency? })`** — gate existing client-building `Effect`.
- **`acceptJson`** — sets `Accept: application/json` on all requests (standalone export + on namespace).

### Config dimensions

- **`concurrency` omitted** — no gating (unlimited in-flight).
- **`transformClient`** — applied **before** concurrency gate (auth headers, `acceptJson`, etc.).
- **`transformResponse`** — on decoded response effect.

### Remote

- None (client-side).

---

## ProcessStore / ProcessStorage

**What it is:** `ProcessStore` is the facet builder. `ProcessStorage` composes
the built-in facets over `RuntimeStorage`.

### Layer forms

- **`ProcessStorage.layer`** — all built-in facets + in-memory `RuntimeStorage`.
- **`ProcessStorage.layerRuntimeStorage`** — all built-in facets over an injected
  `RuntimeStorage`.
- **`@nikscripts/effect-pm/storage/sqlite`** — `SQLiteRuntimeStorage` durable
  `RuntimeStorageService` and `layerProcessStore({ filename })`.
- **`@nikscripts/effect-pm/storage/redis`** — `RedisRuntimeStorage` durable `RuntimeStorageService`.

### Facet write/read

**Write:** domain code calls static emitters such as
`ProcessStoreProcessExecution.recordCompleted(...)` or
`ProcessStoreRunResource.recordRunStarted(...)`. Static emitters no-op when the
facet is absent and log write failures instead of changing caller behavior.

**Read:** acquire the owning facet (`yield* ProcessStoreLog`,
`yield* ProcessStoreProcessExecution`, `yield* ProcessStoreRunResource`, etc.)
and call its domain read methods.

### Query types

- **`QueryOpts`** — `limit`, `before`, `after` (epoch ms).
- Per-facet query types (`QueueEntryQuery`, `QueueLifecycleQuery`, `QueueDedupeKeyQuery`, `RunResourceFactQuery`, `RunResourceStateHistoryQuery`, `ProcessExecutionQuery`, …) are owned by the facet that consumes them — there is no shared `StoreEventQuery`.

### Event taxonomy (per-facet, no shared union)

`AnalyticsEvent` and the `runtime.fact.recorded` / `runtime.state.changed` generic envelopes have been removed. Each facet now owns its concrete wire-event types:

| Type | Owner | Payload highlights |
|------|-------|-------------------|
| **`process.execution.completed`** | `store/processExecution` | scheduleKey, startedAt, completedAt, durationMs, status, error?, isStartupRun |
| **`process.lifecycle.changed`** | `store/processLifecycle` (+ `store/processGroup` reuses the encoder) | tag: Started/Stopped/Restarted/Errored/Recovered/Disabled/Enabled, error? |
| **`log.entry`** | `store/log` | level, message, error?, attributes |
| **`run-resource.fact.<status>`** × 3 | `store/runResource` | per-status `RunResourceFact` (started/completed/failed) |
| **`run-resource.state.changed`** | `store/runResource` | wraps `RunResourceStateChange` |
| **`queue.entry.<status>`** × 9 | `store/queueResource` | enqueued, started, completed, failed, retried, exhausted, released, dead-lettered, dropped |
| **`queue.lifecycle.<tag>`** × 6 | `store/queueResource` | Started, Paused, Resumed, Shutdown, Cleared, Drained |
| **`queue.dedupe-key.<status>`** × 3 | `store/queueResource` | added, released, hydrated |

### Per-domain projections (on the `ProcessStoreRunResource` facet)

- **`facts({ resourceId, runId?, types? })`** — from `run-resource.fact.recorded` events.
- **`stateHistory({ resourceId })`** — `run-resource.state.changed` transitions.
- **`latestState(resourceId)`** — `Option` latest snapshot.
- **`runs(resourceId)`** — paired started + ended history per run.
- **`byRun(runId)`** — all facts for one specific run, ordered.

### Adapter behavior

- SQLite stores normalized `RuntimeRecord` rows.
- Durable runtime storage is provided by the **sqlite** and **redis** adapters.

### Codec (storage row mapping)

- Per-facet `RuntimeRecord` codecs live inside the facet file (`src/store/<facet>.ts`). There is no shared `encodeEvent` / `decodeEventRow`.
- `src/internal/store/helpers.ts` provides only generic, type-agnostic helpers (`runtimeRecordQuery`, `applyQueryOpts`, `windowOpts`, `byTimestampDesc`, JSON predicates, …) that every facet composes.

### Automatic writers (no extra config)

- **Process** supervisor — executions + lifecycle when relevant facets are present.
- **QueueResource** — item + lifecycle events when relevant facets are present.
- **`ProcessStoreRunResource` facet** — RunResource facts/state persisted as analytics events through the per-type static optional emitters on the tag.

### Remote

- None.

---

## ProcessStoreRunResource facet (`@nikscripts/effect-pm/store/RunResource`)

**What it is:** Per-domain storage facet for `RunResource` facts and state changes. Replaces the removed generic `ProcessStoreRuntime` facet and `RuntimeObserver`. The legacy `FactEnvelope` plumbing module has been deleted; every facet now owns its concrete `RuntimeRecord` codec inline.

### Static optional emitters (on the tag)

- **`ProcessStoreRunResource.recordRunStarted(fact)`**, **`.recordRunCompleted(fact)`**, **`.recordRunFailed(fact)`**, **`.recordStateChange(change)`**, plus **`recordFactBatch(facts)` / `recordStateChangeBatch(changes)`** — silent no-op when the facet layer is absent; persistent write when present. Storage failures surface unless the caller explicitly pipes through `ProcessStore.catchErrorAndLog(...)`.

### Service methods (`yield* ProcessStoreRunResource`)

- **Writes** (raw): `recordRunStarted`, `recordRunCompleted`, `recordRunFailed`, `recordStateChange`, `recordFactBatch`, `recordStateChangeBatch` — return `Effect<void, ProcessStoreWriteError>`.
- **Reads:** `facts({ resourceId, runId?, types? })`, `stateHistory({ resourceId })`, `latestState(resourceId)`, `runs(resourceId)` (paired started + ended history), `byRun(runId)` (facts for one run).

### Layers

- **`ProcessStoreRunResource.layerRuntimeStorage`** — facet on top of injected `RuntimeStorage`.
- **`ProcessStoreRunResource.layer`** — facet + in-memory `RuntimeStorage` (dev/test).
- Composed by `ProcessStorage.layerRuntimeStorage` and `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`.

### In-process listeners (no durability)

Provide a custom service whose shape matches **`ProcessStoreRunResource.Type`** via `Effect.provideService` / `Layer.succeed` that fans out to scoped callbacks. Type your callback bag with a local interface inside the consumer (the package no longer ships a generic `RuntimeObservationListener`). There is no package-level `layerListeners` helper.

### Core types

- **`RunResourceRef`** — `{ kind: "@nikscripts/effect-pm/RunResource", id }`.
- **`RunResourceFact`** — union of `RunResourceRunStartedFact` / `RunResourceRunCompletedFact` / `RunResourceRunFailedFact`.
- **`RunResourceState`** — live counters for waiting, in-flight, completed, failed, interrupted, total durationMs.
- **`RunResourceStateChange`** — id, ref, previous, current, changedAt, optional reason.
- Per-status fact wire types (`run-resource.fact.started` / `…completed` / `…failed`) and `run-resource.state.changed` — emitted directly via `recordRun*` / `recordStateChange`. There is no longer a shared `RunResourceFactRecordedEvent` / `RunResourceStateChangedEvent` envelope.

### Planned (docs only)

- `ProcessStoreRunResource.live(resourceId): Stream<...>` — per-resource subscription stream that will replace the custom-service in-process listener pattern.

---

## disarmedIdleSleep

**What it is:** Pure policy helpers for **custom** schedule implementations (default supervisor does not use disarmed polling loop).

### Exports

- **`DEFAULT_SCHEDULE_POLL_WHILE_DISARMED`**, **`MIN_SCHEDULE_POLL_WHILE_DISARMED`**
- **`DISARMED_HINT_SLEEP_MIN`**, **`DISARMED_HINT_SLEEP_MAX`**
- **`resolveDisarmedFallbackPoll(configured?)`**
- **`computeDisarmedIdleSleep({ now, nextScheduleTransition, fallbackPoll })`**

---

## Resource (umbrella import)

**What it is:** Thin alias object — not separate implementations.

| Alias | Points to |
|-------|-----------|
| `Resource.make` | `RunResource.make` |
| `Resource.makeRunner` | `RunResource.makeRunner` |
| `Resource.makeHttpApiClient` | `HttpApiResource.make` |
| `Resource.layerHttpApiClient` | `HttpApiResource.layerEffect` |
| `Resource.makeQueue` | `QueueResource.layer` |
| `Resource.acceptJson` | `HttpApiResource.acceptJson` |

---

## Package import surfaces (for doc “where do I import X”)

- **Root** `@nikscripts/effect-pm` — barrel in §index exports (Process, Polling, Schedule, Group, Queue, Run, Http*, Store, Manager, Control, CLI, disarmed helpers, types).
- **Subpaths** — `/Process`, `/QueueResource`, `/CustomQueueResource`, `/Resource`, `/MultiNode`, `/Group`, `/ApiMetrics`, `/Telemetry`, `/ApiUsageSchema`, `/HttpApiResource`, `/Query`, `/ResourceConfigure`, `/RuntimeStorage`, `/Logs`, `/NodeLogs`, `/NodeStatus`, `/HistoryStore`, `/DurableQueueStore`, `/ProcessStore`, `/ProcessStorage`, `/store/RunResource`, `/store/QueueResource`, `/store/Log`, `/store/ProcessLifecycle`, `/store/ProcessExecution`, `/storage/sqlite`, `/storage/redis`, `/web`, `/cli`, `/tui`.

---

## Roadmap concepts (`docs/plans` — not all implemented)

Use plans for intended design; verify against `src/` before teaching as shipped.

- **`RuntimeStorage`** generic port under store facets.
- **Queue item schema in group contract** → remote enqueue / handoff / release.
- **Queue analytics v2** — richer projections.
- **Schedule identity + persistence** — DB sync, stable ids, removal cleanup.
- **Control service v2** — streaming, richer reads.
- **Process lifecycle hooks** — user hooks separate from polling/schedule config.
- **Lifecycle machine** — typed kernel for eligibility.
- **Strict `anyUnknownInErrorContext`** — TS plugin rule re-enable.
- **Runtime streams**, **mutable config after start**, **multi-host coordination**.

**Explicitly discarded (plans README):** runtime-wide ProcessEntry reconciler; old ProcessControl with `switchSchedule`/`sleepUntil`; `Polling.cron`; dynamic `addProcess`/`removeProcess` on live group without ownership model.

---

## Example scripts (teaching inventory only)

Grouped by **idea demonstrated** — not file paths as authority.

| Idea | Example scripts |
|------|-----------------|
| DB → schedule sync | schedule-sync-from-external-db |
| Schedule entries | at, window, define |
| Schedule control surfaces | initializer, in-effect, external-fiber |
| Polling presets / sports | spaced-read, accelerating, reset-cadence, peek-cadence, delayed-start |
| Queue | priority-retry |
| RunResource / observer | unit-and-input, runtime-observer |
| HTTP gating | http-client-run-gate, http-api-resource tag/layerEffect |
| Store backends | memory, events-file-layer, sqlite, redis |
| NWSL HttpApi scenario | nwslsoccer subtree (optional local) |

---

*End of concept inventory.*
