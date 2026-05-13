# 02 - Queue controls and lifecycle hooks

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

## Candidate controls

Enqueue and routing:

- `add(items)`
- `prioritize(items)`
- `defer(items)`
- `offer(items, options)`
- `offerOne(item, options)`
- `offerBatch(items, options)`
- `retry`
- `retryAfter(duration)`
- `retryAt(instant)`
- `requeue(item, options)`
- `deadLetter(item, reason)`
- `drop(itemOrKey, reason)`
- `dropCurrent(reason)`
- `replace(key, item)`
- `hasActiveKey(key)`

Lifecycle:

- `pause`
- `resume`
- `shutdown`
- `clear`
- `drain`
- `awaitDrained`
- `awaitIdle`
- `awaitShutdown`
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
- `onStarted(item, controls)`
- `onCompleted(item, exit, controls)`
- `onFailed(item, cause, controls)`
- `onSettled(item, exit, controls)`
- `onRetryScheduled(item, controls)`
- `onRetryExhausted(item, cause, controls)`
- `onEmpty(controls)`
- `onDrained(controls)`
- `onPaused(controls)`
- `onResumed(controls)`
- `onShutdown(controls)`
- `onCleared(count, controls)`

`persist` becomes unnecessary because `ProcessStore` handles storage.
`refill` becomes a normal `onEmpty` or `onDrained` behavior that can call
queue-bound controls to add more work.

## Safety rules

- Effects receive guarded controls by default.
- Hooks receive more powerful controls, but self-enqueue and runaway retry loops
  should have guardrails.
- Storage events are emitted independently of hook success or failure.
- Hook failures should not corrupt queue state.
- Lifecycle hooks must document whether they are sequenced or forked.

## ProcessGroup integration

`ProcessGroup` should not have a private queue protocol. It should operate on
the same `QueueHandle` a normal application receives from the queue service.

This keeps the queue service as the source of truth for queue control.

## Graduation criteria

- `QueueHandle` exposes the full chosen control surface.
- `ProcessGroup` delegates only through `QueueHandle`.
- Queue effects and hooks receive queue-bound controls.
- `persist` and `refill` are removed or renamed into lifecycle hooks.
- Queue tests cover hook-triggered enqueue, retry, empty refill, and lifecycle
  operations.
