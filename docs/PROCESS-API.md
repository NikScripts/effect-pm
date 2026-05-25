# Process, polling, and schedule — API reference

This document complements the [README](../README.md) with a concise **spec-style** overview of the effect-first process stack (`Process`, `Polling`, `ProcessSchedule`, disarmed idle policy, and `ProcessGroup` lifecycle). For **when schedules run vs `ProcessGroup.start`**, **API-driven gates**, and **disarm vs `ProcessGroup.stop`**, see [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md).

---

## Mental model

| Piece | Role |
|--------|------|
| **`Process`** | Builds `process.effect`: a long-lived **schedule driver** forked by `ProcessGroup`. Each schedule entry can spawn one run instance. |
| **`ProcessSchedule`** | Stores run windows (`startAt`, optional `stopAt`, optional `id`) and notifies the driver when entries change. |
| **`Polling`** | **Cadence** between repeats inside a running instance (`awaitNextTick` → user `effect` → `afterTick`). |
| **Storage facets** | Optional analytics: execution rows + lifecycle events via `ProcessStorage` / durable adapters. |
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
| `effect` | yes | `Effect<void, E, R>` — one **tick** body; failures logged + recorded when storage facets are provided. |
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

Typical control (requires the group’s `R` plus storage facets where applicable):

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
import { ProcessStoreRunResource } from "@nikscripts/effect-pm/store/RunResource";

const program = Effect.gen(function* () {
  const runs = yield* ProcessStoreRunResource;
  const facts = yield* runs.facts({ resourceId: "examples/Gate" });
  yield* Effect.log(`run-resource facts: ${String(facts.length)}`);
});

void Effect.runPromise(program.pipe(Effect.provide(ProcessStorage.layer)));
```

The removed monolith service (`yield* ProcessStore`, `ProcessStore.events`,
`ProcessStore.file`, `@nikscripts/effect-pm/storage/file`) is intentionally not
documented as a compatibility path.

---

## `ProcessStoreRunResource` (RunResource facts/state)

> The legacy generic `ProcessStoreRuntime` facet and its `RuntimeFact` /
> `RuntimeRef` / `RuntimeStateChange` / `RuntimeStateBase` vocabulary,
> together with the previous `FactEnvelope` plumbing module, have been
> removed. Each storage facet — `ProcessStoreRunResource`,
> `ProcessStoreQueueResource`, … — now owns its own per-domain facet
> with concrete typed shapes and its own `RuntimeRecord` codec.

| Member | Role |
|--------|------|
| `RunResourceRef` | Stable `{ kind: "@nikscripts/effect-pm/RunResource", id }` identity for a RunResource. |
| `RunResourceState` | Live counters for waiting, in-flight, completed, failed, interrupted, and total duration. |
| `RunResourceStateChange` | Transition record with previous/current `RunResourceState`. |
| `RunResourceRunStartedFact` / `RunResourceRunCompletedFact` / `RunResourceRunFailedFact` | Concrete per-event payload types. |
| `RunResourceFact` | Union of the three concrete fact types. |
| `ProcessStoreRunResource` | Storage facet for RunResource facts and state changes (replaces the removed `ProcessStoreRuntime` and `RuntimeObserver`). |
| `ProcessStoreRunResource.Type` / `.EmitType` | Type accessors merged via declaration namespace — full service shape / record-section emit shape. Use to type custom `Layer.succeed` / `provideService` mocks. |
| `ProcessStoreRunResource.recordRunStarted(fact)` | Static optional emitter — silent no-op when the facet is absent; persistent write when present. The builder wraps every static emitter with a built-in `catchCause + logWarning` so failures never propagate. |
| `ProcessStoreRunResource.recordRunCompleted(fact)` / `recordRunFailed(fact)` | Same isolation semantics for the other lifecycle facts. |
| `ProcessStoreRunResource.recordStateChange(change)` | Static optional emitter for state transitions; same isolation semantics. |
| `ProcessStoreRunResource.recordFactBatch(facts)` / `recordStateChangeBatch(changes)` | Batched optional emitters. |
| `ProcessStoreRunResource.layerRuntimeStorage` / `.layer` | Facet over injected `RuntimeStorage` (or in-memory `layer`). |
| `(yield* ProcessStoreRunResource).facts({ resourceId, runId?, types? })` | Per-domain projection over persisted `run-resource.fact.recorded` events. |
| `(yield* ProcessStoreRunResource).stateHistory({ resourceId })` | Per-domain projection over persisted `run-resource.state.changed` events. |
| `(yield* ProcessStoreRunResource).latestState(resourceId)` | Latest persisted `RunResourceState` snapshot for a resource. |
| `(yield* ProcessStoreRunResource).runs(resourceId)` | Paired started + ended (completed / failed) history per run. |
| `(yield* ProcessStoreRunResource).byRun(runId)` | All facts for one specific run, ordered. |

`RunResource` publishes `run-resource.run.started`,
`run-resource.run.completed`, and `run-resource.run.failed` facts plus
`RunResourceState` transitions for waiting, started, completed, failed, and
interrupted runs through `ProcessStoreRunResource.recordRunStarted` /
`recordRunCompleted` / `recordRunFailed` / `recordStateChange`. Observation
is optional: when no `ProcessStoreRunResource` service is in the
environment, the static emitters no-op and the gated effect behavior is
unchanged.

When `ProcessStoreRunResource.layerRuntimeStorage` (or the full-stack
`ProcessStorage.layerRuntimeStorage` / `layerProcessStore` from
`@nikscripts/effect-pm/storage/sqlite`) is composed, facts and state changes
are persisted as `run-resource.fact.recorded` / `run-resource.state.changed`
analytics events. `ProcessStoreLog` covers structured log
history; capture/relay uses `@nikscripts/effect-pm/Logs`.

For in-process listeners (no durability), provide a custom service typed as
`ProcessStoreRunResource.Type` via `Effect.provideService` or
`Layer.succeed` that fans out to scoped callbacks (see
`examples/forms/resource/run-resource-runtime-observer.ts`). A planned
`ProcessStoreRunResource.live(resourceId): Stream<...>` projection will
replace the custom-service pattern with a proper subscription stream.

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
