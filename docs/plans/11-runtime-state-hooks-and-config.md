# 11 - Runtime state, listener hooks, history, and mutable config

## Status

Planned direction with unsettled API names. Most of this model should be
implemented, but the final public shape must line up with
[07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md).

## Intent

Define a future runtime model where processes and resources own their live
state, publish state changes as they happen, and optionally persist state
history through `ProcessStore` / storage. This is the state/history foundation
that typed `ProcessGroup` contracts and remote `ProcessManager` clients should
consume.

The core concern: the store should not need a new method every time a process or
resource grows a feature. New modules should define their own state and signal
types while sharing stable storage and observation building blocks.

## Why this exists

Current runtime pieces expose state in different ways:

- `Process.getStatus()` computes process status from its internal mirror plus
  stored execution history.
- `QueueResource` exposes queue state through `size`, `sizes`, `completed`,
  `pause`, `resume`, `shutdown`, and `clear`.
- `RunResource` and `HttpApiResource` are gates, but they do not expose runtime
  counters such as in-flight count, waiting count, or latency.
- `ProcessGroup` derives aggregate status by calling process and queue handles.

That works for today's APIs, but it does not scale well if `ProcessStore` keeps
adding feature-specific reads such as `getQueueItems`, `getResourceLifecycle`,
`getQueueSummary`, and so on.

## Design direction

Resources should push state changes when they happen:

1. A process or resource mutates internal runtime state.
2. It produces a typed state snapshot.
3. It publishes a typed signal for listeners.
4. It writes state history and/or facts to the store when storage is available.

`ProcessStore` should not call `getStatus()` to discover changes after the fact.
The runtime already knows when state changes. It should publish the change at
the mutation point.

## Vocabulary

### Runtime ref

Every runtime component needs a stable identity.

```typescript
export interface RuntimeRef {
  readonly kind: "process" | "queue" | "run-resource" | "http-api-resource" | "group" | string;
  readonly id: string;
}
```

### State snapshot

A state snapshot is the current status shape for one runtime component. Each
resource owns its own state type.

```typescript
export interface RuntimeStateBase {
  readonly ref: RuntimeRef;
  readonly observedAt: number;
  readonly configVersion: number;
}
```

### State change

State changes are history records. The previous state can be absent for the
first observation.

```typescript
export interface RuntimeStateChange<S extends RuntimeStateBase> {
  readonly id: string;
  readonly ref: RuntimeRef;
  readonly changedAt: number;
  readonly reason: string;
  readonly previous: S | null;
  readonly current: S;
}
```

### Runtime fact

Facts are discrete occurrences that are not necessarily full state snapshots:
execution completed, retry exhausted, enqueue rejected, config changed, HTTP
request failed, and similar events.

```typescript
export interface RuntimeFact<P = unknown> {
  readonly id: string;
  readonly ref: RuntimeRef;
  readonly type: string;
  readonly occurredAt: number;
  readonly payload: P;
  readonly attributes?: Record<string, unknown>;
}
```

## Storage boundary

The swappable dependency should be stable and generic. Feature-specific reads
should live in typed helpers or projections above this interface.

```typescript
export interface RuntimeStorage {
  readonly appendStateChange: (
    change: RuntimeStateChange<RuntimeStateBase>,
  ) => Effect.Effect<void>;

  readonly appendFact: (fact: RuntimeFact) => Effect.Effect<void>;

  readonly latestState: (
    ref: RuntimeRef,
  ) => Effect.Effect<Option.Option<RuntimeStateBase>>;

  readonly stateHistory: (
    ref: RuntimeRef,
    query?: HistoryQuery,
  ) => Effect.Effect<ReadonlyArray<RuntimeStateChange<RuntimeStateBase>>>;

  readonly facts: (
    query?: FactQuery,
  ) => Effect.Effect<ReadonlyArray<RuntimeFact>>;
}
```

Open naming question: this could be `RuntimeStorage`, with `ProcessStore` as
package logic on top, or `ProcessStore` could keep the public name while a lower
level storage adapter gets a new name. The important line is:

- storage stores generic state changes and facts;
- process / queue / resource modules define typed state, typed facts, and typed
  projections.

## Listener and hook model

The goal is to support multiple listeners for the same hook, including
listeners attached after construction. Config hooks should remain convenient,
but not be the only extension point.

### Current problem

Queue hooks are single optional config fields:

```typescript
export interface QueueResourceConfig<T, R, E> {
  readonly onEnqueue?: (
    items: ReadonlyArray<T>,
    priority: Priority,
  ) => Effect.Effect<void>;

  readonly onComplete?: (
    item: T,
    exit: Exit.Exit<R, E>,
    elapsed: Duration.Duration,
  ) => Effect.Effect<void>;

  readonly onRetryExhausted?: (
    item: T,
    cause: Cause.Cause<E>,
  ) => Effect.Effect<void>;
}
```

That makes simple cases easy, but it does not support multiple subscribers or
runtime attachment.

### Candidate listener API

This is the style we discussed, but the DX is not settled:

```typescript
const remove = yield* queue.addListener("retryExhausted", ({ item, cause }) =>
  deadLetter.write({ item, cause }),
);

yield* queue.addListener("stateChanged", ({ previous, current }) =>
  current.size.total > current.capacity * 0.9
    ? notifyOps("email queue near capacity")
    : Effect.void,
);

yield* remove;
```

`addListener` should probably return an effect that unregisters the listener.
If listeners are scope-bound, the API could instead be:

```typescript
yield* queue.listen("retryExhausted", ({ item, cause }) =>
  deadLetter.write({ item, cause }),
);
```

where `listen` requires `Scope.Scope` and unregisters automatically when the
scope closes.

### Effect-native alternatives

We should inspect Effect's `PubSub`, `Stream`, and `SubscriptionRef` patterns
before choosing final names. A possible shape:

```typescript
export interface ObservableRuntime<S, Signal> {
  readonly state: Effect.Effect<S>;
  readonly changes: Stream.Stream<RuntimeStateChange<S>>;
  readonly signals: Stream.Stream<Signal>;

  readonly listen: <Type extends SignalType<Signal>>(
    type: Type,
    handler: (signal: SignalByType<Signal, Type>) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;
}
```

Open questions:

- Is `listen("event", handler)` too callback-like?
- Should public observation prefer `Stream` and keep `listen` as a helper?
- Should listener failure be logged, stored, retried, or interrupt the listener
  fiber?
- Should listener execution order be deterministic?
- Should config hooks be implemented internally as listeners?

## Process state

Current process status already contains useful state:

```typescript
export interface ProcessDetails {
  readonly lastRun: Date | null;
  readonly executions: number;
  readonly firstStartup: Date | null;
  readonly armed: boolean;
  readonly nextScheduleTransition: Option.Option<Date>;
  readonly nextPollCadence: Option.Option<Duration.Duration>;
  readonly activeInstances: number;
  readonly nextTriggerRun: Option.Option<Date>;
}
```

Potential future state:

```typescript
export interface ProcessRuntimeState extends RuntimeStateBase {
  readonly ref: RuntimeRef & { readonly kind: "process" };
  readonly status: "stopped" | "starting" | "running" | "stopping" | "failed";
  readonly lastRunAt: number | null;
  readonly firstStartupAt: number | null;
  readonly executions: number;
  readonly failures: number;
  readonly activeInstances: number;
  readonly armed: boolean;
  readonly nextScheduleTransitionAt: number | null;
  readonly nextPollCadenceMs: number | null;
  readonly nextTriggerRunAt: number | null;
}
```

Potential process signals:

```typescript
type ProcessSignal =
  | { readonly type: "stateChanged"; readonly change: RuntimeStateChange<ProcessRuntimeState> }
  | { readonly type: "started"; readonly state: ProcessRuntimeState }
  | { readonly type: "stopped"; readonly state: ProcessRuntimeState }
  | { readonly type: "tickStarted"; readonly scheduleId: Option.Option<string> }
  | { readonly type: "tickCompleted"; readonly durationMs: number }
  | { readonly type: "tickFailed"; readonly error: unknown }
  | { readonly type: "configChanged"; readonly change: ProcessConfigChange };
```

## Queue state

Potential future queue state:

```typescript
export interface QueueRuntimeState extends RuntimeStateBase {
  readonly ref: RuntimeRef & { readonly kind: "queue" };
  readonly status: "running" | "paused" | "shutdown";
  readonly size: {
    readonly high: number;
    readonly normal: number;
    readonly low: number;
    readonly total: number;
  };
  readonly capacity: number;
  readonly completed: number;
  readonly failed: number;
  readonly retried: number;
  readonly exhausted: number;
  readonly activeWorkers: number;
  readonly inFlight: number;
  readonly handlerFibers: number;
  readonly hookFibers: number;
  readonly concurrency: number;
  readonly remainingCapacity: number;
  readonly throttleMs: number | null;
  readonly rateLimit: {
    readonly enabled: boolean;
    readonly delayed: number;
  } | null;
}
```

Additional queue state notes from the QueueResource v2 plan:

- Worker, handler, and hook fibers should be owned by `FiberSet`; state snapshots
  can report counts without exposing fibers.
- `Latch` open/closed state should drive `running` vs `paused`.
- `clear` should record the number of pending items removed and release dedup
  keys for those items.
- Handler-triggered retries should preserve `enqueuedAt`, priority, and attempt
  history.
- Rate-limit state is optional until the actual Effect rate limiter integration
  is designed.

Potential queue signals:

```typescript
type QueueSignal<T, E> =
  | { readonly type: "stateChanged"; readonly change: RuntimeStateChange<QueueRuntimeState> }
  | { readonly type: "enqueued"; readonly items: ReadonlyArray<T>; readonly priority: Priority }
  | { readonly type: "enqueueRejected"; readonly reason: string; readonly item: unknown }
  | { readonly type: "itemStarted"; readonly item: T; readonly attempts: number }
  | { readonly type: "itemCompleted"; readonly item: T; readonly durationMs: number }
  | { readonly type: "itemFailed"; readonly item: T; readonly cause: Cause.Cause<E> }
  | { readonly type: "retryScheduled"; readonly item: T; readonly attempts: number }
  | { readonly type: "retryExhausted"; readonly item: T; readonly cause: Cause.Cause<E> }
  | { readonly type: "cleared"; readonly itemsCleared: number }
  | { readonly type: "rateLimitDelayed"; readonly item: T; readonly delayMs: number }
  | { readonly type: "configChanged"; readonly change: QueueConfigChange };
```

### Enqueue validation and history (plan 02)

When `itemSchema` is configured, validation failures happen **before** queue
state mutation. They must not increment `size`, `completed`, or in-flight
counters, and must not invoke the item `effect`.

**Signals** — extend `enqueueRejected` (or add `enqueueValidationFailed`) with
structured payload aligned to `QueueItemValidationError` /
`QueueBatchValidationError`:

```typescript
| {
    readonly type: "enqueueValidationFailed"
    readonly operation: string
    readonly mode: "atomic" | "partial" | "single"
    readonly failures: ReadonlyArray<{
      readonly index?: number
      readonly issues: ReadonlyArray<ParseResult.ArrayFormatterIssue>
    }>
    readonly acceptedCount?: number
    readonly codecId?: string
  }
```

Do not put full invalid `input` in persisted facts by default — payloads may be
large or sensitive. Store `codecId`, operation, index, and formatted issues;
keep raw `input` in the error returned to the caller only.

**Facts** — append a generic `RuntimeFact` on validation failure when storage is
available:

```typescript
{
  type: "queue.enqueue.validation_failed",
  ref: { kind: "queue", id: queueId },
  payload: {
    operation: "add",
    mode: "atomic",
    failureCount: 2,
    codecId: "@app/EmailQueue/item@v1",
  },
}
```

**State snapshots** — optional counters on `QueueRuntimeState` for ops
visibility (not required for v1):

- `enqueueRejected: number` — validation + dedup + shutdown rejections,
- `lastEnqueueRejectedAt: number | null`.

**Hooks** — `onEnqueueRejected` receives the validation error and queue-bound
controls; it runs instead of `onEnqueued`. Hook failure must not affect the
error returned to the enqueue caller.

**Mutable config** — `itemSchema` remains non-dynamic (see **Probably not
dynamic** below). Changing encoded shape requires a new queue declaration or
deployment handoff, not hot config patch.

## RunResource state

Potential future state for a generic effect gate:

```typescript
export interface RunResourceState extends RuntimeStateBase {
  readonly ref: RuntimeRef & { readonly kind: "run-resource" };
  readonly concurrency: number;
  readonly inFlight: number;
  readonly waiting: number;
  readonly completed: number;
  readonly failed: number;
  readonly interrupted: number;
  readonly averageDurationMs: number | null;
}
```

Potential stored data:

- run started;
- run completed;
- run failed;
- run interrupted;
- wait time before permit acquisition;
- duration while holding permit;
- config changes to concurrency or wrapped behavior.

## HttpApiResource state

Potential future state:

```typescript
export interface HttpApiResourceState extends RuntimeStateBase {
  readonly ref: RuntimeRef & { readonly kind: "http-api-resource" };
  readonly baseUrl: string | null;
  readonly concurrency: number | null;
  readonly inFlight: number;
  readonly completedRequests: number;
  readonly failedRequests: number;
  readonly averageLatencyMs: number | null;
}
```

Potential stored data:

- request started;
- request completed;
- request failed;
- route or endpoint name when available;
- status code when available;
- request latency;
- concurrency/config changes.

## ProcessGroup / ProcessManager state

The concrete PG/PM contract design lives in
[07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md).
This section defines the state data that design should consume.

Potential group state:

```typescript
export interface RuntimeGroupState extends RuntimeStateBase {
  readonly ref: RuntimeRef & { readonly kind: "group" };
  readonly processCount: number;
  readonly runningProcesses: number;
  readonly stoppedProcesses: number;
  readonly queueCount: number;
  readonly healthy: boolean;
}
```

Potential responsibilities:

- `ProcessManager` remains the lifecycle controller.
- `ProcessGroup` is an interface/view over selected processes/resources.
- `ControlService` or a future web server exposes group controls and status.
- Groups should read current state from runtime handles or projections, not own
  independent duplicate truth.

## Mutable config after start

Mutable config should be explicit, versioned, and recorded. Every successful
change should produce:

1. a new config version;
2. a state change if visible status changed;
3. a `configChanged` fact/signal;
4. validation errors when the change is not supported.

### Likely feasible

- Swap process effect for future runs.
- Swap queue item effect for future items.
- Replace or append handler/listener hooks.
- Change retry limits for future retries.
- Change throttling if implemented through a mutable gate/ref.
- Change queue rate limit if implemented through a replaceable limiter or
  ref-backed local adapter.
- Change schedule entries through schedule controls.
- Pause/resume queues and process groups.
- Toggle enabled/disabled flags.

### Possibly feasible with care

- Change queue concurrency by adding/removing worker fibers.
- Change RunResource or HttpApiResource concurrency if gates are implemented
  through mutable permits or a replaceable gate.
- Swap queue handler and lifecycle hooks for future items.
- Change queue priority policy for future dequeues.
- Change timeout/retry policies for future work.

### Probably not dynamic

- Queue capacity for existing bounded queues.
- Resource service name or Context tag.
- Item type or `itemSchema` / `QueueItemCodecDescriptor` (encoded shape changes
  require new declaration or deployment handoff per
  [02](./02-queue-controls-and-hooks.md)).
- Required environment type.
- Storage backend for an already-running runtime.
- Process schedule implementation layer if fibers are already running against a
  specific schedule service.

### Candidate API

```typescript
yield* queue.updateConfig({
  retries: 5,
  throttle: Duration.millis(250),
});

yield* queue.setEffect((item, ctx) => newQueueEffect(item, ctx));

yield* process.updateConfig({
  enabled: false,
});

yield* process.setEffect(newProcessEffect);
```

Open questions:

- Should config mutation live on each resource handle or only on
  `ProcessManager`?
- Should changes be immediate, next item/run only, or configurable per field?
- Should config patches be validated by schemas?
- How should failed config updates be represented in storage?

## Store expansion

The store should become more than append-only analytics, but it should not
become a growing list of feature-specific methods.

Prefer:

- generic state history;
- generic facts/events;
- latest state lookup;
- typed projections owned by each module.

Avoid:

- adding a new storage method for every resource feature;
- making storage call resource `getStatus()` functions;
- persisting user payloads by default;
- coupling storage tables to every new runtime type.

## Candidate implementation phases

1. Define state/fact/storage vocabulary in docs only.
2. Add an internal runtime observer used by one low-risk resource.
3. Add scoped listener support for that resource.
4. Persist state changes through the current store when available.
5. Add typed projections over state history.
6. Decide whether the lower-level storage dependency should be renamed.
7. Apply the pattern to process, queue, run resource, HTTP resource, and groups.

## Graduation criteria

- Runtime state and fact types are stable enough for public TSDoc.
- At least one process/resource publishes state changes without storage polling
  `getStatus()`.
- Multiple listeners can subscribe to the same signal.
- Listener failures are isolated and documented.
- Config mutations are versioned, validated, and stored.
- `ProcessStore` / storage shape does not grow when a new resource-specific
  projection is added.
- The `ProcessGroup` / `ProcessManager` redesign can consume the same state
  model without owning duplicate runtime truth.
