# 02 - Queue controls, schema, handoff, and lifecycle hooks

## Status

Planned.

## Intent

Unify queue operations around one queue-bound control surface.

The `QueueResource` service should expose every control that `ProcessGroup`,
application code, queue effects, and queue hooks need. The controls passed to a
queue effect or hook should be bound to that exact queue, so callbacks do not
need to re-yield a service and risk using the wrong queue.

## Current gap

The queue service exposes core controls, but callback contexts are narrower:

- queue service: enqueue, inspect, pause, resume, shutdown, clear,
- item effect context: guarded enqueue plus current item metadata,
- handler context: retry plus enqueue,
- special callbacks: `persist`, `refill`, `onEnqueue`, `onComplete`,
  `onEmpty`, `onRetryExhausted`.

The special `persist` and `refill` names mix storage behavior with lifecycle
behavior. Storage should move into `ProcessStore`; lifecycle hooks should receive
powerful queue controls.

The current enqueue input also accepts any `Iterable<T>`. That is too broad for
the future API. It can treat strings as batches of characters and makes single
versus batch error typing harder than it needs to be.

## Target model

Define one conceptual surface:

- `QueueControls<T, R, E>`

Then derive safe views:

- `QueueHandle<T, R, E>` - the public service and `ProcessGroup` control
  surface,
- `QueueEffectControls<T>` - queue-bound controls passed to the item effect,
- `QueueHookControls<T, R, E>` - queue-bound controls passed to hooks,
- `QueueLifecycleControls<T, R, E>` - lifecycle hook view, allowed to call
  lifecycle operations where appropriate.

All views should be implemented from the same underlying queue state.

## Naming and factory contract

QueueResource should follow the same naming contract used by the typed
`ProcessGroup` work:

- `QueueResource.make(config)` - raw scoped Effect that acquires a live queue
  handle. Use this when a caller wants full manual ownership or a custom
  `Context.Service` wrapper.
- `QueueResource.Service<Self, T, R, E>()(id, config)` - primary concrete queue
  declaration. The class is the Context service key, has one canonical id, and
  owns a default `.layer`.
- `QueueResource.RemoteService<Self, T, R, E>()(id, config)` - deferred
  remote-capable queue declaration. Do not implement this constructor until the
  remote service design gate in
  [07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md)
  is resolved. When implemented, use it for queue services intended to be
  swappable between a local runtime provider and a network-backed remote
  provider. Its handle shape must expose control/network/protocol errors from
  the beginning, and its config must include `itemSchema`.
- `QueueResource.Tag<Self, T, R, E>()(id)` - identity only. Use with
  `QueueResource.layer(tag, config)` or `Layer.succeed(tag, mock)` for alternate
  implementations.
- `QueueResource.layer(tag, config)` - provider for either a `Service` override
  or a `Tag` implementation.

Do not add a separate queue `define` API. `Service` is the canonical class-based
declaration; `make` is runtime acquisition.

| Scenario | Use |
|----------|-----|
| Concrete app queue with config known at declaration | `QueueResource.Service` |
| Queue intentionally provided locally or remotely | `QueueResource.RemoteService` after the remote service design gate |
| Library/shared contract where implementation varies | `QueueResource.Tag` + `QueueResource.layer` |
| Test or environment-specific override | `QueueResource.layer(ServiceOrTag, config)` |
| Full mock/no processing | `Layer.succeed(Tag, mockHandle)` |
| Manual scoped acquisition | `QueueResource.make` |

`RemoteService` is not a remote layer bolted onto the local `Service` shape. It
is a different service contract for queues that cross process boundaries. The
same key can eventually have a local `.layer` and a remote
`.remoteLayer(endpoint)`, but all public operations must honestly model failures
that can happen over the network. Unlike `QueueResource.Service`,
`QueueResource.RemoteService` requires `itemSchema`. A queue that can be called
remotely must have a schema-backed serializable item contract; otherwise remote
enqueue, release, and handoff have no safe wire boundary.

This is not a near-term implementation item. Finish and harden group-level
remote controls first; remote enqueue and standalone remote queue services
remain out of scope until this plan's schema-backed enqueue model is
implemented.

## Effect-idiomatic internal architecture

The v2 rewrite should prefer Effect modules over custom bookkeeping:

- `FiberSet` for worker, handler, and hook fibers. Avoid manual
  `Ref<Set<Fiber>>` tracking.
- `Latch` for pause/resume. Avoid polling boolean pause flags.
- `Semaphore` for concurrency.
- `Data.TaggedError` for all public/runtime errors.
- `Exit` in handlers so users receive standard Effect result information.
- `Duration.Input` for user-facing duration config where durations are accepted.
- `Effect.annotateLogs` for structured queue/process log context.
- `Effect.fn` can be used for named internal functions when it improves tracing
  and does not obscure simple control flow.

Workers should be scope-owned: closing the queue scope interrupts workers and
in-flight handler/hook fibers through `FiberSet`.

## Handle shape and naming

Keep the public queue handle small at first:

```typescript
export interface QueueHandle<T, R = void, E = never> {
  readonly add: (item: T | ReadonlyArray<T>) => Effect.Effect<void>;
  readonly prioritize: (item: T | ReadonlyArray<T>) => Effect.Effect<void>;
  readonly defer: (item: T | ReadonlyArray<T>) => Effect.Effect<void>;

  readonly size: Effect.Effect<number>;
  readonly sizes: Effect.Effect<{
    readonly high: number;
    readonly normal: number;
    readonly low: number;
  }>;
  readonly isEmpty: Effect.Effect<boolean>;
  readonly completed: Effect.Effect<number>;

  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
  readonly clear: Effect.Effect<number>;
}
```

Naming rules:

- `add` is normal priority.
- `prioritize` is high priority.
- `defer` is low priority.
- `clear` empties pending queues and resets counters; it is not `restart`.
- `size`, `sizes`, `isEmpty`, `completed`, `pause`, `resume`, `shutdown`, and
  `clear` are effectful properties where no input is needed.

`clear` should return a count first. Returning drained items is a later decision
because payloads can be large and may become encoded/opaque.

## Queue item schema and codec contract

Queues may optionally declare an **item schema** for their payload. The schema
is the single source of truth for:

- compile-time item type `T` on `QueueHandle<T, …>`,
- runtime validation on every public enqueue path,
- encoded wire payloads for remote enqueue and release/handoff,
- serializable metadata embedded in `ProcessGroupContract`.

No separate validation booleans. Presence of `itemSchema` in config is the only
switch.

### Config shape

Add one optional field to `QueueResourceConfig`. Do not add both `schema` and
`codec` as independent toggles.

```typescript
import { Schema } from "effect"

// Local declaration — full Schema value, not a descriptor
export interface QueueResourceConfig<T, R, E> {
  // …existing fields…

  /**
   * When present, every public enqueue path decodes/validates input before the
   * item enters internal queue state. Also drives contract metadata and wire
   * encoding for remote enqueue / handoff.
   */
  readonly itemSchema?: Schema.Schema<T, Encoded, never>
}
```

`Encoded` is inferred from the schema (`Schema.Schema.Encoded<typeof schema>`).
The queue stores **decoded** `T` internally after validation; encoded form is
used only at boundaries (HTTP body, released-entry envelope, contract export).

`QueueResource.Service` should capture the schema at declaration time so
`contract` can be derived without reading live config:

```typescript
class EmailQueue extends QueueResource.Service<
  typeof EmailQueue,
  Email,
  void,
  SmtpError
>()("@app/EmailQueue", {
  effect: sendEmail,
  itemSchema: EmailSchema, // T = Email, Encoded = Schema encoded type
}) {}

EmailQueue.contract.item // QueueItemCodecDescriptor — serializable
```

`QueueResource.Tag` may carry schema type parameters for typing only; the
implementation layer supplies the runtime schema when building the handle.

### Item schema vs encoded payload

Effect `Schema.Schema<A, I, R>` already separates:

| Role | Type param | Used where |
|------|------------|------------|
| Decoded item (in-memory) | `A` → config `T` | `effect(item, ctx)`, hooks, dedup `key` |
| Encoded payload (wire/storage) | `I` → `Encoded` | HTTP JSON, `ReleasedEntry.payload`, contract |

Validation pipeline at enqueue (schema present):

1. **Local typed enqueue** (`add`, `prioritize`, `defer`, `enqueue` with `item`):
   accept `T` at the type level; optionally re-validate with
   `Schema.decodeUnknown(itemSchema)(item)` when input arrives as `unknown`
   (remote/control paths only).
2. **Wire / handoff enqueue** (`payload` on entry or released envelope):
   `Schema.decodeUnknown(itemSchema)(payload)` → `T`; reject before internal
   state mutation.
3. **Outbound** (release export, control response bodies): `Schema.encodeUnknown(itemSchema)(item)` → `Encoded`.

Use Effect's built-in helpers — do not invent a parallel codec type:

```typescript
import { ParseResult, Schema } from "effect"

const decodeItem = Schema.decodeUnknown(itemSchema, { errors: "all" })
const encodeItem = Schema.encodeUnknown(itemSchema)
```

`ParseResult.ArrayFormatter.formatIssue` supplies structured path/message pairs
for error mapping. Wrap `ParseResult.ParseError` in queue-specific tagged
errors; do not re-parse error strings.

For queues **without** `itemSchema`, `T` is declared only by the config generic
and no runtime validation runs. Release/handoff for such queues is out of scope
until a schema is added (see graduation criteria).

### Serializable contract descriptor

`ProcessGroupContract` cannot carry live `Schema.Schema` values. Each queue
entry exports a **descriptor** derived once from the declaration schema:

```typescript
/** JSON-safe metadata for contract export and remote discovery */
export interface QueueItemCodecDescriptor {
  readonly id: string           // stable id, e.g. "@app/EmailQueue/item@v1"
  readonly version: string      // semver or hash; bump on breaking encoded shape
  readonly encoding: "json"     // first wire format; extend later if needed
  readonly jsonSchema: JsonSchema7 // from JSONSchema.make(itemSchema)
}

export interface ProcessGroupQueueContract<Id extends string> {
  readonly id: Id
  readonly kind: "queue"
  readonly controls: ReadonlyArray<ProcessGroupQueueControl>
  readonly item?: QueueItemCodecDescriptor  // absent when queue has no itemSchema
}
```

Generation at group build time:

```typescript
const descriptor = itemSchema !== undefined
  ? {
      id: `${queueId}/item@v1`,
      version: "1.0.0",
      encoding: "json" as const,
      jsonSchema: JSONSchema.make(itemSchema),
    }
  : undefined
```

Local compile-time typing still uses the full `Schema.Schema<T, Encoded, never>`
on the service class. Remote clients import the **same** schema value from the
app module when they have it; the descriptor is for discovery, drift checks, and
untyped callers.

`ProcessManager.verifyContract` should compare queue `item` descriptors
(id + version) in addition to group id. Mismatched versions are a client
warning, not a hard failure — the target group always re-validates payloads.

### Enqueue entry shape (schema-aware)

Advanced `enqueue` accepts entries that carry either a decoded item or an
encoded payload, not both:

```typescript
type QueueEnqueueEntry<T, Encoded> =
  | {
      readonly item: T
      readonly priority?: Priority
      readonly key?: string
      readonly entryId?: string
      readonly attributes?: Record<string, unknown>
    }
  | {
      readonly payload: Encoded
      readonly priority?: Priority
      readonly key?: string
      readonly entryId?: string
      readonly attributes?: Record<string, unknown>
      readonly source?: string
      readonly releaseId?: string
    }
```

Rules:

- `item` paths skip decode when input is already `T` (local callers).
- `payload` paths always run `decodeUnknown(itemSchema)`.
- Metadata fields are not validated by `itemSchema`; only the item/payload
  field is schema-checked.
- Convenience `add` / `prioritize` / `defer` pass `{ item }` or
  `{ item: … }[]` with implicit normal/high/low priority.

### Single-item vs batch validation errors

Derive error types from config — no runtime flags:

```typescript
type ItemEnqueueError<S> = S extends Schema.Schema<any, any, any>
  ? QueueItemValidationError
  : never

type BatchEnqueueError<S> = S extends Schema.Schema<any, any, any>
  ? QueueBatchValidationError
  : never
```

**Single item** — one failure, fail fast:

```typescript
export class QueueItemValidationError extends Data.TaggedError(
  "QueueItemValidationError",
)<{
  readonly queue: string
  readonly operation: "add" | "prioritize" | "defer" | "enqueue"
  readonly input: unknown
  readonly issues: ReadonlyArray<ParseResult.ArrayFormatterIssue>
  readonly codecId?: string
}> {}
```

Use `Schema.decodeUnknown(itemSchema)(input)` (single issue tree). Map via
`ParseResult.ArrayFormatter.formatIssue`.

**Batch** — collect all index failures before deciding atomic vs partial:

```typescript
export class QueueBatchValidationError extends Data.TaggedError(
  "QueueBatchValidationError",
)<{
  readonly queue: string
  readonly operation: string
  readonly mode: "atomic" | "partial"
  readonly failures: ReadonlyArray<{
    readonly index: number
    readonly input: unknown
    readonly issues: ReadonlyArray<ParseResult.ArrayFormatterIssue>
  }>
  /** Present only when mode is "partial" and at least one item succeeded */
  readonly accepted?: ReadonlyArray<{ readonly index: number; readonly item: unknown }>
  readonly rejected?: ReadonlyArray<{ readonly index: number; readonly input: unknown }>
  readonly codecId?: string
}> {}
```

Batch validation implementation sketch:

```typescript
const validateBatch = (
  inputs: ReadonlyArray<unknown>,
): Effect.Effect<
  ReadonlyArray<T>,
  ReadonlyArray<{ index: number; input: unknown; issues: … }>
> =>
  Effect.forEach(
    inputs.map((input, index) =>
      decodeItem(input).pipe(
        Effect.map((item) => ({ ok: true as const, index, item })),
        Effect.catchAll((error) =>
          ArrayFormatter.formatIssue(error.issue).pipe(
            Effect.map((issues) => ({ ok: false as const, index, input, issues })),
          ),
        ),
      ),
    ),
    (x) => x,
    { concurrency: "unbounded" },
  ).pipe(
    Effect.flatMap((results) => {
      const failures = results.filter((r) => !r.ok)
      if (failures.length === 0) {
        return Effect.succeed(results.map((r) => r.item))
      }
      return Effect.fail(failures)
    }),
  )
```

Always use `{ errors: "all" }` on decode so one item surfaces multiple issues.

### Atomic vs partial batch semantics

| Mode | Validation | Enqueue | Error |
|------|------------|---------|-------|
| `atomic` (default) | All inputs checked | All or none | `QueueBatchValidationError` with `mode: "atomic"`, no `accepted` |
| `partial` | All inputs checked | Valid items only | `QueueBatchValidationError` with `mode: "partial"`, `accepted` + `rejected` populated when any failure |

Semantics:

- **Atomic**: if `failures.length > 0`, return `QueueBatchValidationError` and
  mutate no queue state.
- **Partial**: enqueue decoded items for successful indices in order; if
  `failures.length > 0`, still return `QueueBatchValidationError` (caller uses
  `accepted` / `rejected` to decide follow-up). If all succeed, return void.

Convenience methods (`add`, `prioritize`, `defer`) are always atomic.

Advanced signature:

```typescript
readonly enqueue: {
  (entry: QueueEnqueueEntry<T, Encoded>): Effect.Effect<void, ItemEnqueueError<…>>
  (
    entries: ReadonlyArray<QueueEnqueueEntry<T, Encoded>>,
    options?: { readonly mode?: "atomic" | "partial" },
  ): Effect.Effect<void, BatchEnqueueError<…>>
}
```

`mode` defaults to `"atomic"`. Partial mode is required for ProcessManager
handoff where a target deployment accepts most released entries but rejects
schema-incompatible payloads.

### Remote and handoff validation

Target queue validates with **its own** `itemSchema` at enqueue time. The source
does not prove schema equality. Compatible deployments decode successfully;
incompatible ones return `QueueItemValidationError` or `QueueBatchValidationError`.

**Local `ProcessGroup.queue(Q).enqueue(item)`**

- Compile-time `T` from queue entry.
- Runtime: optional identity check only; schema already satisfied by types.

**Remote `ProcessManager.queue(id).enqueue(item)`** (plan 07)

- Client: `Schema.encodeUnknown(itemSchema)(item)` before HTTP POST.
- Server (`ControlService`): receive JSON body as `unknown`; run
  `Schema.decodeUnknown(targetQueueItemSchema)(body)` on the **target** queue's
  schema; forward decoded `T` to `QueueHandle.enqueue` or fail with structured
  4xx mapping to validation error JSON.
- Untyped callers: may send raw JSON matching `jsonSchema` from
  `GET /contract`; server path identical.

**Handoff `enqueueReleased(entries)`**

- Released entries carry `payload: Encoded` plus metadata (`releaseId`, `key`, …).
- Target decodes each `payload` with its own schema; use `partial` batch mode
  by default so one bad entry does not drop the whole release batch.

### Rules (unchanged intent)

- no `itemSchema` → no runtime validation; contract has no `item` descriptor;
  remote enqueue not exposed on that queue,
- `itemSchema` present → every public enqueue path validates before internal
  state mutation,
- no validation-before-effect pass on already-running items,
- release / handoff requires `itemSchema`,
- schema mismatch across deployments is an enqueue validation failure, not a
  transport error,
- invalid payloads never reach the item `effect` or hooks; failures go to
  `onEnqueueRejected` when configured and to the caller's error channel.

## Enqueue API

Replace the broad `Iterable<T>` public input with overloads:

- `add(item: T)`
- `add(items: ReadonlyArray<T>)`
- `prioritize(item: T)`
- `prioritize(items: ReadonlyArray<T>)`
- `defer(item: T)`
- `defer(items: ReadonlyArray<T>)`

Do not use broad `Iterable<T>` for public enqueue. Runtime normalization should
check `Array.isArray(input)`; otherwise the input is a single item. This avoids
splitting strings or accepting arbitrary iterables by accident.

Add an advanced metadata-aware API:

- `enqueue(entry)` — see `QueueEnqueueEntry` in the schema contract section,
- `enqueue(entries, { mode })` — batch with atomic/partial semantics.

`add`, `prioritize`, and `defer` are convenience methods over `enqueue`.

## Enqueue error typing and handle generics

Full error shapes and batch modes are defined in **Queue item schema and codec
contract** above. At the handle level, thread schema presence through generics
so callers only see errors that can occur:

```typescript
interface QueueHandle<
  T,
  R = void,
  E = never,
  ItemSchema extends Schema.Schema<T, any, any> | undefined = undefined,
> {
  readonly add: {
    (item: T): Effect.Effect<void, ItemEnqueueError<ItemSchema>>
    (items: ReadonlyArray<T>): Effect.Effect<void, BatchEnqueueError<ItemSchema>>
  }
  // prioritize, defer, enqueue — same error pattern
}
```

`QueueResource.Service` should infer `ItemSchema` from config `itemSchema` when
present so `ProcessGroup.queue(EmailQueue).add(…)` propagates validation errors
without manual type parameters.

## Batch behavior

See **Atomic vs partial batch semantics** in the schema contract section.
Convenience methods are always atomic; `enqueue(entries, { mode: "partial" })`
is for handoff and bulk ingest where rejecting the whole batch is too strict.

## Keys and identity

Keep these concepts separate:

- `key` - deduplication / idempotency key,
- `entryId` - unique queue-entry instance id,
- `releaseId` - handoff batch id,
- `source` - source group / queue / deployment metadata.

Today keys prevent duplicate in-flight work and guard against self-enqueue.
They should continue to mean deduplication, not durable item identity.

If a target queue receives a released entry whose key is already active, that
should be reported as a structured enqueue rejection rather than silently
disappearing.

## Release and handoff

Add queue release controls for deployment handoff:

- `release(options)`
- `enqueue(releasedEntries)`

`release` exports transferable entries. It is not the same as `clear`, because
released items must be preserved.

Candidate release options:

- `scope: "pendingOnly" | "waitForInFlight" | "drain"`,
- `deadline`,
- `mode: "atomic" | "partial"`,
- `releaseId`,
- `attributes`.

Release scopes:

- `pendingOnly` - pause/quiesce the queue, export pending entries, and let
  already in-flight items finish on the source deployment.
- `waitForInFlight` - pause/quiesce the queue so no more pending work starts,
  wait for currently in-flight item effects to settle, then export remaining
  pending entries.
- `drain` - transfer nothing; stop accepting new work and let pending plus
  in-flight work finish on the source deployment.

`waitForInFlight` is not the same as `drain`. It waits for active work only,
then transfers whatever remains pending. `drain` waits for the whole queue to
finish and should be the preferred handoff mode for short queues,
non-transferable payloads, or schema-incompatible deployments.

Candidate release flow:

1. pause or quiesce source queue,
2. stop accepting new items or mark source as releasing,
3. extract pending entries with metadata,
4. optionally wait for in-flight work,
5. return transferable entries,
6. enqueue those entries into the target queue,
7. resume or activate target queue.

Release requires schema or codec support. A ProcessManager should be able to
treat payloads as opaque encoded values and let the target group validate them.

## Candidate controls

Enqueue and routing:

- `add(item)`
- `add(items)`
- `prioritize(item)`
- `prioritize(items)`
- `defer(item)`
- `defer(items)`
- `enqueue(entry)`
- `enqueue(entries)`
- `retry`
- `retryAfter(duration)`
- `retryAt(instant)`
- `requeue(item, options)`
- `deadLetter(item, reason)`
- `drop(itemOrKey, reason)`
- `dropCurrent(reason)`
- `replace(key, item)`
- `hasActiveKey(key)`
- `release(options)`

Lifecycle:

- `pause`
- `resume`
- `shutdown`
- `clear`
- `drain`
- `awaitDrained`
- `awaitIdle`
- `awaitShutdown`
- `quiesce`
- `lifecycle`
- `enabled`
- `isPaused`
- `isRunning`
- `isShutdown`

Inspection:

- `size`
- `sizes`
- `isEmpty`
- `completed`
- `pending`
- `inFlight`
- `activeKeys`
- `capacity`
- `remainingCapacity`
- `concurrency`
- `workers`
- `stats`
- `snapshot`
- `health`

Waiting and streams:

- `changes`
- `lifecycleChanges`
- `awaitEmpty`
- `awaitIdle`
- `awaitNextEnqueue`
- `awaitNextCompletion`
- `awaitNextFailure`
- `awaitCapacity`

Runtime tuning candidates:

- `setConcurrency(n)`
- `setMaxRetries(n)`
- `setLimit(limit)`
- `requestWake`
- `rebalance`

These are candidates, not commitments. Trim aggressively before public API.

## Handler, retry, and hook model

### Handler

Use `handler`, not `forkWith`, for the post-item result callback:

```typescript
readonly handler?: (
  item: T,
  exit: Exit.Exit<R, E>,
  ctx: HandlerContext<T, R, E>,
) => Effect.Effect<void>;
```

Rules:

- The handler receives `Exit<R, E>` directly.
- The handler is forked into a managed fiber and must not block workers from
  taking the next item.
- There is no automatic retry on failure. Retry policy belongs to userland.
- `ctx.retry` re-enqueues the same item at the back of the same priority queue.
  It is not immediate re-execution.
- `retries` is a cap for handler-triggered retry, not an automatic retry count.
- When exhausted, `onRetryExhausted` / lifecycle equivalent runs.

### Context metadata

Both effect and handler contexts should expose:

- `attempts` - how many times the item has been processed, with `1` meaning the
  first attempt.
- `enqueuedAt` - when the item first entered the queue; retries preserve it.
- `priority` - the original priority level for the current queue entry.

The effect context should expose guarded enqueue helpers and protect against
self-enqueue by reference and by configured key. The handler context can expose
more powerful, unguarded enqueue helpers because it is the explicit routing
decision point.

### Hooks

Replace special storage-oriented callbacks with lifecycle hooks:

- `onEnqueued(items, controls)`
- `onEnqueueRejected(error, controls)`
- `onStarted(item, controls)`
- `onCompleted(item, exit, controls)`
- `onFailed(item, cause, controls)`
- `onSettled(item, exit, controls)`
- `onRetryScheduled(item, controls)`
- `onRetryExhausted(item, cause, controls)`
- `onDeadLettered(item, reason, controls)`
- `onDropped(itemOrKey, reason, controls)`
- `onEmpty(controls)`
- `onDrained(controls)`
- `onPaused(controls)`
- `onResumed(controls)`
- `onQuiesced(controls)`
- `onShutdown(controls)`
- `onCleared(count, controls)`
- `onReleaseStarted(options, controls)`
- `onReleased(entries, controls)`
- `onReleaseFailed(error, controls)`
- `onDrainStarted(options, controls)`
- `onDrainCompleted(result, controls)`
- `onDrainFailed(error, controls)`

`persist` becomes unnecessary because `ProcessStore` handles storage.
`refill` becomes a normal `onEmpty` or `onDrained` behavior that can call
queue-bound controls to add more work.

Hook event payloads should include queue-bound metadata where relevant:

- queue name,
- item key,
- entry id,
- batch id,
- release id,
- priority,
- attempts,
- enqueued time,
- started time,
- completed time,
- source group/deployment,
- attributes.

## Rate limiting

The queue should support an Effect-style rate limit hook in config, but the
exact API must be verified against the Effect version in this repo before
implementation. Candidate shape:

```typescript
readonly limit?: Effect.Effect<RateLimiter, never, RLimit>;
```

The queue would acquire the limiter during setup and call it before processing
each item, using delay/backpressure rather than dropping by default. If Effect's
current `RateLimiter` API does not match the desired positional examples, add a
thin local adapter rather than guessing.

## Future add-on: batch waiting

Waiting for a batch to finish is valuable, but it should not be part of the
first implementation pass. Save it as a follow-up after enqueue metadata,
store events, and queue controls are stable.

Candidate future controls:

- `awaitBatch(batchId)`
- `batchStatus(batchId)`
- `releaseBatch(batchId, options)`

Candidate batch metadata:

- `batchId`,
- `batchSize`,
- `enqueuedAt`,
- `source`,
- `attributes`.

Candidate batch status:

- total,
- pending,
- in-flight,
- completed,
- failed,
- retried,
- exhausted,
- started at,
- completed at.

## Safety rules

- Effects receive guarded controls by default.
- Hooks receive more powerful controls, but self-enqueue and runaway retry loops
  should have guardrails.
- Storage events are emitted independently of hook success or failure.
- Hook failures should not corrupt queue state.
- Lifecycle hooks must document whether they are sequenced or forked.
- Invalid schema payloads must not enter the queue.
- Enqueue validation failures must be returned to the caller, not sent to the
  item handler.

## ProcessGroup integration

`ProcessGroup` should not have a private queue protocol. It should operate on
the same `QueueHandle` a normal application receives from the queue service.

This keeps the queue service as the source of truth for queue control.

A queue can be used by processes through normal Effect dependencies without
being listed in a group. Adding a queue to a group means the group contract
exposes queue controls and status for local `ControlService` and remote
`ProcessManager` callers. It does not mean the group owns all application
communication with that queue.

Standalone remote queue service access is stricter than group membership. A
queue registered in a group can be controlled through the group endpoint, but
yielding the queue service itself from either a local or remote provider requires
`QueueResource.RemoteService`, including a required `itemSchema`.

## Graduation criteria

- `QueueHandle` exposes the full chosen control surface.
- Queue config supports optional `itemSchema`; contract exports
  `QueueItemCodecDescriptor` when present.
- Public enqueue no longer accepts broad `Iterable<T>`.
- Single and batch enqueue have distinct validation error types derived from
  schema presence.
- `enqueue` supports metadata-aware entries and atomic/partial batch modes.
- Remote/control enqueue decodes with target queue `itemSchema` before internal
  mutation.
- `release` can export transferable encoded payloads.
- `ProcessGroup` delegates only through `QueueHandle`.
- `ProcessGroupQueueContract` includes optional `item` descriptor for queues
  with `itemSchema`.
- Queue effects and hooks receive queue-bound controls.
- Planned lifecycle hooks cover enqueue, validation rejection, item start,
  completion, failure, settlement, retry, exhaustion, dead-letter, drop, empty,
  drain, pause, resume, quiesce, shutdown, clear, release start, release
  success, and release failure.
- `persist` and `refill` are removed or renamed into lifecycle hooks.
- Queue tests cover hook-triggered enqueue, retry, empty refill, and lifecycle
  operations.
- Handoff tests cover schema-compatible and schema-incompatible target queues.
