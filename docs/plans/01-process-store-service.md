# 01 - ProcessStore as the storage service

## Status

Planned.

## Intent

Turn `ProcessStore` into the storage service it was meant to be: the stable
interface between `Process`, `QueueResource`, future resources, and whichever
storage implementation an application chooses.

The core package should provide a few useful implementations, but applications
must be able to write their own implementation without changing process or
queue code.

## Current gap

`ProcessStore` is currently shaped like append-only analytics:

- append process execution events,
- append process lifecycle events,
- append queue item / queue lifecycle events,
- read process execution and process lifecycle history.

It does not yet expose the broader storage boundary needed for queues,
resources, projections, subscriptions, or custom backends.

## Target model

`ProcessStore` becomes the durable event and projection boundary for runtime
activity.

It should own:

- process execution history,
- process lifecycle history,
- queue item history,
- queue lifecycle history,
- queue enqueue rejection / validation history,
- queue release and handoff history,
- resource lifecycle history,
- projected summaries,
- optional event streaming,
- custom backend integration.

It should not own:

- user domain tables,
- mutable schedule truth by default,
- queue item payload storage unless an implementation explicitly chooses that,
- business-specific retry or dead-letter policy.

## Storage implementations

Provide:

- in-memory store for tests and examples,
- Prisma-backed store for durable SQL persistence,
- file-backed store using Effect `FileSystem` for local durable development and
  lightweight deployments,
- no-op store for applications that want zero persistence,
- test store with inspection helpers.

Leave room for:

- SQLite-specific store,
- remote store over HTTP/RPC,
- user-provided store with custom event routing.

## Interface direction

Keep the store event-first, but make reads first-class.

Phase C boundary: do not grow storage by adding one method for every runtime
feature. The candidate list below is historical direction, not a mandate to
implement all reads directly on `ProcessStoreInterface`. `ProcessStore` is the
rich module-facing singleton facade; `RuntimeStorage` is the generic swappable
persistence port underneath it. Runtime modules depend on `ProcessStore`, and
storage adapters implement `RuntimeStorage`.

### Final service split

The final architecture has two layers:

1. **`ProcessStore`** — rich module-facing service used by `Process`,
   `QueueResource`, `RunResource`, `HttpApiResource`, and `ProcessGroup`.
2. **`RuntimeStorage`** — generic swappable persistence service used by
   `ProcessStore`.

Runtime modules should depend on `ProcessStore`, not on `RuntimeStorage`.
Storage adapters should implement `RuntimeStorage`, not module-specific APIs.

Target dependency direction:

```text
runtime module -> ProcessStore -> RuntimeStorage -> memory / Prisma / custom
```

`ProcessStore` may expose ergonomic module sub-surfaces:

```typescript
interface ProcessStore {
  readonly runtime: ProcessStoreRuntime;
  readonly process: ProcessStoreProcess;
  readonly queue: ProcessStoreQueue;
  readonly run: ProcessStoreRunResource;
  readonly http: ProcessStoreHttpApiResource;
  readonly group: ProcessStoreGroup;
}
```

`RuntimeStorage` should remain generic:

```typescript
interface RuntimeStorage {
  appendFact(fact: RuntimeFact): Effect.Effect<void>;
  appendStateChange(change: RuntimeStateChange): Effect.Effect<void>;
  facts(query?: FactQuery): Effect.Effect<ReadonlyArray<RuntimeFact>>;
  latestState(ref: RuntimeRef): Effect.Effect<Option.Option<RuntimeStateBase>>;
  stateHistory(
    ref: RuntimeRef,
    query?: HistoryQuery,
  ): Effect.Effect<ReadonlyArray<RuntimeStateChange>>;
}
```

This split lets `ProcessStore.queue.enqueueRejected(...)` be a useful
module-aware API while keeping the storage adapter surface stable forever.
`ProcessStore` owns conversion, redaction, projection, and observer bridging.
`RuntimeStorage` only persists generic records.

Current bridge status:

- `RuntimeObserver.layerProcessStore` persists `RuntimeFact` values as
  `runtime.fact.recorded` analytics events.
- State changes are not persisted yet.
- `ProcessStore.events(query)` is the next read target before projections.
- Do not add `getRunResourceFacts`, `getQueueValidationFailures`, or similar
  feature-specific reads to replace that generic query.

Candidate surface:

- `append(event)`
- `appendBatch(events)`
- `events(query)`
- `subscribe(query)`
- `getProcessExecutions(processId, opts)`
- `getProcessLifecycle(processId, opts)`
- `getQueueItems(queueId, opts)`
- `getQueueLifecycle(queueId, opts)`
- `getQueueSummary(queueId, opts)`
- `getResourceLifecycle(resourceId, opts)`
- `project(entity, opts)`

Queries should be typed and storage-neutral.

## Event envelope

Keep one envelope shape:

- `id`
- `type`
- `occurredAt`
- `entityType`
- `entityId`
- `attributes`
- payload-specific data

This keeps Prisma and custom stores simple while allowing new event types
without new storage tables.

## Queue persistence implication

`QueueResource` should not expose special `persist` and `refill` callbacks as
storage integration points.

Instead:

- built-in queue persistence is automatic when `ProcessStore` is available,
- user hooks receive queue-bound controls for custom lifecycle behavior,
- custom durable queue semantics are implemented by a custom `ProcessStore` or
  future queue storage implementation, not by special callback names.

`ProcessStore` should also record failed enqueue attempts when the runtime can
observe them, especially schema validation failures, duplicate key rejections,
and release / handoff import failures. Invalid items are not queue items yet,
but they are still operationally important events.

## Queue handoff implication

Queue handoff depends on queue-level schema or codec support.

The store should be able to record:

- release requested,
- release completed,
- release rejected,
- enqueue imported,
- enqueue validation failed,
- handoff source / target group metadata,
- release batch id.

The store does not need to understand the user payload. It can store encoded
payload metadata, attributes, and validation diagnostics supplied by the queue
runtime or storage implementation.

## Schedule persistence boundary

Do not make `ProcessStore` the default mutable schedule database.

Schedule truth is domain state and should remain app-owned unless a separate
future `ProcessScheduleStore` is introduced. `ProcessStore` can record schedule
events and executions, but it should not silently become the source of truth for
what should run.

## Graduation criteria

- `ProcessStoreInterface` supports process and queue reads.
- Queue reads no longer require ad hoc store access.
- Prisma implementation supports the expanded interface.
- Queue persistence no longer depends on `persist`.
- Queue validation and handoff events can be stored and queried.
- Docs explain how to provide a custom store.
- Examples include memory, Prisma, and custom store wiring.
