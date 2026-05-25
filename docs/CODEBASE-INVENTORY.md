# effect-pm — concept inventory

Flat catalog of **every teachable idea** in the package: what each thing is, every form it takes, every way to configure or wire it, and every control surface (in-process vs local HTTP vs remote HTTP). For doc planning and linearization — not a file tree.

**Remote control plane** = `ControlService` (localhost JSON) + `ProcessManager` / `ProcessManager.cli` (HTTP client to that API). Neither exposes schedule entry CRUD or polling cadence APIs unless your app adds its own layer on top.

---

## Cross-cutting (how pieces combine)

- **Effect `Layer`** — polling, schedule, queues, storage facets (`ProcessStoreRunResource`, `ProcessStoreLog`, `ProcessStoreQueueResource`, `ProcessStoreProcessLifecycle`, `ProcessStoreProcessGroup`, `ProcessStoreProcessExecution`), platform (`FileSystem`/`Path`, `HttpClient`) merged at app root; `Process.make` can inline polling/schedule into `process.effect` so fork-time `R` excludes those tags when merged.
- **`Effect.scoped`** — `QueueResource.make`, `ControlService.make`, remote layers acquire/release with scope.
- **Storage optional** — when relevant facets are present in env, processes/queues/resources append analytics; when absent, behavior continues without failing.
- **Canonical ids** — slash-separated strings (`@scope/Segment/ServiceName`); CLI/remote accept normalized kebab suffix aliases; ambiguous suffixes error with candidate list.
- **Contract-first control** — each process/queue entry declares which controls exist; HTTP and CLI check locally before mutating; remote `verifyContract` compares local contract to `GET /contract`.
- **Three lifetimes to keep separate** — (1) group constructed, (2) process driver **started** (`start`/`startAll`), (3) schedule **armed** (entries cover “now”) vs instance **ticking** (polling between user `effect` runs).

---

## Polling

**What it is:** `Layer` providing **`PollingService`** (Context tag `Polling` / `PollingTag`). Answers: *how long between repeats of the user tick while a run instance is armed?* Does not decide *whether* the instance runs — `ProcessSchedule` does.

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

- **None** — no polling endpoints on `ControlService` or `ProcessManager`.

### Status / introspection

- **`peekCadence`** feeds **`ProcessDetails.nextPollCadence`** / **`ProcessGroupDetails.nextPollCadence`** (mirrors, best-effort).

### Related types

- **`AcceleratingPollConfig`** — `fastest`, `slowest`, optional `decay`, `excitement` (`Duration` inputs).
- **`PollingService`**, **`PollingTag`** — exported types.

---

## ProcessSchedule

**What it is:** `Layer` providing **`ProcessScheduleService`** (tag `ProcessSchedule` / `ProcessScheduleTag`). Stores **entries**; supervisor uses them to decide if a run instance should continue; driver can stay up while entries are empty (disarmed).

### Entry form (`ProcessScheduleEntry`)

- **`id`** — `Option<string>`; stable identity for CRUD, `Process.currentScheduleId`, reconcile, removal.
- **`startAt`** — `Date`; when instance becomes eligible.
- **`stopAt`** — `Option<Date>`; absent = open-ended from `startAt`; present = bounded window.

### Entry constructor helpers (pure data, used in layers/initializers)

- **`ProcessSchedule.at(startAt)`** — anonymous one-shot, no stop.
- **`ProcessSchedule.at(id, startAt)`** — identified one-shot.
- **`ProcessSchedule.window(startAt, stopAt)`** — anonymous bounded window.
- **`ProcessSchedule.window(id, startAt, stopAt)`** — identified bounded window.
- **`ProcessSchedule.fromStarts(dates[])`** — many anonymous `at` entries.

### Schedule layer factories (storage + initial data)

- **`ProcessSchedule.inMemory(initialEntries?)`** — mutable in-process store; default backing when Process doesn't override.
- **`ProcessSchedule.alwaysArmed`** — single eternal entry from epoch, no stop (always eligible once driver started).
- **`ProcessSchedule.define(({ at, window, fromStarts, all }) => entries[])`** — declarative builder; `all(...)` flattens entry list into one layer.
- **Custom layer** — any `Layer` implementing full `ProcessScheduleService`.

### `ProcessScheduleService` — read

- **`entries`** — all entries sorted by `startAt`.
- **`changed`** — completes when any mutation occurs (wait for external sync).
- **`get(id)`** — `Option<entry>`; none if missing or entry has no id.
- **`has(id)`** — boolean.

### `ProcessScheduleService` — mutate

- **`set(entries)`** — replace entire list; triggers `changed`.
- **`add(entry)`** — append; triggers `changed`.
- **`upsert(entry)`** — insert or replace by id; triggers `changed`.
- **`remove(id)`** — returns whether removed; triggers `changed`.
- **`removeMany(ids)`** — count removed; triggers `changed`.
- **`clear()`** — wipe all; triggers `changed`.

### `ProcessScheduleService` — sync

- **`reconcile(nextEntries)`** — diff vs current: returns **`ReconcileResult`** `{ added, updated, removed, unchanged }` (id-keyed; entries without id matched by reference only); applies atomically; triggers `changed`.

### Ways to wire schedule into `Process`

- **`Process.make(id, { schedule: ScheduleLayer })`** — fixed layer at build time.
- **`Process.make(id, { schedule: (controls) => Effect })`** — **initializer** runs once when schedule resource starts; receives **`ProcessScheduleControls`** (`entries`, `set`, `add`, `clear` — subset of full service in initializer typing).
- **`Process.make(id, { scheduleLayer: Layer })`** — explicit layer field (parallel to `schedule` field).
- **Default** — in-memory schedule layer when not specified (per `Process` implementation).

### In-process control surfaces

| Surface | API available | Typical use |
|---------|---------------|-------------|
| **Initializer** | `entries`, `set`, `add`, `clear` | Seed on boot, subscribe once |
| **`Process.scheduleControls` inside tick** | same subset | tick-driven schedule changes |
| **Full service in another fiber** | full `ProcessScheduleService` including `upsert`, `remove`, `reconcile`, `changed` | HTTP handler, DB poller, game API sync |
| **`Process.currentScheduleId` inside tick** | `Option<string>` | branch logic per match/job id |

### Armed vs disarmed (behavioral, not separate types)

- **No entry covers “now”** — disarmed: instances exit at stop check; **driver fiber can still run** if process was started.
- **At least one entry covers “now”** — armed: inner loop runs `Polling.awaitNextTick` → user `effect`.
- **`alwaysArmed`** — always has covering entry after driver start.

### Remote / HTTP / CLI

- **None** on `ControlService` / `ProcessManager` for schedule CRUD.

### Related types

- **`ProcessScheduleEntry`**, **`ReconcileResult`**, **`ProcessScheduleService`**, **`ProcessScheduleTag`**, **`ProcessScheduleControls`**, **`ProcessScheduleInitializer`**.

### Compatibility helpers (custom schedule authors)

- See **`disarmedIdleSleep`** section — not used by default schedule-driven supervisor loop but exported for custom layers.

---

## Process (managed process)

**What it is:** Named **`Process<R>`** with long-lived **`effect`** (schedule driver + optional merged polling/schedule layers) and per-tick user **`effect`** in config. **`type: "managed"`**.

### Construction forms

- **`Process.make(id, { effect, polling?, schedule?, scheduleLayer? })`** or **`Process.make(id, effect, polling?, schedule?)`** — returns handle + baked layers (`process.name === id`). Third/fourth positional args may be polling preset, schedule preset, or schedule initializer (order-independent).
- **`Process.Service<Self>()(id, effect, …)`** / **`Process.Service<Self>()(id, { effect, … })`** — class-style Context tag + `.layer` for typed `ProcessGroup` entries; id becomes `name`.

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

- Indirect only via **ProcessGroup** process controls (`start`, `stop`, `restart`, `runImmediately`, `status`) — not schedule/polling.

---

## ProcessGroup

**What it is:** Orchestrates **process** + **queue** entries; owns fibers/scopes; exposes **typed contracts** for control surfaces; **`make`** acquires queue tags once.

### Construction forms

- **`ProcessGroup.make(id, entries as const, configItems?)`** — `Effect` yielding **`TypedProcessGroup`**; requires env for all queue entry tags.
- **`ProcessGroup.Service(id, entries, configItems?)`** — injectable class: static **`id`**, **`entries`**, **`config`**, **`contract`**, **`make`**, **`layer`**; yieldable as group service.
- **`ProcessGroup.remoteLayer(GroupService, Endpoint)`** — same service key, HTTP-backed; see Remote group.

### Entry forms in tuple

- **`Process.make` result** or **`Process.Service` class** — process entry.
- **`QueueResource.Service` class** — queue entry with baked layer.
- **`QueueResource.Tag` + `QueueResource.layer`** — queue entry with swappable layer.
- **Empty queues array** — valid (process-only group).

### Untyped handle (`ProcessGroup<R>`) — string names

**Process lifecycle:** `start`, `stop`, `restart`, `startAll`, `stopAll`, `runImmediately`.

**Status:** `status` (all processes + queues), `processStatus(name)`, `health`.

**Queues:** `listQueues`, `getQueue(name)` → raw **`QueueHandle`**, `pauseQueue`, `resumeQueue`, `clearQueue` → count cleared. **`startAll`** runs each queue’s **`QueueHandle.start`** first (needed when **`autoStart: false`**), then starts stopped processes.

**Shutdown:** `awaitShutdown({ logMessage? })` — OS signals (Node); needs `Scope`.

### Typed handle (`TypedProcessGroup`)

- Same operations keyed by **entry value** (`process(SyncBilling)`, `queue(EmailQueue)`).
- **`startAll`** — runs **`queue(entry).start`** for every queue, then **`start(process)`** for every process not already running (matches legacy **`ProcessGroup.startAll`** ordering).
- **`process(entry)`** → **`TypedProcessControls`**: `start`, `stop`, `restart`, `runImmediately`, `status`.
- **`queue(entry)`** → **`TypedQueueControls`**: `add`, `enqueue`, `prioritize`, `defer`, **`start`**, `pause`, `resume`, `clear`, `status` (enqueue errors when item schema present).

### Contract model

**Group contract (`ProcessGroupContract`):** `id`, `kind: "group"`, `version: "v1"`, `processes[]`, `queues[]`.

**Process contract entry:** `id`, `kind: "process"`, **`controls[]`** subset of:
- **`start`**, **`stop`**, **`restart`**, **`runImmediately`**, **`status`**

**Queue contract entry:** `id`, `kind: "queue"`, **`controls[]`** subset of:
- **`enqueue`** (capability bit; remote enqueue still blocked — see below), **`start`**, **`pause`**, **`resume`**, **`clear`**, **`status`**
- Optional **`item`** codec descriptor when queue declared with **`itemSchema`**.

**Schema exports for validation/encoding:** `ProcessGroupProcessControlSchema`, `ProcessGroupQueueControlSchema`, `ProcessGroupProcessContractSchema`, `ProcessGroupQueueContractSchema`, `ProcessGroupContractSchema`.

### Status shapes

- **`ProcessGroupDetails`** — name, type, status (`running`|`stopped`), uptime, startTime, lastRun, executions, firstStartup, armed, nextScheduleTransition, nextPollCadence, activeInstances, nextTriggerRun.
- **`QueueDetails`** — name, size `{ high, normal, low, total }`, completed count.
- **`GroupHealth`** — healthy flag, processes running/stopped counts, queues active count.

### Process lifecycle store events (when storage facets are present)

**Tags on `process.lifecycle.changed`:** `Started`, `Stopped`, `Restarted`, `Errored`, `Recovered`, `Disabled`, `Enabled`.

### Errors

- **`ProcessNotFoundError`**, **`ProcessAlreadyRunningError`**, **`ProcessNotRunningError`** — local ops mistakes.
- **`ProcessGroupRemoteControlError`** — network/HTTP failures on remote layer.
- **`UnsupportedRemoteControlError`** — contract or platform doesn't allow op (remote enqueue, remote `awaitShutdown`, etc.).
- **`QueueItemValidationError`**, **`QueueBatchValidationError`** — schema-backed enqueue (from QueueResource, re-exported).
- **`ProcessGroupControlError`** — union of above for typed group error channel.

### Requirement typing

- **`AllGroupProcessesRequirements<Entries>`** — union of all process `effect` requirements.
- **`ProcessGroupEntryRequirements<Entries>`** — combined env for group ops.
- **`ProcessEffectRequirements<P>`** — per-process extract.

### Remote group (`ProcessGroup.remoteLayer`)

**Supported remotely (after cached `verifyContract` per call):** process `start`/`stop`/`restart`/`runImmediately`; queue `pause`/`resume`/`clear`/`status`; group `status`, `health`.

**Fails with `UnsupportedRemoteControlError`:** queue `add`/`enqueue`/`prioritize`/`defer`; **`awaitShutdown`** on remote group.

**Widened error channel:** `ProcessGroupRemoteControlError` | `UnsupportedRemoteControlError` | etc.

### Start vs armed vs stop (group level)

- **`make` / `Service.layer`** — registers entries; processes **stopped**; queues acquired.
- **`start` / `startAll`** — forks **`process.effect`** (schedule **driver** runs).
- **Schedule entries** — control whether instances tick (see ProcessSchedule).
- **`stop` / `stopAll`** — interrupt driver scope + instances; lifecycle **Stopped**.

---

## ControlService (local HTTP control plane)

**What it is:** **`ControlService.make({ port?, group })`** — scoped **127.0.0.1** HTTP JSON server for a **typed** `ProcessGroup`. Re-exports **`createCli`** / **`runCli`**.

### Binding & security

- **Host** — localhost only.
- **Port** — default **3001**.
- **No auth/TLS/rate limits** — documented private-network assumption.

### HTTP routes

- **`GET /health`** — probe.
- **`POST /control`** — canonical transport route carrying a protocol envelope.
- **`GET /contract`** — serializable group contract.
- **`GET /status`** — combined process + queue status.
- **`GET /processes`** — list processes.
- **`GET /processes/:id`** — single process status.
- **`POST /processes/:id/start`**, **`stop`**, **`restart`**, **`now`** (`runImmediately`).
- **`GET /queues`** — list queues.
- **`GET /queues/:id`** — queue status.
- **`POST /queues/:id/pause`**, **`resume`**, **`clear`**.
- **`OPTIONS`** — CORS-style empty response.

### Response envelope (`ControlResponse`)

- **`success`**, optional **`type`** (`process` | `queue`), optional **`data`**, optional **`error`**.

### Contract enforcement on routes

- Resolves process/queue by name from URL.
- Checks contract exposes requested control before running (same idea as ProcessManager CLI preflight).

### What ControlService does NOT expose

- Schedule `set`/`add`/`clear`/`reconcile`.
- Polling `requestWake`/`resetCadence`.
- Queue **enqueue** over HTTP unless your contract includes it and route implementation supports it (contract model includes `enqueue` bit; remote ProcessManager still blocks enqueue — local HTTP may expose full queue handle via group implementation — local typed queue controls include enqueue).

---

## createCli / runCli (single-group local CLI)

**What it is:** **`createCli({ name, version, port? })`** → `@effect/cli` root; **`runCli(config, argv?)`** runs it.

### Commands (against one control URL)

- **`ls`** — list targets.
- **`status [name]`** — process or group status.
- **`start [name]`**, **`stop [name]`**, **`restart [name]`**, **`now [name]`** — process controls.
- **`pause [name]`**, **`resume [name]`**, **`clear [name]`** — queue controls.
- **`queues`** — list queues.

### Config

- **`port`** — default 3001; must match running `ControlService`.

---

## ProcessManager (remote typed client)

**What it is:** HTTP client for **contract-aligned** group control; connection registry; multi-group CLI; endpoint service for `remoteLayer`.

### Connection discovery forms

- **`ProcessManager.connect(Group)`** — URL from **`ProcessManagerConnectionRegistry`**.
- **`ProcessManager.connect(Group, { baseUrl })`** — explicit URL (tests/simple apps).
- **`ProcessManager.connect({ baseUrl, contract })`** — raw contract (generated clients).
- **`ProcessManager.ConnectionRegistry.layer(groups, { [groupId]: url })`** — static map.
- **`ProcessManager.ConnectionRegistry.layerConfig(groups, { [groupId]: Config })`** — Effect Config strings.

### Endpoint service forms

- **`ProcessManager.Endpoint<Self>()(Group)`** — registry-backed.
- **`ProcessManager.Endpoint<Self>()(Group, { baseUrl })`** — inline URL.
- **`Endpoint`** — direct export alias for `ProcessManager.Endpoint`.
- **`Endpoint.http({ transport })`** — endpoint definition for an HTTP control
  transport descriptor.
- **`Endpoint.module(load, select?)`** — typed module endpoint descriptor for a
  local runtime. When launch config is supplied, `group-start` starts its
  configured command out of process and waits for the HTTP control endpoint.
- **`Endpoint.local(definition).default`**, **`Endpoint.production(definition)`**,
  **`Endpoint.define(label, definition)`** — labeled endpoint config items for a
  `ProcessGroup.Service(..., configItems)` / `ProcessGroup.make(..., configItems)`
  third argument.
- **`ProcessManager.GroupConfig(Group, items?)`** — validate and normalize
  endpoint items for a group.
- **`ProcessManager.Config.layer(configs)`** — explicit endpoint config override
  layer. CLI endpoint selection uses this layer first, then group-bundled
  `Group.config`, then the legacy `ConnectionRegistry` fallback.
- **`ProcessManagerGroupEndpointStatus`** — `groups` command status model:
  `Configured`, `Pending`, `Online`, `Offline`, `ContractDrift`.
- **`ProcessManagerEndpointSelection`** — normalized endpoint entry exposed by
  `ProcessManagerGroupConfig.endpoints`.

### `RemoteProcessManager` API

- **`contract`** — local typed contract value.
- **`fetchContract`** — raw remote contract JSON.
- **`verifyContract`** — compare group id, version, process ids, queue ids, control sets.
- **`process(id)`** → **`RemoteProcessControls`**: `start`, `stop`, `restart`, `runImmediately`, `status`.
- **`queue(id)`** → **`RemoteQueueControls`**: `pause`, `resume`, `clear`, `status` only (**no** remote `add`/`enqueue`/`prioritize`/`defer`).
- **`status`** — whole group status via HTTP.

### ProcessManager CLI (`ProcessManager.cli(groups, config?)`)

**Subcommands:** `groups`, `ls`, `verify`, `group-start <group>`, `group-stop <group>`, `status <target>`, `start <target>`, `stop <target>`, `restart <target>`, `now <target>`, `pause <target>`, `resume <target>`, `clear <target>`.

**Flags:** `--json` on `groups`, `ls`, `verify`, `status`; `--target <label>`
on endpoint-backed runtime commands.

**`groups` status:** selected HTTP endpoint configs are probed with contract
verification and reported as `online`, `offline`, or `contract-drift`; module and
registry-backed endpoints report `configured` until launcher/status support
exists.

**Local run state:** `group-start` reuses an existing live PID from run state
instead of launching duplicates. `group-stop` sends `SIGTERM` to the recorded PID
and removes stale run state when the process no longer exists.

**Behavior:** resolves **canonical id or normalized suffix alias**; **preflight** contract for requested control (e.g. `now` requires `runImmediately` on contract); runs **`verifyContract`** before mutations in command paths. Human **`ls`** lists each group's entries as `KIND`, `ID`, and **contract controls** (`(none)` if empty); human **`groups`**, **`verify`**, **`status`** append short footer or pretty-print embedded status JSON respectively.

### Errors

- **`ProcessManagerRequestError`** — HTTP/network/decode failures.
- **`ProcessManagerConnectionError`** — registry missing group URL.

### Target resolution (used by CLI; not on main barrel)

- **`normalizeProcessManagerTarget`**, **`resolveProcessManagerTarget`** — suffix matching, ambiguity → **`AmbiguousProcessManagerTarget`**, missing → **`MissingProcessManagerTarget`**.

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

- **ProcessManager / remoteLayer** — no remote enqueue; local **TypedQueueControls** and **ControlService** local routes support **start**/pause/resume/clear/status; enqueue available **in-process** on typed/local handle only.

### Package marketing note

- README/index mention **throttle** alongside concurrency; **implemented gating** for HTTP is via **`RunResource`** / **`HttpApiResource.concurrency`**, not a separate queue throttle field in `QueueResourceConfig`.

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
- **`@nikscripts/effect-pm/storage/prisma`** or legacy **`@nikscripts/effect-pm/prisma`** — placeholder surface for the upcoming `RuntimeStorage` adapter rewrite.

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
- Prisma is intentionally unavailable until rebuilt as a `RuntimeStorage` adapter.

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

- **`ProcessStoreRunResource.recordRunStarted(fact)`**, **`.recordRunCompleted(fact)`**, **`.recordRunFailed(fact)`**, **`.recordStateChange(change)`**, plus **`recordFactBatch(facts)` / `recordStateChangeBatch(changes)`** — silent no-op when the facet layer is absent; persistent write when present. The builder wraps every static emitter with a built-in `catchCause + logWarning` so write failures are warning-logged and never propagated.

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

## PrismaProcessStore + effect-pm CLI (storage tooling)

### `PrismaProcessStore` namespace

- **`make(client)`**, **`layer({ client })`**, **`layerFromContext`** — throw/fail with `PrismaProcessStoreUnavailableError` until the RuntimeStorage-backed rewrite lands. Covered by `test/prisma-fail-fast.test.ts`.
- **`PrismaClientService`**, **`prismaClientLayer({ client })`**
- **`schema`**, **`schemaModelMarker`** — legacy `EffectPmEvent` model fragment retained for reference during rewrite.

### Structural types (`prisma/types`)

- **`PrismaProcessStoreClient`**, **`EffectPmEventDelegate`**, **`EffectPmEventRow`**, **`EffectPmEventCreateInput`**, **`JsonValue`**, query arg types.

### `addPrismaSchema` (library + CLI)

- Detect single-file vs multi-file Prisma layout.
- **`--separate-file`**, **`--no-separate-file`**, **`--dry-run`**
- Results: **`AlreadyPresent`**, **`DryRun`**, **`Wrote`** or **`AddPrismaError`**.

### `effect-pm` bin commands

- **`effect-pm prisma:print-schema`** — stdout fragment.
- **`effect-pm add prisma [flags]`** — write models; suggests migrate command.

---

## Package import surfaces (for doc “where do I import X”)

- **Root** `@nikscripts/effect-pm` — barrel in §index exports (Process, Polling, Schedule, Group, Queue, Run, Http*, Store, Manager, Control, CLI, disarmed helpers, types).
- **Subpaths** — `/Process`, `/QueueResource`, `/ProcessGroup`, `/ProcessStore`, `/ProcessStorage`, `/ProcessManager`, `/ControlService`, `/storage/sqlite`, `/storage/prisma`, `/prisma` (legacy Prisma compatibility).

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
| Full stack demo | full-process-group-with-queues-and-control-cli |
| Game window + TestClock | game-window-polling-with-process-group |
| DB → schedule sync | schedule-sync-from-external-db |
| Schedule entries | at, window, define |
| Schedule control surfaces | initializer, in-effect, external-fiber |
| Polling presets / sports | spaced-read, accelerating, reset-cadence, peek-cadence, delayed-start |
| ProcessGroup typed | make-entries, service, contract-http |
| ProcessManager | connection-registry, endpoint-service, remote-layer, contract-drift, multi-group-cli-ux (md) |
| Queue | priority-retry |
| RunResource / observer | unit-and-input, runtime-observer |
| HTTP gating | http-client-run-gate, http-api-resource tag/layerEffect |
| Store backends | memory, events-file-layer, prisma-structural-client |
| NWSL HttpApi scenario | nwslsoccer subtree (optional local) |

---

*End of concept inventory.*
