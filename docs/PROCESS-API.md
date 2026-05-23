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

### `Process.make(id, config)`

- **`id`** — stable process id (CLI, HTTP, `entityId` in store; exposed as `process.name` on the handle).
- **`config`** — `ProcessMakeOptions<E, R>` (no `name` field).

### `ProcessMakeOptions<E, R>`

| Field | Required | Description |
|--------|----------|-------------|
| `effect` | yes | `Effect<void, E, R>` — one **tick** body; failures logged + recorded when `ProcessStore` is provided. |
| `polling` | no | `Layer.Layer<PollingService, never, never>` — repeat cadence inside an instance. Omit and provide at fork time. |
| `schedule` | no | Either a `ProcessScheduleInitializer` (`({ set, add, clear }) => Effect`) or a `Layer.Layer<ProcessScheduleService, never, never>`. When omitted, defaults to `ProcessSchedule.alwaysArmed`. Use `ProcessSchedule.empty` for an empty store (disarmed until mutation). |
| `scheduleLayer` | no | Explicit schedule service layer; takes precedence over `schedule`. When both are omitted, `ProcessSchedule.alwaysArmed` is used. |

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

Canonical ids are slash-separated Effect-style strings with kebab-case package
segments and case-preserving service names, such as
`@repo/north-west/BillingGroup/SyncInvoices`. CLI commands accept normalized
lowercase/kebab-case aliases such as
`north-west/billing-group/sync-invoices`, but diagnostics should show canonical
ids and display kind separately as a column or label.

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
| `ProcessManager.ConnectionRegistry.layerConfig([Group], { [Group.id]: Config.string(...) })` | Provide the same registry from Effect `Config` values. |
| `ProcessManager.connect(Group)` | Build a typed remote client by reading the group URL from `ProcessManagerConnectionRegistry`. |
| `ProcessManager.cli([GroupA, GroupB] as const)` | Build a multi-group CLI from group contracts and the connection registry. |
| `ProcessManager.connect(Group, { baseUrl })` | Build a typed remote client from a group service/definition. |
| `ProcessManager.connect({ baseUrl, contract })` | Build from a raw contract for generated or contract-only clients. |
| `ProcessManager.Endpoint<Self>()(Group)` | Injectable endpoint service that reads the group URL from `ProcessManagerConnectionRegistry`. |
| `ProcessManager.Endpoint<Self>()(Group, { baseUrl })` | Injectable endpoint service with an inline base URL for simple examples/tests. |
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

const RemoteGroupsFromConfig = ProcessManager.ConnectionRegistry.layerConfig(
  [BillingGroup] as const,
  {
    [BillingGroup.id]: Config.string("BILLING_GROUP_BASE_URL"),
  },
);

const program = Effect.gen(function* () {
  const billing = yield* ProcessManager.connect(BillingGroup);
  yield* billing.verifyContract;
  yield* billing.process(SyncBilling.id).runImmediately;
}).pipe(Effect.provide(RemoteGroupsLive));
```

The same registry powers registry-backed
`ProcessManager.Endpoint<Self>()(BillingGroup)` and
`ProcessManager.cli([BillingGroup, StripeGroup] as const)`.

Security boundary: current remote control is only appropriate for localhost or a
trusted private network. Do not expose `ControlService` / `ProcessManager`
targets directly to a non-private network. The current HTTP control surface does
not provide built-in authn/authz, TLS/mTLS, request signing, replay protection,
rate limiting, or audit logging. Future security layers should add authenticated
transport, operator identity, scoped permissions for read vs mutation controls,
request timestamps/nonces, and audit records for every remote command before
public-network deployment is considered safe.

CLI commands accept canonical ids such as
`@repo/north-west/BillingGroup/SyncInvoices` and normalized suffix aliases such
as `north-west/billing-group/sync-invoices` or `sync-invoices`. Ambiguous
aliases fail with the minimum kebab-case suffix for each canonical candidate.
The CLI supports `groups`, `ls`, `verify`, `status <target>`, process `start` /
`stop` / `restart` / `now`, and queue `pause` / `resume` / `clear`.
All target-taking commands use the same resolver, so canonical ids and
normalized suffix aliases work for status, process controls, and queue controls.
`--json` output is available for `groups`, `ls`, `verify`, and
`status <target>`.
Before issuing a remote status/control request, target-taking commands check the
selected contract entry exposes the requested control. `status <target>` checks
`status`; `now` checks for `runImmediately`; queue commands check `pause`,
`resume`, or `clear`. If a process contract only exposes `status`,
`now <target>` fails locally before any HTTP request. If a queue contract lacks
`clear`, `clear <target>` fails the same way.
Remote queue `add`, `enqueue`, `prioritize`, and `defer` remain unsupported.

---

## `ProcessStore` / `RuntimeStorage` boundary

`ProcessStore` is the rich module-facing singleton facade. Runtime modules such
as `Process`, `QueueResource`, `RunResource`, `HttpApiResource`, and
`ProcessGroup` should depend on `ProcessStore`, not on storage adapters.

`RuntimeStorage` is the generic swappable persistence port underneath
`ProcessStore` (see `src/RuntimeStorage.ts` and
[RUNTIME-STORAGE-ADAPTER-GUIDE.md](./RUNTIME-STORAGE-ADAPTER-GUIDE.md)). The
default in-memory store and the SQLite adapter (`@nikscripts/effect-pm/storage/sqlite`,
`layerProcessStore`) both use `ProcessStore.layerRuntimeStorage`. Adapters persist
normalized `RuntimeRecord` rows; `ProcessStore` facets (`GroupLog`, `QueueResource`,
`runtime` projections) map module operations onto those rows. The optional Prisma
export is not a full store yet (`PrismaProcessStoreUnavailableError` on read paths).

The current bridge writes runtime facts and state changes through today's
`ProcessStore` analytics event envelope as `runtime.fact.recorded` and
`runtime.state.changed` events.

Dependency direction:

```text
runtime module -> ProcessStore -> RuntimeStorage -> memory / Prisma / custom
```

`ProcessStore.events(query)` reads generic analytics events across memory,
file-backed, and Prisma stores. Dedicated queue completion/lifecycle reads and
runtime projections are implemented on top of the same event stream. Queue
schema validation, remote queue enqueue, release, and handoff remain later
phases.

File-backed storage is local-process oriented and append-only: each encoded
analytics row is written as one NDJSON line for a single local runtime/process.
Reads decode valid rows and skip malformed lines, so a bad local row does not
poison the whole file.

```typescript
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Layer } from "effect";
import { ProcessStore, RuntimeObserver } from "@nikscripts/effect-pm";
import { fileLayer } from "@nikscripts/effect-pm/storage/file";

const filePath = ".tmp/effect-pm/events.ndjson";
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const storeLayer = fileLayer(filePath);
const observerLayer = Layer.provide(
  RuntimeObserver.layerFromProcessStore,
  storeLayer,
);

const program = Effect.gen(function* () {
  const store = yield* ProcessStore;
  const events = yield* store.events({
    types: ["runtime.fact.recorded"],
  });

  yield* Effect.log(`runtime facts: ${String(events.length)}`);
});

void Effect.runPromise(program.pipe(
  Effect.provide(Layer.mergeAll(storeLayer, observerLayer)),
  Effect.provide(platform),
));
```

For durable **normalized `RuntimeRecord` rows** (the `RuntimeStorage` contract),
use `@nikscripts/effect-pm/storage/sqlite` and compose
`ProcessStore.layerRuntimeStorage` with `SQLiteRuntimeStorage.layer` or
`SQLiteRuntimeStorage.make` (under an ambient `Scope`, typically via
`Effect.scoped` or `it.live`). See [RUNTIME-STORAGE-ADAPTER-GUIDE.md](./RUNTIME-STORAGE-ADAPTER-GUIDE.md).

---

## `RuntimeObserver` (runtime facts/state)

| Member | Role |
|--------|------|
| `RuntimeRef` | Stable `{ kind, id }` identity for a runtime component. |
| `RuntimeStateBase` | Base shape for live state snapshots with `ref`, `observedAt`, and `configVersion`. |
| `RuntimeStateChange` | Generic transition record with previous/current state. |
| `RuntimeFact` | Generic discrete runtime occurrence payload. |
| `RunResourceState` | Live `RunResource` counters for waiting, in-flight, completed, failed, interrupted, and total duration. |
| `RuntimeFactRecordedEvent` | ProcessStore analytics event wrapping a persisted `RuntimeFact`. |
| `RuntimeStateChangedEvent` | ProcessStore analytics event wrapping a persisted `RuntimeStateChange`. |
| `RuntimeObserver` | Optional service for publishing runtime facts and state changes. |
| `RuntimeObserver.publishFact(fact)` | Publishes a fact when the service is present; otherwise no-ops. |
| `RuntimeObserver.publishStateChange(change)` | Publishes a state transition when the service is present; otherwise no-ops. |
| `RuntimeObserver.layerFromProcessStore` | Observer layer that persists runtime facts and state changes through `ProcessStore`. |
| `RuntimeObserver.layerProcessStore` | **Deprecated** alias of `layerFromProcessStore` (name collided with sqlite `layerProcessStore`). |
| `RuntimeObserver.layerListeners(listeners)` | Observer layer that forwards facts/state changes to scoped listeners and isolates listener failures. |
| `ProcessStore.runtime.facts(query)` | Generic projection over persisted `runtime.fact.recorded` events. |
| `ProcessStore.runtime.stateHistory({ ref, opts })` | Generic projection over persisted `runtime.state.changed` events. |
| `ProcessStore.runtime.latestState(ref)` | Latest persisted runtime state snapshot for a runtime ref. |
| `ProcessStore.runResource.history(resourceId, opts)` | RunResource-specific fact history projection backed by `runtime.facts`. |

`RunResource` publishes `run-resource.run.started`,
`run-resource.run.completed`, and `run-resource.run.failed` facts plus
`RunResourceState` transitions for waiting, started, completed, failed, and
interrupted runs when `RuntimeObserver` is provided. Observation is optional:
when no `RuntimeObserver` service is in the environment, publish helpers no-op
and the gated effect behavior is unchanged.

When `RuntimeObserver.layerFromProcessStore` is provided, runtime facts are
persisted through `ProcessStore` as `runtime.fact.recorded` analytics events.
Memory and SQLite-backed `RuntimeStorage` support those generic events through
`ProcessStore.events(query)`. Prefer `layerProcessStore` from
`@nikscripts/effect-pm/storage/sqlite` for durable local storage.
`ProcessStore.GroupLog` covers structured group log history; capture/relay uses
`@nikscripts/effect-pm/Logs`. `@nikscripts/effect-pm/storage/file` and
`ProcessStore.fileLayer` are **legacy** NDJSON compatibility only — do not use for new code.
State changes are persisted as `runtime.state.changed` events when
`RuntimeObserver.layerFromProcessStore` is provided. `ProcessStore.runtime.stateHistory(...)`
and `ProcessStore.runtime.latestState(...)` derive state projections from the
same generic event stream.
`RuntimeObserver.layerListeners(...)` can observe both facts and state changes
without persistence. Multiple listeners can observe the same event, and listener
failures are ignored so runtime mutations continue unchanged. Stream helpers are
still planned.
`ProcessStore.runtime.facts(query)` and `ProcessStore.runResource.history(...)`
derive projections from generic event reads; they do not add adapter-specific
storage APIs.

---

## Runnable examples in this repo

Examples are split into **forms** (one API shape) and **scenarios** (compositions). See [examples/README.md](../examples/README.md).

| File | Focus |
|------|--------|
| [examples/scenarios/full-process-group-with-queues-and-control-cli.ts](../examples/scenarios/full-process-group-with-queues-and-control-cli.ts) | Full `ProcessGroup` + queues + `ControlService.make` + `awaitShutdown` + root `Layer.mergeAll`. |
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
