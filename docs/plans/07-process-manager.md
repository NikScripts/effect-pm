# 07 - Typed ProcessGroup and remote ProcessManager

## Status

Planned direction. The `ProcessGroup` shape should be settled before the remote
`ProcessManager` is implemented.

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

Process definitions do not need to be services by default:

```typescript
export interface ProcessDefinition<Id extends string, R>
  extends RuntimeEntry<Id, "process"> {
  readonly effect: Effect.Effect<void, never, R>;
  readonly make: Effect.Effect<ProcessHandle<R>>;
  readonly contract: ProcessContract<Id>;
}
```

Queue/resource definitions can wrap existing service tags:

```typescript
export interface QueueDefinition<Id extends string, T, R, E>
  extends RuntimeEntry<Id, "queue"> {
  readonly tag: Context.Key<unknown, QueueHandle<T, R, E>>;
  readonly contract: QueueContract<Id, T>;
}
```

The important rule: `id` comes from the declaration itself.

```typescript
const StripeSync = Process.define("@app/StripeSync", {
  effect: syncStripe,
});

const EmailQueue = QueueResource.define("@app/EmailQueue", {
  effect: sendEmail,
  schema: EmailSchema,
});

StripeSync.id; // "@app/StripeSync"
EmailQueue.id; // "@app/EmailQueue"
```

## Process service question

`Process.Service` may be useful later, but it should not be required for the
first typed `ProcessGroup`.

Resources benefit from services because application code commonly yields them:

```typescript
const queue = yield* EmailQueue;
yield* queue.add(email);
```

Processes are different. Most app code does not yield a process to do work; the
group or manager controls the process lifecycle. Therefore the initial process
shape should be `Process.define`, with optional service helpers later.

Candidate optional service helper:

```typescript
class StripeSync extends Process.Service<StripeSync>()("@app/StripeSync", {
  effect: syncStripe,
}) {}
```

This can be added if process handles need singleton injection, test replacement,
or composition inside other modules. It should not block the PG redesign.

## Preferred PG declaration: direct define plus optional layer

Use one entries tuple. Do not split `processes` and `resources`, and do not add
registration IDs.

```typescript
const BillingGroup = ProcessGroup.define(
  "@app/BillingGroup",
  [StripeSync, InvoiceSweep, EmailQueue, InvoiceQueue] as const,
  {
    autoStart: true,
  },
);
```

Direct use should not require providing a layer:

```typescript
const billing = yield* BillingGroup.make;

yield* billing.start(StripeSync);
yield* billing.runImmediately(InvoiceSweep);
yield* billing.queue(EmailQueue).pause;
yield* billing.queue(InvoiceQueue).enqueue({ invoiceId: "inv_123" });
```

The same definition can expose a layer for applications that want dependency
injection:

```typescript
const program = Effect.gen(function* () {
  const billing = yield* BillingGroup;
  yield* billing.serve({ port: 3030 });
});

yield* program.pipe(Effect.provide(BillingGroup.layer));
```

This gives both styles:

- direct `.make` for local composition and examples;
- `.layer` / service access for singleton group injection, `ControlService`,
  tests, and hosted agents.

## Class-based PG service variant

The class form should be a convenience over the same definition model.

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

The service form should not be the only form. `ProcessGroup.define(...).make`
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
const StripeSync = Process.define("@app/StripeSync", {
  effect: Effect.gen(function* () {
    const emails = yield* EmailQueue;
    const invoices = yield* InvoiceQueue;

    const changed = yield* syncStripe;
    yield* emails.add(changed.email);
    yield* invoices.add({ invoiceId: changed.invoiceId });
  }),
});
```

`ProcessGroup` should not become a private message bus for normal app work. It
is the lifecycle/control/status interface for the runtime entries.

## Remote ProcessManager contract

`ProcessManager` only connects to groups over a network. It cannot receive
actual process or queue objects. It should consume a serializable group
contract derived from the local declaration.

```typescript
export const BillingContract = BillingGroup.contract;

const billing = ProcessManager.connect<typeof BillingContract>({
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
  readonly itemSchema?: Schema.Schema<Item, unknown, never>;
}
```

Open schema question: runtime contracts may need a serializable schema
descriptor rather than carrying `Schema.Schema` directly over the network. Local
typing can use `Schema.Schema`; remote discovery needs JSON metadata.

## Remote client shape

The PM client should mirror local group controls, but all operations are network
requests.

```typescript
const billing = ProcessManager.connect<typeof BillingContract>({
  url: "https://billing.internal",
});

yield* billing.process(StripeSync.id).restart;
yield* billing.process(InvoiceSweep.id).runImmediately;

yield* billing.queue(EmailQueue.id).pause;
yield* billing.queue(InvoiceQueue.id).enqueue({ invoiceId: "inv_123" });
```

Remote compile-time expectations:

```typescript
// should not compile: unknown group member
yield* billing.process("@app/MissingProcess").start;

// should not compile if queue item schema/type is imported in the contract
yield* billing.queue(InvoiceQueue.id).enqueue({ to: "ops@example.com" });
```

Runtime validation is still required because network callers may not be typed.

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

1. process/resource mutates state;
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
const oldBilling = ProcessManager.connect<typeof BillingContract>({
  url: "https://billing-a.internal",
});

const newBilling = ProcessManager.connect<typeof BillingContract>({
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

- Add temporary type tests for `Process.define`, `QueueResource.define`,
  `ProcessGroup.define`, and `ProcessGroup.Service`.
- Prove tuple entries infer process-only and queue-only controls.
- Prove queue item types are preserved.
- Prove invalid process/queue operations fail with `@ts-expect-error`.
- Remove spike files or convert them to public API type tests once production
  code lands.

### Slice 2 - Runtime entry declarations

- Add `RuntimeEntry`.
- Add `Process.define` while keeping `Process.make`.
- Add or adapt queue/resource declarations so existing `QueueResource.Service`
  can be used as a group entry without a secondary ID.
- Preserve current behavior behind existing APIs.

### Slice 3 - `ProcessGroup.define`

- Add direct group definition:

```typescript
ProcessGroup.define(id, entries, options);
```

- Return `.make`, `.layer`, `.contract`, `.id`, and `.entries`.
- Keep current `ProcessGroup.make` as a compatibility wrapper if needed during
  beta.

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

- Add `ProcessManager.connect(contract, transport)` or
  `ProcessManager.connect<typeof Contract>(config)`.
- Route commands over the network to a group.
- Validate remote enqueue payloads with schema.
- Aggregate status from multiple remote groups.

### Slice 7 - Activation and handoff

- Add group activation/quiesce/drain controls.
- Add queue release and target enqueue support from plan 02.
- Add PM deployment handoff flows.

## Open questions

- Should `ProcessGroup.define(...).make` also be yieldable as a service, or
  should only `ProcessGroup.Service` be yieldable?
- Should local PG controls accept declarations only, canonical IDs only, or both?
- Should remote PM clients accept only canonical IDs, or also imported
  declarations as convenience values?
- Should `Process.define` be separate from `Process.make`, or should `make`
  become the declaration API in a beta break?
- How do we expose resource kinds beyond queue/run/http without making the group
  surface too generic?
- Should `ControlService` be owned by the group definition (`BillingGroup.serve`)
  or remain a separate service consuming a group?

## Non-goals

- Do not make PM reach into queue internals.
- Do not require every process to be a `Context.Service` before it can join a
  group.
- Do not add secondary registration IDs.
- Do not make `ProcessStore` responsible for live control.
- Do not design authentication in the first local PG slice.

## Graduation criteria

- Group declarations have canonical IDs.
- Process and resource declarations have canonical IDs.
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
