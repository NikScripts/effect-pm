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

## Schema model

Queues may optionally declare a schema or codec for their item payload.

Rules:

- no schema means no runtime validation,
- schema present means every public enqueue path validates,
- no separate validation booleans,
- no validation-before-effect pass,
- release / handoff requires schema or codec support,
- target queue validates released entries with its own schema,
- schema mismatch is allowed and handled as an enqueue validation failure.

The target queue does not need to prove it has the same schema as the source.
That lets a new deployment accept old payloads if its schema is compatible or
has migration logic. If validation fails, the enqueue call fails with typed
errors and the caller decides what to do.

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

- `enqueue(entry)`
- `enqueue(entries)`

`add`, `prioritize`, and `defer` are convenience methods over `enqueue`.

Candidate enqueue entry:

- `item` or encoded `payload`,
- `priority`,
- `attempts`,
- `enqueuedAt`,
- `key`,
- `entryId`,
- `attributes`,
- `source`,
- `releaseId`.

## Enqueue error typing

Use overloads and conditional configuration typing so callers only see errors
that can occur for the input they passed.

When no schema exists:

- single enqueue validation error type is `never`,
- batch enqueue validation error type is `never`.

When schema exists:

- single item methods can fail with `QueueItemValidationError`,
- array methods can fail with `QueueBatchValidationError`.

Candidate handle type:

```ts
interface QueueHandle<
  T,
  R = void,
  E = never,
  ItemEnqueueE = never,
  BatchEnqueueE = never
> {
  readonly add: {
    (item: T): Effect.Effect<void, ItemEnqueueE>
    (items: ReadonlyArray<T>): Effect.Effect<void, BatchEnqueueE>
  }
}
```

`QueueItemValidationError` should describe one invalid input:

- queue name,
- operation,
- input,
- parse error,
- schema name / version when available.

`QueueBatchValidationError` should describe batch failures:

- queue name,
- operation,
- failures with input index and parse error,
- accepted entries when partial mode is used,
- rejected entries,
- batch mode.

## Batch behavior

Support two modes at the advanced boundary:

- `atomic` - if any item fails validation, enqueue none,
- `partial` - enqueue valid entries and report invalid entries.

Convenience methods should start with `atomic` semantics. Advanced `enqueue`
can support `partial` once the result/error shape is settled.

Partial mode is especially useful for ProcessManager handoff, where a target
deployment might accept most released entries but reject entries whose payloads
no longer match the target schema.

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
- `requestWake`
- `rebalance`

These are candidates, not commitments. Trim aggressively before public API.

## Hook model

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

## Graduation criteria

- `QueueHandle` exposes the full chosen control surface.
- Queue config supports schema or codec validation.
- Public enqueue no longer accepts broad `Iterable<T>`.
- Single and batch enqueue have distinct validation error types.
- `enqueue` supports metadata-aware entries.
- `release` can export transferable entries.
- `ProcessGroup` delegates only through `QueueHandle`.
- Queue effects and hooks receive queue-bound controls.
- Planned lifecycle hooks cover enqueue, validation rejection, item start,
  completion, failure, settlement, retry, exhaustion, dead-letter, drop, empty,
  drain, pause, resume, quiesce, shutdown, clear, release start, release
  success, and release failure.
- `persist` and `refill` are removed or renamed into lifecycle hooks.
- Queue tests cover hook-triggered enqueue, retry, empty refill, and lifecycle
  operations.
- Handoff tests cover schema-compatible and schema-incompatible target queues.
