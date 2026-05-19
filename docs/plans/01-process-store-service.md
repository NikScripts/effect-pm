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
- `RuntimeObserver.layerProcessStore` persists `RuntimeStateChange` values as
  `runtime.state.changed` analytics events.
- `ProcessStore.events(query)` reads generic analytics events from the memory,
  file-backed, and Prisma implementations.
- `ProcessStore.file(filePath)` / `ProcessStore.fileLayer(filePath)` provide
  local durable NDJSON storage through Effect `FileSystem`.
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

## Indexed runtime record envelope

Move the durable storage row from an analytics-only event envelope toward a
generic indexed runtime record. Runtime modules should still write through
semantic `ProcessStore` sub-surfaces; `ProcessStore` owns the mapping from
module vocabulary to generic indexed columns before handing rows to
`RuntimeStorage`.

Candidate normalized row:

```typescript
interface RuntimeRecord {
  readonly id: string
  readonly type: string
  readonly occurredAt: DateTime.Utc

  /**
   * Generalized runtime owner. A queue, run resource, HTTP resource, group,
   * schedule runtime, or traditional process all gets represented as a
   * process-like runtime unit.
   */
  readonly processType: string
  readonly processId: string

  /**
   * The thing inside the process-like runtime that this row is about:
   * queue entry, dedupe key, process execution, HTTP request, schedule entry,
   * config version, etc.
   */
  readonly subjectType?: string
  readonly subjectId?: string

  /** Dedupe / idempotency key when relevant. */
  readonly key?: string

  /** Generic indexed slots for record-specific identifiers. */
  readonly indexA?: string
  readonly indexB?: string
  readonly indexC?: string
  readonly indexD?: string
  readonly indexE?: string
  readonly indexF?: string
  readonly indexG?: string
  readonly indexH?: string

  /**
   * Ordered semantic names for index slots. Position maps to slot:
   * indexNames[0] = indexA, indexNames[1] = indexB, etc.
   */
  readonly indexNames?: ReadonlyArray<string>

  /** Typed event/body data. Optional for marker facts where columns suffice. */
  readonly payload?: JsonValue

  /** User/app metadata not required by core projections. */
  readonly attributes?: JsonValue
}
```

Why this shape:

- `processId` is the primary owner id for all controllable runtime units.
  Resources are treated as special process-like runtimes for storage and
  projection purposes.
- `subjectId` covers the primary nested id: queue `entryId`, dedupe key id,
  process execution id, HTTP request id, schedule entry id, etc.
- `key` is first-class because dedupe/idempotency lookups are hot enough to
  deserve a named indexed column. It is indexed, but it must not be unique:
  storage records key history (`added`, `duplicate rejected`, `released`,
  `manual add`, `manual remove`, `cleared`) and repeated keys over time are
  expected.
- `indexA` through `indexH` provide eight generic indexed string slots for
  module-specific identifiers such as batch id, release id, handoff id, route
  id, operation id, or deployment id.
- `indexNames` preserves the historical meaning of each index slot even if a
  future package version changes the mapping.
- `payload` and `attributes` are optional JSON so marker facts and highly indexed
  records do not have to store redundant payload data.

Example queue entry enqueue mapping:

```typescript
yield* store.queue.entryEnqueued({
  processId: queueId,
  entryId,
  key,
  batchId,
  releaseId,
  sourceResourceId,
  payload,
})

// ProcessStore normalizes to RuntimeStorage:
{
  type: "queue.entry.enqueued",
  processType: "queue",
  processId: queueId,
  subjectType: "queue-entry",
  subjectId: entryId,
  key,
  indexA: batchId,
  indexB: releaseId,
  indexC: sourceResourceId,
  indexNames: ["batchId", "releaseId", "sourceResourceId"],
  payload,
}
```

Semantic module APIs should remain preferred:

```typescript
yield* store.queue.entries({
  processId: "@app/EmailQueue",
  batchId: "batch-1",
})
```

Generic/raw APIs can exist for projections and custom records:

```typescript
yield* store.records({
  processId: "@app/EmailQueue",
  indexA: "batch-1",
})
```

Normal application and runtime module code should use semantic names. Projection
tools, custom records, and storage adapters may use raw index slots.

### Queue entry storage and projection

Queue entry storage should use a delta/event strategy rather than storing the
full entry snapshot on every state change. Store full item + metadata snapshots
only when they are operationally needed:

- `queue.entry.enqueued` stores the full item and metadata snapshot.
- `queue.entry.released` stores the full item and metadata snapshot because this
  is the handoff/export boundary.
- `queue.entry.started` stores only indexed ids, key, type, and `occurredAt`.
- `queue.entry.completed`, `queue.entry.failed`, `queue.entry.retried`,
  `queue.entry.exhausted`, and `queue.entry.interrupted` store only relevant
  deltas such as status, attempts, duration, error, and interruption facts.

Use the top-level `occurredAt` column as the timestamp for each event:

- enqueue time = `queue.entry.enqueued.occurredAt`,
- worker start time = `queue.entry.started.occurredAt`,
- completion/failure time = completed/failed `occurredAt`,
- interruption time = interrupted `occurredAt`,
- release time = released `occurredAt`.

Do not duplicate those same timestamps in payload unless a record needs a
different domain-specific time.

Projection APIs should be module-facing and semantic:

```typescript
yield* store.queue.entry({
  processId: "@app/EmailQueue",
  entryId: "entry-123",
})

yield* store.queue.entriesByKey({
  processId: "@app/EmailQueue",
  key: "delivery:abc",
})
```

`store.queue.entry(...)` returns one combined report for a queue entry. It
groups records at the entry level, merges deltas by `occurredAt`, and returns:

- current `entryId`,
- `identifiers` lineage,
- item snapshot from enqueue or release records,
- metadata snapshot,
- lifecycle facts,
- timings derived from `occurredAt`,
- attempts/status/error/release information.

`store.queue.entriesByKey(...)` returns multiple projected entry reports because
one dedupe key can legitimately appear across multiple queue entries over time.

Retries should be grouped through enqueue metadata: each retry creates a new
`entryId`, appends it to `identifiers`, increments attempts, and writes an
enqueue/retry record that lets projection reconstruct the full retry chain
without requiring every later event to duplicate the item snapshot.

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
