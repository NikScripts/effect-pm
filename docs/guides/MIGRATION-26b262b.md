# Migration guide: `26b262b` -> current `main`

This guide helps upgrade code written against commit **`26b262b`**
(`test: document process-enqueued refill trigger`, 2026-05-18 UTC) to current
`main` at **`50ad1ac`**.

The range is **85 commits**. This is not a changelog; it focuses on code and
data changes app authors are likely to touch.

## Companion Docs

Use these current API docs while migrating:

| Topic | Guide |
| --- | --- |
| Processes | [process.md](./process.md) |
| Queues | [queue-resource.md](./queue-resource.md) |
| Groups | [process-group.md](./process-group.md) |
| Operators | [process-manager.md](./process-manager.md) |
| Endpoints | [process-manager-endpoints.md](./process-manager-endpoints.md) |
| HTTP control plane | [control-plane.md](./control-plane.md) |
| Persistence | [../STORAGE.md](../STORAGE.md) |

## Summary

The biggest change is that runtime observation and operator APIs were made
more explicit. Processes and queues now prefer positional factory overloads,
ProcessManager owns a group-catalog CLI with child launch and structured logs,
and persistence moved from a monolithic `ProcessStore`/file store shape to
`RuntimeStorage` plus per-domain `store/*` facets.

Treat this upgrade as **semver-major** if you publish it downstream. The range
contains removed APIs, removed package subpaths, renamed wire event types, and
storage rows that may need migration.

## Upgrade Checklist

- [ ] Align Effect packages from `^4.0.0-beta.65` to `^4.0.0-beta.69`.
- [ ] Replace `Process.providePolling` / `Process.provideSchedule` with
      inline `polling` / `schedule` config or positional layers.
- [ ] Replace `Polling.acceleratingScoped` and `acceleratingWithRefs` with
      `Polling.accelerating`.
- [ ] Remove queue `persist`, `refill`, `onEmpty`, and `handle.refill()`;
      remap behavior to `onDrained`, `onEnqueued`, `onStart`, or explicit app
      storage.
- [ ] Rename queue hooks: `onEnqueue` -> `onEnqueued`, `onComplete` ->
      `onCompleted`.
- [ ] Move imports from removed storage subpaths (`storage/file`,
      `store/Runtime`, `store/GroupLog`, legacy facet subpaths) to the current
      `RuntimeStorage`, `ProcessStorage`, and `store/*` modules.
- [ ] Replace static facet reads (`ProcessStoreX.facts(...)`,
      `ProcessStoreX.executions(...)`, etc.) with service reads via
      `yield* ProcessStoreX` or `Effect.serviceOption(ProcessStoreX)`.
- [ ] Replace `ProcessStore.layer` / file-backed stores with
      `ProcessStorage.layer`, `ProcessStorage.layerRuntimeStorage`, or
      `layerProcessStore({ filename })` from `@nikscripts/effect-pm/storage/sqlite`.
- [ ] If you stored durable log rows, migrate or discard rows with
      `type: "group.log.entry"` before reading them as `ProcessStoreLog`.
- [ ] Update ProcessManager group endpoint config to
      `Endpoint.local(transport, entry)`, `Endpoint.production(transport)`, or
      `Endpoint.define(label, transport)`.
- [ ] Replace old `pm group-start` / `pm group-stop` / `pm queue-start`
      assumptions with unified `pm start <target>` and `pm stop <target>`.
- [ ] Run `ProcessManager.cli verify` against deployed control endpoints.
- [ ] Run `pnpm run typecheck`, `pnpm test`, `pnpm run lint`, and
      `pnpm run build`.
- [ ] Add or update a changeset before publishing this migration.

## Package and Toolchain

### Effect Peer Range

| Dependency | `26b262b` | Current |
| --- | --- | --- |
| `effect` peer | `^4.0.0-beta.65` | `^4.0.0-beta.69` |
| `@effect/platform-node` | `4.0.0-beta.65` | `4.0.0-beta.69` |
| `@effect/vitest` | `4.0.0-beta.65` | `4.0.0-beta.69` |

Upgrade Effect and `effect-pm` together. Mixed beta ranges are likely to show
up as type incompatibilities before runtime.

### Export Changes

New or promoted public subpaths:

| Subpath | Purpose |
| --- | --- |
| `@nikscripts/effect-pm/RuntimeStorage` | Generic row storage contract |
| `@nikscripts/effect-pm/ProcessStorage` | Combined built-in storage facets |
| `@nikscripts/effect-pm/Query` | Runtime record predicate/query builders |
| `@nikscripts/effect-pm/Logs` | Process-manager log capture/relay |
| `@nikscripts/effect-pm/store/QueueResource` | Queue storage facet |
| `@nikscripts/effect-pm/store/RunResource` | RunResource storage facet |
| `@nikscripts/effect-pm/store/Log` | Structured log storage facet |
| `@nikscripts/effect-pm/store/ProcessLifecycle` | Process lifecycle facet |
| `@nikscripts/effect-pm/store/ProcessGroup` | Process group/member lifecycle facet |
| `@nikscripts/effect-pm/store/ProcessExecution` | Process execution facet |
| `@nikscripts/effect-pm/storage/sqlite` | SQLite `RuntimeStorage` adapter |

Removed or replaced subpaths:

| Old subpath/API | Replacement |
| --- | --- |
| `@nikscripts/effect-pm/storage/file` | `@nikscripts/effect-pm/storage/sqlite` |
| `@nikscripts/effect-pm/store/Runtime` | `@nikscripts/effect-pm/store/RunResource` |
| `@nikscripts/effect-pm/store/GroupLog` | `@nikscripts/effect-pm/store/Log` |
| `./ProcessStoreGroupLog` / `./ProcessStoreQueueResource` package subpaths | `store/Log` / `store/QueueResource` |
| `ProcessStoreBuilder` module | `ProcessStore.Service`, `ProcessStore.record`, `ProcessStore.read` |

The package now also publishes the `effect-pm-group-child` binary for
ProcessManager child launch.

## Process and Polling

### Positional `Process.make` / `Process.Service`

The config-object form still works and remains required for schedule
initializers. The preferred form is positional:

```typescript
// Before
const worker = Process.make("@app/Worker", {
  effect: Effect.logInfo("tick"),
  polling: Polling.spaced("5 seconds"),
  schedule: ProcessSchedule.alwaysArmed,
});

// After
const worker = Process.make(
  "@app/Worker",
  Effect.logInfo("tick"),
  Polling.spaced("5 seconds"),
  ProcessSchedule.alwaysArmed,
);
```

Polling and schedule layers may appear in either order as the third and fourth
arguments. Invalid layer-like arguments now fail at construction with
`ProcessMakeInvalidLayerArgument`.

### Removed Post-Hoc Layer Helpers

`Process.providePolling` and `Process.provideSchedule` are gone. Inline those
dependencies at creation time:

```typescript
// Before
const base = Process.make("@app/Worker", { effect: Effect.void });
const worker = Process.providePolling(base, Polling.spaced("1 second"));

// After
const worker = Process.make("@app/Worker", {
  effect: Effect.void,
  polling: Polling.spaced("1 second"),
});
```

### Polling Aliases

`Polling.acceleratingScoped` and `Polling.acceleratingWithRefs` were removed.
Use `Polling.accelerating`.

## QueueResource

### Positional Factories

`QueueResource.Service`, `QueueResource.layer`, and `QueueResource.make` now
support `(id, effect, options?)` or `(effect, options?)` shapes in addition to
the config object where applicable.

```typescript
// Before
class EmailQueue extends QueueResource.Service<EmailQueue, Email>()(
  "@app/EmailQueue",
  {
    effect: (email) => sendEmail(email),
    concurrency: 4,
  },
) {}

// After
class EmailQueue extends QueueResource.Service<EmailQueue, Email>()(
  "@app/EmailQueue",
  (email) => sendEmail(email),
  { concurrency: 4 },
) {}
```

### Hook and Refill Removal

Queue refill semantics were replaced with lifecycle hooks.

| Old API | Current API |
| --- | --- |
| `persist` enqueue option | App storage or `ProcessStoreQueueResource` analytics |
| `refill` config | `onDrained`, `onEnqueued`, `onStart`, or explicit app scheduling |
| `handle.refill()` | Enqueue directly through controls (`add`, `enqueue`, etc.) |
| `onEmpty` | `onDrained` |
| `onEnqueue` | `onEnqueued` |
| `onComplete(item, exit, elapsed)` | `onCompleted({ entry, elapsed }, controls)` |

`onDrained` means the queue became empty after work or `clear`. It is not a
cold-start idle trigger. If old `refill` code seeded work at boot, move that
seed into app startup, `onStart`, or a process that enqueues work.

Current lifecycle hooks include `onStart`, `onStarted`, `onExit`,
`onCompleted`, `onFailed`, `onRetryScheduled`, `onRetryExhausted`,
`onDrained`, `onCleared`, `onReleased`, `onDeadLettered`, and `onDropped`.
Hook failures are logged instead of silently disappearing.

```typescript
// Before
QueueResource.make({
  name: "@app/Inbox",
  effect: process,
  refill: (handle) =>
    handle.add(loadMoreFromDb()),
});

// After
QueueResource.make("@app/Inbox", process, {
  onDrained: (_event, controls) =>
    loadMoreFromDb().pipe(Effect.flatMap((items) => controls.add(items))),
});
```

### Schema-Backed Release

`QueueHandle.releaseEncoded` and remote queue `release` controls are available
when the queue has an `itemSchema`. In-process `release` behavior is otherwise
unchanged.

### Analytics Ordering Fixes

Queue analytics writes are now ordered before worker wakeups, and dedupe-key
release is recorded before retry hooks can re-enqueue the same key. If you
assert on stored event order, expect `queue.entry.enqueued` /
`queue.dedupe-key.added` to precede worker-side completion/release rows.

## ProcessGroup

### Typed Entries Remain the Target Shape

Use service entries in a literal tuple:

```typescript
export class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/Billing",
  [SyncInvoices, EmailQueue] as const,
) {}
```

`ProcessGroup.make({ queues, processes })` is legacy-compatible, but typed
contracts, `ProcessManager.verify`, remote layers, and queue item controls are
designed around `Process.Service` / `QueueResource.Service` entries.

### Endpoint Config Is Group Metadata

ProcessManager endpoints now belong on the group's third argument. The current
endpoint helpers are transport-first:

```typescript
import { Endpoint, ProcessGroup, Transport } from "@nikscripts/effect-pm";

const billingTransport = Transport.http(3001);

export class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/Billing",
  [SyncInvoices, EmailQueue] as const,
  [
    Endpoint.local(billingTransport, import.meta.url).default,
    Endpoint.production(billingTransport),
    Endpoint.define("staging", Transport.http("https://billing-staging.example.com")),
  ],
) {}
```

`ProcessManager.Config.layer(...)` can still override bundled group config for
tests or environment-specific CLIs.

### Local Runtime Wiring

For normal operator usage, `Endpoint.local(transport, entry)` points the child
launcher at a module that exports the group. The packaged child process imports
that module, finds the group by id, and builds the local runtime itself.

When embedding the same wiring manually, use `groupLocalRuntime`:

```typescript
export const BillingRuntime = ProcessManager.groupLocalRuntime(BillingGroup, {
  controlBaseUrl: "http://127.0.0.1:3001",
});
```

If you need custom layers without `groupLocalRuntime`, compose
`ProcessGroup.localEnvLayer` with `ControlService.layerHttp` yourself:

```typescript
const groupLayer = ProcessGroup.localEnvLayer(BillingGroup);
const controlLayer = ControlService.layerHttp(BillingGroup, { port: 3001 });
```

Older `Endpoint.module(...)` examples are stale for current `main`; use
`Endpoint.local(transport, entry)` where `entry` is a module URL/path such as
`import.meta.url`.

## ProcessManager and Control Plane

### CLI Command Changes

`ProcessManager.cli(groups)` now operates a group catalog. Current commands:

| Command | Notes |
| --- | --- |
| `groups` | Endpoint status for configured groups |
| `ls` | Processes and queues with contract controls |
| `verify` | Local contract vs remote contract |
| `status <target>` | Group, process, or queue status |
| `start <target>` | Starts a group child, process, or queue depending on target |
| `stop <target>` | Stops a group child or process; queues use pause/resume/clear |
| `restart <process>` / `now <process>` | Process controls |
| `pause` / `resume` / `clear` | Queue controls |
| `watch <target>` | Live structured logs |
| `logs [target]` | Stored structured log history |

Removed command assumptions:

| Old command | Current command |
| --- | --- |
| `group-start <group>` | `start <group>` |
| `group-stop <group>` | `stop <group>` |
| `queue-start <queue>` | `start <queue>` |

Use `--target <label>` to select a non-default endpoint label from group config.
Use `--no-watch` with `start <group>` when you want child launch without live log
tailing.

### Operator Layers

Operator CLIs need platform layers plus ProcessManager operator layers:

```typescript
const cli = ProcessManager.cli([BillingGroup] as const);

cli(process.argv).pipe(
  Effect.provide(Layer.mergeAll(
    NodeServices.layer,
    NodeHttpClient.layerUndici,
    ProcessManager.operatorLayer,
    ProcessManager.operatorLoggerLayer,
  )),
  NodeRuntime.runMain,
);
```

`createCli` / `runCli` still exist for simpler single-group control tools.
Use `ProcessManager.cli` for multi-group catalogs, target resolution, child
launch, `watch`, and `logs`.

### HTTP Protocol

`ControlService` still binds to `127.0.0.1`. Current clients use the protocol
envelope on `POST /control`; REST routes remain available for direct HTTP
scripts and contract inspection (`GET /contract`).

## Logs

Structured operator logs moved out of `ProcessStore` and into the `Logs`
capture/relay module plus the `ProcessStoreLog` storage facet.

Use `@nikscripts/effect-pm/Logs` for capture/relay:

```typescript
import { relayWithCaptureLoggerLayer } from "@nikscripts/effect-pm/Logs";
```

Use `@nikscripts/effect-pm/store/Log` for durable reads/writes:

```typescript
import { ProcessStoreLog } from "@nikscripts/effect-pm/store/Log";

const logs = yield* ProcessStoreLog;
const rows = yield* logs.load({
  groupId: "@app/Billing",
  limit: 50,
  sort: "desc",
});
```

Breaking rename:

| Old | Current |
| --- | --- |
| `ProcessStoreGroupLog` | `ProcessStoreLog` |
| `ProcessStoreGroupLogApi` | `ProcessStoreLogApi` |
| `makeProcessStoreGroupLog` | `makeProcessStoreLog` |
| `@nikscripts/effect-pm/store/GroupLog` | `@nikscripts/effect-pm/store/Log` |
| `group.log.entry` rows | `log.entry` rows |

Existing SQLite rows with `type: "group.log.entry"` do not decode as current
`ProcessStoreLog` entries. Migrate them to `log.entry` with the current payload
shape, or discard/rotate that store before upgrade.

## ProcessStore, ProcessStorage, and RuntimeStorage

### New Storage Model

Current storage has three layers:

1. `RuntimeStorage` stores generic `RuntimeRecord` rows.
2. Each public facet in `src/store/*` owns its domain codec, predicates, write
   methods, and read methods.
3. `ProcessStorage` composes all built-in facets.

For in-memory tests/dev:

```typescript
Effect.provide(program, ProcessStorage.layer);
```

For durable SQLite:

```typescript
import { Layer } from "effect";
import { ProcessStorage } from "@nikscripts/effect-pm";
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";

const storage = Layer.provide(
  ProcessStorage.layerRuntimeStorage,
  layerProcessStore({ filename: ".effect-pm/data.sqlite" }),
);
```

### Facet Reads Are Services, Not Static Methods

Static methods are emitters only. Reads now go through the service instance:

```typescript
// Before
const rows = yield* ProcessStoreRunResource.facts({ resourceId: "@app/cache" });

// After
const rows = yield* Effect.serviceOption(ProcessStoreRunResource).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeed([]),
      onSome: (store) => store.facts({ resourceId: "@app/cache" }),
    }),
  ),
);
```

For dominant identifiers, use the identifier-bound API:

```typescript
const queue = yield* ProcessStoreQueueResource.for("@app/EmailQueue");
const entries = yield* queue.entries({ opts: { limit: 100 } });

const runs = yield* ProcessStoreRunResource.for("@app/cache").runs();
const executions = yield* ProcessStoreProcessExecution
  .for("@app/Billing/SyncInvoices")
  .executions();
```

### Removed Monolith and Generic Event Surface

Removed:

- `ProcessStore.events(query)` as a cross-domain event reader.
- `ProcessStore.runtime` / `ProcessStore.runResource` namespaces.
- `RuntimeObserver`, `RuntimeObserver.layerFromProcessStore`,
  `RuntimeObserver.layerListeners`, `RuntimeObserver.publishFact`,
  `RuntimeObserver.publishStateChange`.
- `persistRuntimeObservation`.
- Generic public runtime types such as `RuntimeFact`, `RuntimeRef`,
  `RuntimeStateBase`, `RuntimeStateChange`, `RuntimeFactQuery`, and
  `RuntimeStateHistoryQuery`.
- `AnalyticsEvent` and `StoreEventQuery`.
- `EffectPmEventRow` / `EffectPmEventCreateInput` from the package root and
  `ProcessStoreEvent`.
- Prisma codec exports such as `decodeEventRow`, `encodeEvent`, and
  `PrismaProcessStoreDecodeError`.

Use per-domain facets and their concrete query types instead:

| Domain | Current facet |
| --- | --- |
| Queue analytics | `ProcessStoreQueueResource` |
| RunResource facts/state | `ProcessStoreRunResource` |
| Logs | `ProcessStoreLog` |
| Process executions | `ProcessStoreProcessExecution` |
| Process lifecycle | `ProcessStoreProcessLifecycle` |
| Process group/member lifecycle | `ProcessStoreProcessGroup` |

`ProcessStoreEvent` now only carries shared primitives such as `JsonValue`,
`QueryOpts`, `AnalyticsEventBase`, and storage write errors.

### Facet Authoring API

If you authored custom facets, replace `ProcessStoreBuilder` and old
`record((s) => api)` shapes with the current section DSL:

```typescript
export class ProcessStoreThing extends ProcessStore.Service<ProcessStoreThing>()(
  "@app/store/thing/ProcessStoreThing",
  ProcessStore.record({
    recordThing: (s) => (fact: ThingFact) => s.create(makeThingRecord(fact)),
  }),
  ProcessStore.read((s) => ({
    things: (query?: ThingQuery) =>
      s.read(runtimeRecordQuery(thingPredicates(query), query?.opts)).pipe(
        Effect.map(decodeThings),
      ),
  })),
) {}
```

`ProcessStore.record(...)` now takes an object literal of method factories. This
is required so static optional emitters can be typed without runtime
introspection.

### Storage Data Migration Notes

Durable row compatibility is not guaranteed across this range:

- `group.log.entry` was renamed to `log.entry`.
- Queue analytics moved to concrete row types such as `queue.entry.enqueued`,
  `queue.lifecycle.drained`, and `queue.dedupe-key.added`.
- RunResource uses `run-resource.fact.recorded` and
  `run-resource.state.changed`.
- The NDJSON/file store was removed.
- The Prisma adapter is no longer the current durable path; Prisma row codecs
  were removed while Prisma is being rebuilt as a `RuntimeStorage` adapter.

If old analytics are valuable, export them before upgrading, then write an
explicit one-off migration into the current `RuntimeRecord` shape. Otherwise,
rotate the old store and start fresh with SQLite `layerProcessStore`.

## Suggested Upgrade Order

1. Bump Effect and `@nikscripts/effect-pm`.
2. Fix compile errors from removed exports and renamed imports.
3. Migrate `Process` and `QueueResource` factories/hooks.
4. Migrate persistence wiring to `ProcessStorage` and current `store/*` facets.
5. Decide whether to migrate, archive, or discard old durable analytics rows.
6. Update ProcessManager endpoint config and CLI command usage.
7. Run `verify` against staged control endpoints.
8. Run the full repo checks.
9. Add a changeset and release notes pointing at this guide.

## Commit Map

| Area | Representative commits |
| --- | --- |
| Runtime record contract | `daf28a5`, `1c54b5c`, `0ff3793` |
| SQLite RuntimeStorage | `d26e7ca`, `d72dc6f`, `a8f213c`, `a6a593b` |
| Queue hooks/refill removal | `0535cdf`, `c7a6f54`, `3133cc1` |
| Queue release and analytics ordering | `9fcc360`, `425b636`, `185fc24` |
| Control protocol and ProcessManager | `2a3bdcc`, `587cd7b`, `44006a4` |
| Positional Process/Queue APIs | `7c0c37b`, `3aaa978` |
| Logs and PM watch/logs | `e4160cc`, `700c629`, `e4a11e2`, `8e54b0b` |
| Storage facet split | `ff1979c`, `f3bcbad`, `09be964`, `216a10f`, `3cfc25a` |
| Identifier-bound storage reads | `50ad1ac` |

Regenerate the raw range details with:

```bash
git log 26b262bf9948fc1244eeb2519dca67877b1f588c..HEAD --oneline
git diff --stat 26b262bf9948fc1244eeb2519dca67877b1f588c..HEAD
```
