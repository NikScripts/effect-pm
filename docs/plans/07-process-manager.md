# 07 - Typed ProcessGroup and remote ProcessManager

## Status

Partially implemented. Typed group entries, group contracts, contract-aligned
control routes, `ProcessManager.connect`, `ProcessManager.Endpoint`, and
`ProcessGroup.remoteLayer` have landed. Remote queue enqueue, `RemoteService`,
and multi-host deployment coordination remain planned.

## Intent

Redesign `ProcessGroup` around typed process/resource declarations with
canonical IDs, then let `ProcessManager` connect to groups over the network
using a contract derived from those declarations.

This plan supersedes the older idea that `ProcessManager` is the next design
center. `ProcessManager` still matters, but it can only be as type-safe as the
`ProcessGroup` contract it connects to.

## Core decisions

1. `ProcessGroup` is the local runtime interface for a set of processes and
   resources.
2. `ProcessManager` is remote-only relative to groups: it connects to group
   control endpoints over the network.
3. Process, resource, and group declarations each have exactly one canonical
   ID.
4. Do not add secondary IDs in `ProcessGroup` registration.
5. `ProcessGroup` should capture type signatures from the entries it receives:
   process IDs, queue item types, status shapes, and capabilities.
6. `ProcessGroup` exposes a contract that a remote `ProcessManager` can import
   for IDE autocomplete and compile-time safety.
7. The remote protocol must validate runtime payloads with schemas where user
   data crosses the network.

## Current gaps

Current `ProcessGroup.make` takes separate `processes` and `queues` arrays and
returns methods that accept plain `string` names. That loses autocomplete and
lets typos compile.

```typescript
const group = yield* ProcessGroup.make({
  processes: [emailSync, dataPoller],
  queues: [EmailQueue, NotificationQueue],
});

yield* group.start("emailSync");
yield* group.pauseQueue("EmailQueue");
```

Process and queue identity are also inconsistent today:

- `Process` has a `name` field.
- `QueueResource.Service` uses a `Context.Service` key as identity.
- `ProcessGroup` stores queues by `queueTag.key`.

The target model should make identity consistent without forcing every process
to become a service.

## Canonical runtime declarations

Start with a small shared declaration shape. This is the type-level contract
`ProcessGroup` needs to infer IDs and capabilities.

```typescript
export interface RuntimeEntry<Id extends string, Kind extends string> {
  readonly id: Id;
  readonly kind: Kind;
}
```

Processes are canonical services. A process is more than an effect: it is a
trackable runtime unit with external controls, status, hooks/listeners, and
future config mutation.

```typescript
export interface ProcessServiceDefinition<Self, Id extends string, R>
  extends Context.ServiceClass<Self, Id, Process<R>>,
    RuntimeEntry<Id, "process"> {
  readonly effect: Effect.Effect<void, never, R>;
  readonly layer: Layer.Layer<Self>;
  readonly contract: ProcessContract<Id>;
}
```

Queue/resource services follow the same canonical-entry rule:

```typescript
export interface QueueServiceDefinition<Self, Id extends string, T, R, E>
  extends Context.ServiceClass<Self, Id, QueueHandle<T, R, E>>,
    RuntimeEntry<Id, "queue"> {
  readonly tag: Context.Key<unknown, QueueHandle<T, R, E>>;
  readonly layer: Layer.Layer<Self>;
  readonly contract: QueueContract<Id, T>;
}
```

The important rule: `id` comes from the declaration itself.

```typescript
class StripeSync extends Process.Service<StripeSync>()("@app/StripeSync", {
  effect: syncStripe,
}) {}

class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()("@app/EmailQueue", {
  effect: sendEmail,
  itemSchema: EmailSchema,
}) {}

StripeSync.id; // "@app/StripeSync"
EmailQueue.id; // "@app/EmailQueue"
```

## Naming convention

Use Effect-style names consistently:

- `make` builds/acquires a runtime handle.
- `Service` declares canonical service identity plus implementation/layer.
- `Tag` declares identity only.
- `layer` provides an implementation.
- `contract` is the schema-backed serializable remote/control description.

Do not use `define` for runtime entries. It is too close to a pure spec concept,
and this design intentionally avoids separate specs for processes/resources.

Processes and resources are both services because both can be yielded for
controls, status, listeners, and future config mutation:

```typescript
const queue = yield* EmailQueue;
yield* queue.add(email);

const stripe = yield* StripeSync;
yield* stripe.runImmediately();
```

## Preferred PG usage: direct make plus optional service

Use one entries tuple. Do not split `processes` and `resources`, and do not add
registration IDs.

```typescript
const billing = yield* ProcessGroup.make(
  "@app/BillingGroup",
  [StripeSync, InvoiceSweep, EmailQueue, InvoiceQueue] as const,
);
```

Direct use should not require providing a layer:

```typescript
yield* billing.start(StripeSync);
yield* billing.runImmediately(InvoiceSweep);
yield* billing.queue(EmailQueue).pause;
yield* billing.queue(InvoiceQueue).enqueue({ invoiceId: "inv_123" });
```

Use `ProcessGroup.Service` when the group itself should be injectable:

```typescript
class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/BillingGroup",
  [StripeSync, InvoiceSweep, EmailQueue, InvoiceQueue] as const,
) {}
```

This gives both styles:

- direct `ProcessGroup.make(id, entries)` for local composition and examples;
- `.layer` / service access for singleton group injection, `ControlService`,
  tests, and hosted agents.

## Class-based PG service variant

The class form is the canonical injectable group model.

```typescript
class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/BillingGroup",
  [StripeSync, InvoiceSweep, EmailQueue, InvoiceQueue] as const,
  { autoStart: true },
) {}
```

Usage:

```typescript
const program = Effect.gen(function* () {
  const billing = yield* BillingGroup;

  yield* billing.process(StripeSync).restart;
  yield* billing.queue(EmailQueue).pause;
  yield* billing.queue(InvoiceQueue).enqueue({ invoiceId: "inv_123" });
});

yield* program.pipe(Effect.provide(BillingGroup.layer));
```

Why a group service can be useful:

- `ControlService` can depend on a group service instead of receiving a value
  manually.
- Tests can provide a fake group.
- A local agent process can host several group services.
- A web server can yield the group and expose its controls.
- The group becomes the singleton local controller for its runtime entries.

The service form should not be the only form. `ProcessGroup.make(id, entries)`
should remain the lowest ceremony path.

## Type inference model

The group handle should infer valid process and queue entries from the tuple.

```typescript
type RuntimeDefinition =
  | ProcessDefinition<string, unknown>
  | QueueDefinition<string, unknown, unknown, unknown>;

type ProcessEntries<Entries extends readonly RuntimeDefinition[]> =
  Extract<Entries[number], { readonly kind: "process" }>;

type QueueEntries<Entries extends readonly RuntimeDefinition[]> =
  Extract<Entries[number], { readonly kind: "queue" }>;

type QueueItem<Q> =
  Q extends QueueDefinition<string, infer T, unknown, unknown> ? T : never;
```

Candidate handle:

```typescript
export interface TypedProcessGroup<
  Id extends string,
  Entries extends readonly RuntimeDefinition[],
> {
  readonly id: Id;

  readonly start: <P extends ProcessEntries<Entries>>(
    process: P,
  ) => Effect.Effect<void>;

  readonly stop: <P extends ProcessEntries<Entries>>(
    process: P,
  ) => Effect.Effect<void>;

  readonly runImmediately: <P extends ProcessEntries<Entries>>(
    process: P,
  ) => Effect.Effect<void>;

  readonly process: <P extends ProcessEntries<Entries>>(
    process: P,
  ) => ProcessControls<P>;

  readonly queue: <Q extends QueueEntries<Entries>>(
    queue: Q,
  ) => QueueControls<Q, QueueItem<Q>>;

  readonly status: Effect.Effect<GroupStatus<Entries>>;
  readonly contract: ProcessGroupContract<Id, Entries>;
}
```

Compile-time expectations:

```typescript
yield* billing.start(StripeSync);
yield* billing.queue(EmailQueue).enqueue({ to: "ops@example.com" });

// should not compile: queues are not process controls
yield* billing.start(EmailQueue);

// should not compile: invoice jobs are not emails
yield* billing.queue(EmailQueue).enqueue({ invoiceId: "inv_123" });
```

## Local communication

Inside a single process, resources should communicate through normal Effect
dependencies and direct handles.

```typescript
class StripeSync extends Process.Service<StripeSync>()("@app/StripeSync", {
  effect: Effect.gen(function* () {
    const emails = yield* EmailQueue;
    const invoices = yield* InvoiceQueue;

    const changed = yield* syncStripe;
    yield* emails.add(changed.email);
    yield* invoices.add({ invoiceId: changed.invoiceId });
  }),
}) {}
```

`ProcessGroup` should not become a private message bus for normal app work. It
is the lifecycle/control/status interface for the runtime entries.

### Group membership is control exposure, not dependency wiring

Normal Effect dependencies do not need group registration. A process can depend
on any queue, process helper, resource, API client, store, or domain service
through the environment whether or not that dependency appears in the group.

Passing an entry to `ProcessGroup.make(id, entries)` or
`ProcessGroup.Service(id, entries)` means the group owns a control/status view
for that entry:

- the entry appears in the group contract;
- local group controls can target it;
- `ControlService` can expose its supported controls;
- `ProcessManager` can control it remotely through the group endpoint.

The group should accept every runtime entry family that can expose the group
control contract: processes, queues, and future resources. The minimum contract
for group membership is a canonical `id`, a `kind`, serializable control/status
metadata, and a local adapter the group can call for supported controls.

This is separate from standalone remote service access. To yield the entry
itself from the Effect environment and have that yielded service be swappable
between local and remote providers, the entry must use the `RemoteService`
constructor for its runtime family.

## Remote ProcessManager contract

`ProcessManager` only connects to groups over a network. It should consume the
group service value when that class is available at runtime, because the class
already carries the schema-backed contract. Raw contracts are still useful for
generated clients that cannot import the group class.

```typescript
const billing = ProcessManager.connect(BillingGroup, {
  url: "https://billing.internal",
});

yield* billing.start(StripeSync.id);
yield* billing.queue(InvoiceQueue.id).pause;
```

The local PG can accept declarations:

```typescript
yield* billing.queue(InvoiceQueue).enqueue(job);
```

The remote PM should use canonical IDs from the contract:

```typescript
yield* billing.queue("@app/InvoiceQueue").enqueue(job);
```

If the app imports the declaration, it can still avoid spelling strings:

```typescript
yield* billing.queue(InvoiceQueue.id).enqueue(job);
```

Generated/remote-only clients can use a raw contract value:

```typescript
const billing = ProcessManager.connect({
  url: "https://billing.internal",
  contract: BillingGroup.contract,
});
```

## Contract shape

The contract must be serializable. It cannot contain functions, live Effect
values, fibers, or service tags.

```typescript
export interface ProcessGroupContract<
  Id extends string,
  Entries extends readonly RuntimeDefinition[],
> {
  readonly id: Id;
  readonly version: string;
  readonly processes: ReadonlyArray<ProcessContract<string>>;
  readonly queues: ReadonlyArray<QueueContract<string, unknown>>;
  readonly resources: ReadonlyArray<ResourceContract<string>>;
}
```

Process contract:

```typescript
export interface ProcessContract<Id extends string> {
  readonly id: Id;
  readonly kind: "process";
  readonly controls: ReadonlyArray<
    | "start"
    | "stop"
    | "restart"
    | "runImmediately"
    | "status"
    | "quiesce"
  >;
}
```

Queue contract:

```typescript
export interface QueueContract<Id extends string, Item> {
  readonly id: Id;
  readonly kind: "queue";
  readonly controls: ReadonlyArray<
    | "enqueue"
    | "pause"
    | "resume"
    | "clear"
    | "drain"
    | "release"
    | "status"
  >;
  /** Present when the queue declares itemSchema; absent otherwise */
  readonly item?: QueueItemCodecDescriptor;
}
```

`QueueItemCodecDescriptor` is defined in
[02 - Queue controls, schema, handoff, and lifecycle hooks](./02-queue-controls-and-hooks.md).
Local queue services keep the full `Schema.Schema<Item, Encoded, never>` on the
declaration; contract generation calls `JSONSchema.make(itemSchema)` and exports
only the descriptor. Do not put live `Schema` values on the wire.

Remote enqueue prerequisites (do not implement PM enqueue until these exist):

1. **Queue declaration** — `QueueResource.Service` (or layer config) supplies
   `itemSchema`. Queues without it do not get `"enqueue"` on the contract.
2. **Contract slice** — `ProcessGroupQueueContract` includes optional `item`
   descriptor; `GET /contract` returns it for discovery and drift checks.
3. **Control route** — `POST /queues/:id/enqueue` accepts JSON `unknown`, runs
   `Schema.decodeUnknown(targetItemSchema)` on the **target** queue, then calls
   `QueueHandle.enqueue`. Return 400 with `QueueItemValidationError` /
   `QueueBatchValidationError` JSON on failure.
4. **PM client** — `RemoteQueueControls.enqueue` is generic over contract queue
   entries that have `item`; encodes with the imported `itemSchema` before POST;
   surfaces validation errors from 4xx bodies.
5. **Handoff** — `enqueueReleased` uses `payload` + partial batch mode (plan 02).

Queue enqueue, release, and handoff controls depend on
[02 - Queue controls, schema, handoff, and lifecycle hooks](./02-queue-controls-and-hooks.md).
Do not add remote enqueue to `ProcessManager` until queue contracts describe
`QueueItemCodecDescriptor` and the target queue validates with `itemSchema`.

## Remote client shape

The PM client should mirror local group controls, but all operations are network
requests.

Initial implementation can use the local `ControlService` HTTP routes because
they already exist and are easy to inspect from curl/CLI tools. For the richer
multi-host ProcessManager transport, evaluate Effect RPC before inventing a
custom protocol. Effect exposes `Rpc`, `RpcGroup`, `RpcClient`, and `RpcServer`
under `effect/unstable/rpc`, which may be a better fit once group contracts,
queue schemas, streaming status, and handoff payloads are stable.

```typescript
const billing = ProcessManager.connect(BillingGroup, {
  url: "https://billing.internal",
});

yield* billing.process(StripeSync.id).restart;
yield* billing.queue(EmailQueue.id).pause;
yield* billing.queue(InvoiceQueue.id).enqueue({ invoiceId: "inv_123" });
```

Remote queue controls (enqueue requires contract `item` descriptor):

```typescript
export interface RemoteQueueControls<Item, ItemSchema extends Schema.Schema<Item, any, any>> {
  readonly enqueue: {
    (item: Item): Effect.Effect<void, ProcessManagerRequestError | QueueItemValidationError, HttpClient.HttpClient>
    (
      items: ReadonlyArray<Item>,
      options?: { readonly mode?: "atomic" | "partial" },
    ): Effect.Effect<void, ProcessManagerRequestError | QueueBatchValidationError, HttpClient.HttpClient>
  }
  readonly pause: Effect.Effect<void, ProcessManagerRequestError, HttpClient.HttpClient>;
  // …
}
```

Only queues whose contract entry includes `item` get `enqueue` on the remote
handle. The client encodes with the same `itemSchema` used at declaration; the
server decodes with the target runtime schema (see plan 02).

Remote compile-time expectations:

```typescript
// should not compile: unknown group member
yield* billing.process("@app/MissingProcess").start;

// should not compile if queue item schema/type is imported in the contract
yield* billing.queue(InvoiceQueue.id).enqueue({ to: "ops@example.com" });
```

Runtime validation is still required because network callers may not be typed.

## Endpoint services and bundled remote layers

The long-term remote DX should use Effect layers instead of making application
code call `ProcessManager.connect` everywhere. The service key stays the same;
the provided layer decides whether the implementation is local, mocked, or
network-backed.

### Endpoint service

First introduce a remote endpoint service. It stores remote connection config,
the group contract, and future transport/auth/retry settings in one place.

```typescript
class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
  BillingGroup,
  {
    baseUrl: "https://billing.internal",
  },
) {}
```

The endpoint yields a typed remote manager:

```typescript
const billing = yield* BillingEndpoint;

yield* billing.verifyContract;
yield* billing.process(StripeSync.id).runImmediately;
yield* billing.queue(EmailQueue.id).pause;
```

This avoids repeating `baseUrl` and gives later auth/RPC middleware a single
home.

### Resolved remote layer decisions

Use Effect's normal service/layer model: the `Context.Service` key declares one
stable service shape, and local, mock, or remote layers provide implementations
for that shape. A remote provider must not change the service key or hide
network failures as defects.

The group service shape therefore needs honest control errors up front:

```typescript
type ProcessGroupControlError =
  | ProcessGroupErrors
  | ProcessGroupRemoteControlError;

interface TypedProcessGroup<Id, Entries, Error = ProcessGroupErrors> {
  readonly process: <P extends ProcessGroupProcessEntries<Entries>>(
    process: P,
  ) => TypedProcessControls<ProcessGroupEntryRequirements<Entries>, Error>;

  readonly queue: <Q extends ProcessGroupQueueEntries<Entries>>(
    queue: Q,
  ) => TypedQueueControls<ProcessGroupQueueItem<Q>, Error>;
}
```

`ProcessGroup.make(id, entries)` can stay local and narrow:

```typescript
yield* ProcessGroup.make("@app/BillingGroup", entries);
// TypedProcessGroup<..., ProcessGroupErrors>
```

`ProcessGroup.Service` should be remote-capable because it is the injectable
boundary:

```typescript
class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/BillingGroup",
  [StripeSync, EmailQueue] as const,
) {}

// yield* BillingGroup:
// TypedProcessGroup<..., ProcessGroupControlError>
```

Keep the remote/control error in a neutral module or type owned by the group
control boundary. `ProcessGroup` should not import `ProcessManager` only to name
remote request failures, because that creates the wrong ownership direction.

`ProcessGroup.remoteLayer(Group, Endpoint)` should be a normal Effect provider:

```typescript
const BillingRemoteLayer = ProcessGroup.remoteLayer(
  BillingGroup,
  BillingEndpoint,
);
// Layer.Layer<BillingGroup, never, BillingEndpoint | HttpClient>
```

The endpoint service owns connection configuration and the imported contract.
The application still provides transport, such as `NodeHttpClient.layerUndici`,
through normal layer wiring.

Do not implement remote queue enqueue in this slice. The remote group can expose
typed process controls plus queue `pause`, `resume`, `clear`, and `status`.
Queue `add` / `enqueue` / `prioritize` / `defer` remain blocked until queue item
schemas and serializable codec contracts exist. If the stable service shape
temporarily requires these members, they must fail with an explicit
unsupported-remote-control error, not `orDie`.

### Bundled remote layers

After endpoint service exists, first provide the remote group service:

```typescript
const BillingRemoteLive = ProcessGroup.remoteLayer(BillingGroup, BillingEndpoint);

const program = Effect.gen(function* () {
  const billing = yield* BillingGroup;

  yield* billing.process(StripeSync).runImmediately;
  yield* billing.queue(EmailQueue).pause;
});

yield* program.pipe(Effect.provide(BillingRemoteLive));
```

`remoteLayers` is a later milestone. It would provide more than the group
service:

- the remote group service (`BillingGroup`);
- remote process control services for each process entry;
- remote queue control services for each queue entry whose shape can be safely
  represented remotely.

That later API depends on separate remote-capable service shapes for every
runtime entry family that supports service-style declaration: processes, queues,
and future resource types. Current `Process.Service` and
`QueueResource.Service` produce local runtime-owner handles whose operations do
not expose network/control errors, so remote layers for those services would be
dishonest today.

Prefer future constructors named around remote capability:

```typescript
class StripeSync extends Process.RemoteService<StripeSync>()(
  "@app/StripeSync",
  { effect: syncStripe },
) {}
```

For queue resources, remote capability also requires a schema-backed item
contract:

```typescript
class EmailQueue extends QueueResource.RemoteService<EmailQueue, Email>()(
  "@app/EmailQueue",
  { effect: sendEmail, itemSchema: EmailSchema },
) {}

StripeSync.layer; // local runtime provider
StripeSync.remoteLayer(BillingEndpoint); // network-backed provider
EmailQueue.layer; // local runtime provider
EmailQueue.remoteLayer(BillingEndpoint); // network-backed provider
```

`RemoteService` should mean "this service is designed to be provided locally or
remotely"; its method error channels must account for control, network, and
protocol failures from the beginning. Keep `Service` as the low-ceremony local
runtime-owner constructor for each runtime entry family. `QueueResource.Service`
may keep `itemSchema` optional for local-only queues, but
`QueueResource.RemoteService` must require `itemSchema`.

### Error semantics must be decided before remote resource layers

Remote implementations cannot be perfectly transparent unless their checked
error types match the local service shape.

Examples:

- Current `QueueHandle.add` returns `Effect<void>`; a remote implementation can
  fail with network/protocol errors.
- Current `Process.runImmediately` returns `Effect<void, never, R>`; a remote
  implementation can fail because the remote group is down.

Do not hide these failures with `orDie` in public remote layers. Pick one before
implementing process/queue remote layers:

1. Widen public control errors to include a remote/control error.
2. Provide remote-only handle interfaces with explicit remote errors.
3. Keep only the remote group/manager service until queue/process handle shapes
   are redesigned around control errors.

Recommended path:

1. Add `ProcessManager.Endpoint` now.
2. Add `ProcessGroup.remoteLayer` for group controls, where the service shape can
   expose remote/control errors.
3. Wait on `remoteLayers` until `Process.RemoteService` /
   `QueueResource.RemoteService`-style handles and queue enqueue schema/error
   types are settled.

## ProcessGroup and ControlService

`ControlService` should move from generic string commands toward schema-checked
routes generated from the group contract.

Local-first routes can still exist:

```text
POST /processes/@app%2FStripeSync/start
POST /processes/@app%2FStripeSync/stop
POST /queues/@app%2FEmailQueue/pause
POST /queues/@app%2FInvoiceQueue/enqueue
GET  /status
GET  /contract
```

But the contract should drive route eligibility:

- do not expose queue enqueue if the queue has no public enqueue capability;
- do not expose release if the queue cannot release transferable entries;
- do not expose process schedule mutation if the process does not support it.

## Runtime state integration

This plan depends on [11 - Runtime state, listener hooks, history, and mutable
config](./11-runtime-state-hooks-and-config.md) for state snapshots and signals.

The group should be able to report:

- latest process state;
- latest queue/resource state;
- group health;
- active/inactive/quiescing state;
- config version;
- capabilities.

The group should not own duplicate resource truth. It should consume state from
runtime handles, projections, or the runtime observer introduced by plan 11.

## Store integration

The PG/PM redesign should not force `ProcessStore` to grow more feature-specific
methods.

Preferred flow:

1. process/resource service mutates state;
2. process/resource emits a state change/fact;
3. storage records generic state history/facts;
4. PG reads latest state from live handles or projections;
5. PM reads remote PG state through the group API.

## Activation and handoff

Groups need explicit activation controls before PM can coordinate deployments.

Candidate group controls:

```typescript
yield* billing.activate;
yield* billing.deactivate;
yield* billing.quiesce;
yield* billing.drain;
yield* billing.releaseAll({ target: nextBilling });
```

Granularity should be per group and per entry:

```typescript
yield* billing.process(StripeSync).quiesce;
yield* billing.queue(InvoiceQueue).release({ mode: "pendingOnly" });
```

Remote PM handoff:

```typescript
const oldBilling = ProcessManager.connect(BillingGroup, {
  url: "https://billing-a.internal",
});

const newBilling = ProcessManager.connect(BillingGroup, {
  url: "https://billing-b.internal",
});

const released = yield* oldBilling.queue(InvoiceQueue.id).release({
  mode: "pendingOnly",
});

yield* newBilling.queue(InvoiceQueue.id).enqueueReleased(released);
yield* newBilling.activate;
yield* oldBilling.drain;
```

PM should treat released queue payloads as opaque encoded values. The target
group validates them against its queue schema or codec.

## Implementation slices

### Slice 1 - Type-only design spike

- Add temporary type tests for `Process.Service`, `QueueResource.Service`,
  `ProcessGroup.make(id, entries)`, and `ProcessGroup.Service`.
- Prove tuple entries infer process-only and queue-only controls.
- Prove queue item types are preserved.
- Prove invalid process/queue operations fail with `@ts-expect-error`.
- Remove spike files or convert them to public API type tests once production
  code lands.

### Slice 2 - Runtime entry declarations

- Add `RuntimeEntry`.
- Add `Process.Service` while keeping `Process.make`.
- Adapt queue/resource services so existing `QueueResource.Service` can be used
  as a group entry without a secondary ID.
- Preserve current behavior behind existing APIs.

### Slice 3 - typed `ProcessGroup.make`

- Add direct group runtime acquisition:

```typescript
yield* ProcessGroup.make(id, entries, options);
```

- Return a typed group handle with `id`, `contract`, typed local controls, and
  the legacy control surface.
- Keep current `ProcessGroup.make({ processes, queues })` as a compatibility
  overload if needed during beta.

### Slice 4 - Typed local controls

- Add declaration-based `start`, `stop`, `process(entry)`, `queue(entry)`, and
  `status` controls.
- Keep string-based controls only as compatibility helpers or remote command
  internals.
- Add typed tests for autocomplete-facing surfaces.

### Slice 5 - Contract generation

- Generate serializable process/queue/resource capabilities from the group.
- Include schema metadata for queues where available.
- Version contracts.
- Add `GET /contract` to the local control API.

### Slice 6 - Remote PM client

- Add `ProcessManager.connect(GroupService, { baseUrl })` as the preferred
  runtime-class form, plus `ProcessManager.connect({ baseUrl, contract })` for
  generated clients.
- Route commands over the network to a group.
- Validate remote enqueue payloads with schema.
- Aggregate status from multiple remote groups.

### Slice 6.5 - Endpoint service and remote layer bundle

- Add `ProcessManager.Endpoint` to capture group contract + base URL +
  future auth/transport config.
- Add `ProcessGroup.remoteLayer` for the group service itself.
- Add `ProcessGroup.remoteLayers` once process/queue remote handle error
  semantics are decided.
- Do not implement queue/process remote layers by erasing remote failures.

### Slice 7 - Activation and handoff

- Add group activation/quiesce/drain controls.
- Add queue release and target enqueue support from plan 02.
- Add PM deployment handoff flows.

## Open questions

- Should local PG controls accept declarations only, canonical IDs only, or both?
- Should remote PM clients accept only canonical IDs, or also imported
  declarations as convenience values?
- How do we expose resource kinds beyond queue/run/http without making the group
  surface too generic?
- Should `ControlService` be owned by the group service (`BillingGroup.serve`)
  or remain a separate service consuming a group?

## Non-goals

- Do not make PM reach into queue internals.
- Do not add secondary registration IDs.
- Do not make `ProcessStore` responsible for live control.
- Do not design authentication in the first local PG slice.

## Graduation criteria

- Group services have canonical IDs.
- Process and resource services have canonical IDs.
- A group accepts a single tuple of entries.
- Local controls are typed by entry declaration, not plain strings.
- Queue item types are preserved through group controls.
- A direct `.make` style and an injectable service/layer style are both
  available.
- Group contracts are serializable and versioned.
- PM controls remote groups through contracts and network transport only.
- Runtime payloads crossing the network are schema-validated.
- `ControlService` can expose a contract-driven API for a typed group.
- Existing examples have a migration path from the old `ProcessGroup.make`
  split-array API.
