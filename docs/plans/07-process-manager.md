# 07 - Typed ProcessGroup and remote ProcessManager

## Status

Partially implemented. Typed group entries, group contracts, contract-aligned
control routes, `ProcessManager.connect`, `ProcessManager.Endpoint`,
`ProcessManager.cli`, and `ProcessGroup.remoteLayer` have landed. Remote queue
enqueue, group-bundled endpoint config, `Endpoint` direct export,
`RemoteService`, daemon-backed local launch, and multi-host deployment
coordination remain planned.

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

## Original gaps and legacy compatibility

The original `ProcessGroup.make` took separate `processes` and `queues` arrays
and returned methods that accepted plain `string` names. That lost autocomplete
and let typos compile.

```typescript
const group = yield* ProcessGroup.make({
  processes: [emailSync, dataPoller],
  queues: [EmailQueue, NotificationQueue],
});

yield* group.start("emailSync");
yield* group.pauseQueue("EmailQueue");
```

The typed group path now uses canonical entries and generated contracts. The
legacy split-array shape still exists for compatibility, so some string-keyed
internals remain while migration continues:

- `Process` has a `name` field.
- `QueueResource.Service` uses a `Context.Service` key as identity.
- `ProcessGroup` stores queues by `queueTag.key`.

The target model makes identity consistent without forcing every process to
become a service.

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
export interface QueueResourceServiceDefinition<
  Self,
  Id extends string,
  T,
  E,
  EEnqueue,
  R,
> extends Context.ServiceClass<Self, Id, QueueHandle<T, E, EEnqueue, R>>,
    RuntimeEntry<Id, "queue"> {
  readonly tag: Context.Key<Self, QueueHandle<T, E, EEnqueue, R>>;
  readonly layer: Layer.Layer<Self, never, R>;
  readonly contract: QueueContract<Id, T>;
}
```

The important rule: `id` comes from the declaration itself.

```typescript
class StripeSync extends Process.Service<StripeSync>()("@app/StripeSync", {
  effect: syncStripe,
}) {}

class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()("@app/EmailQueue", {
  effect: sendEmail,
  itemSchema: EmailSchema,
}) {}

StripeSync.id; // "@app/StripeSync"
EmailQueue.id; // "@app/EmailQueue"
```

Use slash-separated Effect-style ids with kebab-case package segments and
case-preserving service names, such as
`@repo/north-west/BillingGroup/SyncInvoices`. CLI aliases may normalize these
ids to lowercase/kebab-case input such as
`north-west/billing-group/sync-invoices`. Display kind as a separate field or
column instead of encoding it into the id.

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
class StripeSync extends Process.Service<StripeSync>()("app/StripeSync", {
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

### Security boundary

The current remote-control surface assumes localhost or a trusted private
network. It is unsafe to expose `ControlService` / `ProcessManager` endpoints on
a non-private network today. The implemented HTTP routes intentionally focus on
typed contracts and control semantics; they do not yet provide built-in
authentication, authorization, transport encryption, replay protection, rate
limits, request-size limits, or audit logging.

Before any public-network deployment story, add explicit security layers:

- **Authenticated transport**: TLS/mTLS, an Effect RPC transport with equivalent
  peer identity, or a proxy boundary that enforces identity.
- **Request authentication**: signed requests or short-lived bearer credentials
  with rotation guidance.
- **Authorization scopes**: separate read/status permissions from mutating
  controls such as `start`, `stop`, `restart`, `pause`, `resume`, and `clear`.
- **Replay protection**: timestamps, nonces, and bounded clock skew for mutating
  commands.
- **Operator audit trail**: persist who/what issued each remote command, from
  which endpoint, against which group/process/queue id, and whether it
  succeeded.
- **Defensive limits**: request body limits, schema-validation failures that do
  not leak internals, rate limits, and clear denial errors.

Default DX should stay easy for localhost/private-network use, but public
exposure should require an explicit security layer so insecure deployment is
visible in code.

```typescript
const billing = ProcessManager.connect(BillingGroup, {
  baseUrl: "https://billing.internal",
});

yield* billing.process(StripeSync.id).start;
yield* billing.queue(InvoiceQueue.id).pause;
```

The local PG can accept declarations:

```typescript
yield* billing.queue(InvoiceQueue).enqueue(job);
```

The remote PM should use canonical IDs from the contract:

```typescript
yield* billing.queue("@app/InvoiceQueue").pause;
```

If the app imports the declaration, it can still avoid spelling strings:

```typescript
yield* billing.queue(InvoiceQueue.id).status;
```

Generated/remote-only clients can use a raw contract value:

```typescript
const billing = ProcessManager.connect({
  baseUrl: "https://billing.internal",
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
  >;
}
```

Queue contract:

```typescript
export interface QueueContract<Id extends string> {
  readonly id: Id;
  readonly kind: "queue";
  readonly controls: ReadonlyArray<
    | "enqueue"
    | "pause"
    | "resume"
    | "clear"
    | "status"
  >;
}
```

The current queue contract can list local `enqueue` capability, but remote
`ProcessManager` queue handles intentionally expose only `pause`, `resume`,
`clear`, and `status`. Remote enqueue still requires the future codec metadata
below.

`QueueItemCodecDescriptor` will be defined in
[02 - Queue controls, schema, handoff, and lifecycle hooks](./02-queue-controls-and-hooks.md).
Future local queue services keep the full `Schema.Schema<Item, Encoded, never>`
on the declaration; contract generation calls `JSONSchema.make(itemSchema)` and
exports only the descriptor. Do not put live `Schema` values on the wire.

Future remote enqueue prerequisites (do not implement PM enqueue until these exist):

1. **Queue declaration** — a future schema-aware queue declaration supplies
   `itemSchema`.
2. **Contract slice** — a future `ProcessGroupQueueContract` includes optional
   `item` descriptor; `GET /contract` returns it for discovery and drift checks.
3. **Control route** — a future `POST /queues/:id/enqueue` accepts JSON `unknown`, runs
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
  baseUrl: "https://billing.internal",
});

yield* billing.process(StripeSync.id).restart;
yield* billing.queue(EmailQueue.id).pause;
yield* billing.queue(EmailQueue.id).resume;
```

Future schema-backed remote queue controls (enqueue requires contract `item`
descriptor):

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

When this future slice lands, only queues whose contract entry includes `item`
should get `enqueue` on the remote handle. The client encodes with the same
`itemSchema` used at declaration; the server decodes with the target runtime
schema (see plan 02).

Remote compile-time expectations:

```typescript
// should not compile: unknown group member
yield* billing.process("@app/MissingProcess").start;

// should not compile in the current remote PM surface: enqueue is unsupported
yield* billing.queue(InvoiceQueue.id).enqueue({ to: "ops@example.com" });
```

Runtime validation is still required because network callers may not be typed.

## Endpoint services and bundled remote layers

The long-term remote DX should use Effect layers instead of making application
code call `ProcessManager.connect` everywhere. The service key stays the same;
the provided layer decides whether the implementation is local, mocked, or
network-backed.

### Typed connection registry and endpoint service

Remote clients should not receive base URLs as ad hoc arguments at each call
site. Passing group service classes should create typed connection requirements,
and application layers should provide those requirements.

The multi-group CLI is:

```typescript
const cli = ProcessManager.cli([BillingGroup, StripeGroup] as const);
```

The group tuple carries contracts and IDs, so the type system can check the
connection maps accepted by `layer` and `layerConfig`:

```typescript
const RemoteGroupsLive = ProcessManager.ConnectionRegistry.layer(
  [BillingGroup, StripeGroup] as const,
  {
    [BillingGroup.id]: "http://127.0.0.1:32130",
    [StripeGroup.id]: "http://127.0.0.1:32131",
  },
);
```

Applications provide that requirement with a layer:

```typescript
const RemoteGroupsFromConfig = ProcessManager.ConnectionRegistry.layerConfig(
  [BillingGroup, StripeGroup] as const,
  {
    [BillingGroup.id]: Config.string("BILLING_GROUP_BASE_URL"),
    [StripeGroup.id]: Config.string("STRIPE_GROUP_BASE_URL"),
  },
);

const billing = yield* ProcessManager.connect(BillingGroup);
yield* billing.verifyContract;

yield* ProcessManager.cli([BillingGroup, StripeGroup] as const).pipe(
  Effect.provide(RemoteGroupsFromConfig),
);
```

Operator-facing command shape:

```bash
effect-pm groups
effect-pm groups --json
effect-pm ls
effect-pm ls --json
effect-pm verify
effect-pm verify --json
effect-pm status north-west/billing-group/sync-invoices
effect-pm status north-west/billing-group/sync-invoices --json
effect-pm start north-west/billing-group/sync-invoices
effect-pm stop north-west/billing-group/sync-invoices
effect-pm restart north-west/billing-group/sync-invoices
effect-pm now @repo/north-west/BillingGroup/SyncInvoices
effect-pm now north-west/billing-group/sync-invoices
effect-pm pause south-west/billing-group/billing-email-queue
effect-pm resume south-west/billing-group/billing-email-queue
effect-pm clear south-west/billing-group/billing-email-queue
```

Rules:

- `groups` lists the configured group ids and endpoints.
- `ls` lists all configured groups with their process and queue targets.
- `verify` checks every configured remote contract.
- `status <target>` reads process or queue status for a canonical id or
  normalized suffix alias.
- `--json` is implemented for `groups`, `ls`, `verify`, and `status <target>`.
- Canonical ids remain slash-separated Effect-style strings with kebab-case
  package segments and case-preserving service names, such as
  `@repo/north-west/BillingGroup/SyncInvoices`.
- CLI aliases may normalize canonical ids into lowercase/kebab-case input such
  as `north-west/billing-group/sync-invoices`.
- Single-target commands accept one process or queue id. The id can be canonical
  or an alias resolved from the normalized full id.
- Normalization applies to the whole id: case-insensitive comparison,
  punctuation-insensitive word casing (`SyncInvoices` ↔ `sync-invoices`), and
  suffix matching.
- If a target resolves to exactly one process or queue across all fetched
  contracts, the CLI may issue the command without a separate group argument.
- If a target resolves to multiple candidates, the CLI fails and shows every
  canonical candidate plus the shortest kebab-case suffix needed to
  disambiguate.
- Display kind separately from ids. Use a `KIND` column, label, or accessible
  color fallback instead of encoding process/queue/group kind in the id string.
- Diagnostics should include canonical group and target ids even when accepting
  shorter aliases.
- Targeted commands check the selected target's imported contract capabilities
  before remote calls. `status <target>` requires `status`, `now` requires
  `runImmediately`, and queue commands require `pause`, `resume`, or `clear`.
  If a process only exposes `status`, `now` fails locally before HTTP. If a
  queue lacks `clear`, `clear` fails locally before HTTP.
- After local capability checks, targeted commands verify the selected remote
  contract before issuing controls and report contract drift as a checked
  remote/control error.

`ProcessManager.Endpoint` remains useful as the injectable single-group remote
manager. Prefer the registry-backed form so connection state comes from a
swappable layer:

```typescript
class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
  BillingGroup,
) {}
```

The inline `{ baseUrl }` form remains available for small examples and tests:

```typescript
class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
  BillingGroup,
  { baseUrl: "http://127.0.0.1:32130" },
) {}
```

Application wiring should provide the group URL through
`ProcessManager.ConnectionRegistry.layer` or
`ProcessManager.ConnectionRegistry.layerConfig`.

The endpoint yields a typed remote manager:

```typescript
const billing = yield* BillingEndpoint;

yield* billing.verifyContract;
yield* billing.process(StripeSync.id).runImmediately;
yield* billing.queue(EmailQueue.id).pause;
```

This avoids repeating connection logic and gives later auth/RPC middleware a
single home. The critical rule is: group classes provide contracts; connection
layers provide locations.

### CLI, daemon, and endpoint config decisions

Current CLI surfaces are split:

- `src/bin/effect-pm.ts` is the package binary today, but it is an admin CLI for
  Prisma schema utilities (`prisma:print-schema`, `add prisma`), not the
  ProcessManager runtime CLI.
- `src/cli.ts` is the older single-group HTTP CLI. It talks directly to
  `ControlService` REST aliases with HTTP paths and should stay legacy
  compatibility rather than the model for new runtime commands.
- `ProcessManager.cli(groups)` is the newer multi-group control CLI. Runtime
  controls resolve a target from imported group contracts, get an endpoint from
  configuration, build a `RemoteProcessManager`, and send commands through
  `ControlTransportClient`.

Future runtime commands should therefore use:

```text
CLI -> ProcessManager -> ControlTransport -> ControlService / daemon / remote group
```

Non-runtime admin tooling, such as Prisma setup commands, does not need to go
through `ProcessManager`.

The CLI should be a command entrypoint, not a second long-running manager
program. `ProcessManager` sends commands to group control endpoints; it does not
own group fibers, queue workers, or application runtime state. The only planned
same-process exception is a test-only in-memory transport so type tests and
small integration tests can avoid process spawning.

The long-term CLI flow is:

```typescript
import { Endpoint, ProcessGroup, ProcessManager } from "@nikscripts/effect-pm";

class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/BillingGroup",
  [StripeSync, EmailQueue] as const,
  [
    Endpoint.local(
      Endpoint.module(
        () => import("./billing.runtime"),
        (module) => module.BillingRuntime,
      ),
    ).default,
    Endpoint.production(
      Endpoint.http({
        transport: ProcessManager.Transport.http({
          baseUrl: "https://billing.internal",
        }),
      }),
    ),
  ],
) {}

yield* ProcessManager.cli([BillingGroup] as const);
```

`Endpoint` should be exported both as a standalone namespace and as
`ProcessManager.Endpoint`, so callers can choose either:

```typescript
import { Endpoint, ProcessManager } from "@nikscripts/effect-pm";

Endpoint.local(/* ... */);
ProcessManager.Endpoint.local(/* ... */);
```

The third `ProcessGroup.Service` / `ProcessGroup.make` argument should become a
heterogeneous config item array. Endpoint items are the first item type, but the
shape should also have room for logs, fallback, daemon, security, auth, and
future transport policy without growing another positional options object.

Endpoint items should be builders, not raw objects:

```typescript
[
  Endpoint.local(Endpoint.module(() => import("./billing.runtime"))).default,
  Endpoint.production(Endpoint.http({ transport: ProcessManager.Transport.http({ baseUrl }) })),
  Endpoint.define("preview", Endpoint.http({ transport: ProcessManager.Transport.http({ baseUrl }) })),
]
```

Endpoint config rules:

- Endpoint labels are required. Label helpers such as `local`, `production`, and
  `define("preview", ...)` produce labeled config items. The CLI selects one
  with `--target <label>` and falls back to the item marked with `.default` when
  no target is provided.
- Only one endpoint item for a group may be default. Enforce that by derived
  config shape/runtime validation rather than a separate boolean outside the
  item list.
- `baseUrl` should stay inside `Endpoint.http(...)` /
  `ProcessManager.Transport.http(...)`; CLI-level config should not expose raw
  transport fields.
- Group-bundled endpoint config is the default. An explicit external config
  layer overrides all group-bundled config for environments that must replace
  targets without editing the group source.
- `ProcessManager.GroupConfig(Group, ...)` can remain public for external config
  files, but `ProcessGroup.Service` should wrap it internally when endpoints are
  declared in the group.

`Endpoint.module` is the TypeScript-first local launch descriptor. It accepts a
dynamic `import()` thunk and an optional selector:

```typescript
Endpoint.module(() => import("./billing.runtime"));
Endpoint.module(
  () => import("./billing.runtime"),
  (module) => module.BillingRuntime,
);
```

If no selector is supplied, `Endpoint.module` may read the default export as a
convenience. A named selector is preferred when the group, runtime, and config
share one file, because TypeScript validates the module path and selected export
shape without requiring a fragile string `exportName`. The dynamic import is a
typed descriptor for validation and bundling; the CLI must still launch the
runtime in a child process, wait for its `ControlService`, then talk over the
selected transport. It must not import and run group fibers in the CLI process.

`Endpoint.command` remains an escape hatch, not the preferred local model. If it
is needed, accept an Effect `ChildProcess` command value instead of an ad hoc
`{ command, args }` object so launching stays scoped, testable, and platform
provided. `Endpoint.module` can later compile to the same launcher machinery
internally, but users should be able to point at a typed runtime module instead
of spelling package scripts.

The runtime module should export a local runtime descriptor that owns the app
layer and control service:

```typescript
export const BillingRuntime = ProcessManager.LocalRuntime(BillingGroup, {
  layer: BillingGroup.layer,
  control: ControlService.layerHttp(BillingGroup, { port: 32130 }),
});
```

This avoids the circular-dependency trap:

1. the group owns only declarations and optional lazy endpoint descriptors;
2. the runtime descriptor owns live layers and `ControlService`;
3. the CLI reads descriptors, starts a child runtime when needed, then sends
   protocol commands.

Contracts fit at every boundary. `ProcessGroup.Service` carries the local
contract, `Endpoint.module` validates that the selected runtime targets that
group, and `Endpoint.http` verifies the remote contract before commands. Raw
contract objects remain useful for generated clients that cannot import the
group class.

Local/remote status should be observable before commands. A configured group can
show as `pending`, `online`, `offline`, or contract-drifted after a bounded
probe. The CLI should not pretend missing endpoints are defects; connection and
contract failures are normal checked control results.

```typescript
type GroupConnectionStatus =
  | { readonly _tag: "Configured" }
  | { readonly _tag: "Pending"; readonly since: number }
  | { readonly _tag: "Online"; readonly endpoint: string }
  | { readonly _tag: "Offline"; readonly reason: string }
  | { readonly _tag: "StartingLocal"; readonly pid?: number }
  | { readonly _tag: "FallbackLocal"; readonly pid: number; readonly reason: string };
```

Local launcher state should be daemon-compatible from the first slice. Store
small process-table files and logs under package-local paths such as:

```text
.effect-pm/run/groups/<safe-group-id>.json
.effect-pm/logs/<safe-group-id>.out.log
.effect-pm/logs/<safe-group-id>.err.log
```

Remote-to-local fallback is valuable but must be opt-in. Silent fallback can
duplicate workers, so fallback policy belongs in explicit endpoint/fallback
config, not in CLI defaults.

Logs are a sibling transport capability, not a hidden HTTP-only feature. Plan
for a `LogTransport` / log endpoint item that can:

- follow one group;
- merge logs from several groups;
- keep a log stream open while the operator enters commands;
- switch from remote logs to locally launched logs when fallback starts a local
  runtime.

The daemon path should grow from these same config items. The first CLI version
can launch child runtimes directly. A later daemon can own those child runtimes,
track PIDs, expose health/log/control channels, and apply fallback policy such as
"use remote, launch local if remote is unavailable or drops." The operator API
should remain the same: group + endpoint label + command.

Implementation order:

1. Add group config item types and `Endpoint` direct export /
   `ProcessManager.Endpoint` access.
2. Add group-bundled endpoint items on `ProcessGroup.Service` /
   `ProcessGroup.make`, with external config-layer overrides.
3. Add endpoint label selection and configured group status (`pending`,
   `online`, `offline`, drift).
4. Add `Endpoint.http` as the first real transport endpoint.
5. Add `Endpoint.module` type shape and `LocalRuntime` descriptor, but keep
   execution out-of-process.
6. Add child runtime launcher/run-state/log files for local endpoints.
7. Route all runtime commands through `ProcessManager`.
8. Add local file-backed log streaming, then remote log transport.
9. Add the daemon endpoint after direct launcher behavior works.

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

The endpoint service owns the imported contract and consumes the connection
registry. The application still provides transport, such as
`NodeHttpClient.layerUndici`, through normal layer wiring.

Remote group controls should verify the endpoint contract before issuing remote
commands. Cache successful verification inside the remote group provider so the
layer remains infallible, while contract drift still reaches callers as a
checked remote/control error on the operation they attempted.

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

`remoteLayers` is a later milestone for group-level bundling. It should stay
focused on the remote group service until standalone remote service contracts
are deliberately designed:

- the remote group service (`BillingGroup`);
- future remote process control services for entries that explicitly opt in to a
  remote-capable service shape;
- future remote queue control services for entries that explicitly opt in to a
  remote-capable service shape and have schema-backed item contracts.

That later API depends on separate remote-capable service shapes for every
runtime entry family that supports service-style declaration: processes, queues,
and future resource types. Current `Process.Service` and
`QueueResource.Service` produce local runtime-owner handles whose operations do
not expose network/control errors, so remote layers for those services would be
dishonest today.

Do not implement `Process.RemoteService`, `QueueResource.RemoteService`, or
resource-family `RemoteService` constructors in the current group remote-layer
work. They are lower priority than finishing the group-level remote layer and
must stay behind a design gate until these challenges are resolved:

- lifecycle ownership (`start` / `stop` / `restart` belong to group-owned
  supervisors, not standalone local process handles);
- honest checked error channels for all local and remote operations;
- capability typing for operations that exist locally but are not remotely safe;
- queue `itemSchema` / codec contracts for enqueue, release, and handoff;
- per-entry remote provider wiring without hiding network failures or using
  defects.

When that design gate opens, prefer constructors named around remote capability:

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

Near-term build priority:

1. Harden `ProcessGroup.remoteLayer`.
2. Add group remote-layer examples and type/runtime tests.
3. Improve group contract verification and remote error mapping.
4. Defer standalone `RemoteService` constructors and per-entry remote providers.

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
3. Continue group-level remote-layer hardening before designing standalone
   remote-capable service constructors.
4. Wait on per-entry `remoteLayers` until `Process.RemoteService` /
   `QueueResource.RemoteService`-style handles and queue enqueue schema/error
   types are settled.

## ProcessGroup and ControlService

`ControlService` should move from generic string commands toward schema-checked
routes generated from the group contract.

Local-first routes can still exist:

```text
POST /processes/%40app%2FStripeSync/start
POST /processes/%40app%2FStripeSync/stop
POST /queues/%40app%2FEmailQueue/pause
POST /queues/%40app%2FInvoiceQueue/enqueue
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
  baseUrl: "https://billing-a.internal",
});

const newBilling = ProcessManager.connect(BillingGroup, {
  baseUrl: "https://billing-b.internal",
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

- Return a typed group handle with `id`, `entries`, `contract`, and typed local
  controls. (Implemented for typed entries.)
- Keep the split `{ processes, queues }` compatibility shape until a later
  breaking release removes it.

### Slice 4 - Typed local controls

- Add declaration-based `start`, `stop`, `process(entry)`, `queue(entry)`, and
  `status` controls.
- Keep string/id-based lookup private to REST route adapters; public group
  controls should stay declaration-based.
- Add typed tests for autocomplete-facing surfaces.

### Slice 5 - Contract generation

- Generate serializable process/queue/resource capabilities from the group.
- Include schema metadata for queues where available.
- Version contracts.
- Add `GET /contract` to the local control API.

### Slice 6 - Remote PM client

Implemented initial surface:

- Typed `ProcessManager.ConnectionRegistry` requirement derived from a group
  tuple, with `layer` and `layerConfig` so base URLs live in swappable Effect
  configuration, not in CLI call arguments.
- `ProcessManager.connect(GroupService)` as the preferred runtime-class form
  when a connection registry is available, plus
  `ProcessManager.connect(GroupService, { baseUrl })` and
  `ProcessManager.connect({ baseUrl, contract })` for generated clients and
  low-level escape hatches.
- Remote process controls and queue `pause`, `resume`, `clear`, and `status`
  controls routed over the group control API.
- Multi-group `ProcessManager.cli([GroupA, GroupB] as const)` using the
  connection registry, with `groups`, `ls`, `verify`, `status <target>`,
  process commands, and queue commands.
- CLI `--json` output for `groups`, `ls`, `verify`, and `status <target>`.
- CLI local capability gating before HTTP status/control requests, including
  `status <target>` requiring `status`, `now` requiring `runImmediately`, and
  queue commands requiring their matching queue controls.
- Remote queue enqueue remains blocked until schema-backed queue item contracts
  land.

### Slice 6.5 - Endpoint service and remote layer bundle

Implemented initial surface:

- `ProcessManager.Endpoint` captures the group contract and consumes
  connection-registry values, with an inline `{ baseUrl }` overload for examples
  and tests.
- `ProcessGroup.remoteLayer` for the group service itself.
- Add `ProcessGroup.remoteLayers` once process/queue remote handle error
  semantics are decided.
- Do not implement queue/process remote layers by erasing remote failures.

Next endpoint-config surface:

- Add an `Endpoint` namespace export that is also available as
  `ProcessManager.Endpoint`.
- Add endpoint config items for `Endpoint.local`, `Endpoint.http`, and
  `Endpoint.module`.
- Let `ProcessGroup.Service` / `ProcessGroup.make` accept a heterogeneous config
  item array as the third argument, with endpoint items as the first supported
  item type.
- Add `ProcessManager.GroupConfig(Group, ...)` for external config layers, while
  letting group-bundled endpoint items wrap that config internally.
- Add `ProcessManager.LocalRuntime(Group, ...)` as the module target used by
  child-process launches.
- Keep same-process endpoints test-only.
- Add log transport config as a sibling endpoint capability before building a
  rich daemon UX.

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
- Should `ControlService` remain a separate service consuming a group, or
  should group service classes grow first-class control-service helpers?

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
