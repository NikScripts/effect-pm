# 01 - ProcessStore as the storage service

## Status

**Partially landed; superseded in part.** The combiner / facet split has
shipped (see [STORAGE.md](../STORAGE.md)). The
generic `RuntimeFact` / `RuntimeRef` / `RuntimeStateChange` vocabulary discussed
below has been **removed from the public API** in favour of per-domain facets
(`ProcessStoreRunResource`, `ProcessStoreQueueResource`, `ProcessStoreLog`,
`ProcessStoreProcessLifecycle`, …). The original `Phase 0–6` narrative is kept
below as historical context only — do **not** treat it as the current target
shape. New facets must follow the per-domain rule in
[STORAGE.md](../STORAGE.md).

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
- SQLite-backed store for no-server durable local persistence with real indexes,
- NDJSON file-backed debug store using Effect `FileSystem` for inspection,
  tests, export/import, and small local runs,
- no-op store for applications that want zero persistence,
- test store with inspection helpers.

Leave room for:

- SQLite-specific store,
- remote store over HTTP/RPC,
- user-provided store with custom event routing.

### Recommended built-in storage layers

Use these defaults once the indexed `RuntimeRecord` model lands:

1. **Memory** — tests, examples, ephemeral development.
2. **SQLite** — recommended no-server durable store. It is a local file with
   real indexes for `processId`, `subjectId`, `key`, and `indexA` through
   `indexH`. Prefer Effect's SQLite packages such as
   `@effect/sql-sqlite-node` for the Node adapter.
3. **Prisma** — integration path for applications already using Prisma and a
   central SQL database.
4. **NDJSON debug store** — append-only, human-inspectable, easy to export, but
   not the recommended indexed durable store.
5. **Custom `RuntimeStorage`** — user-provided backend.

The current single-file `ProcessStore.fileLayer(path)` is useful for small event
logs, but it should not remain the recommended durable store for broad indexed
queries once `EffectPmRecord` lands.

### NDJSON debug store

NDJSON storage should be semantically complete, even when slow:

- a query with no `runId` scans all runs,
- a query with no date range scans all dates,
- results should match SQLite/Prisma semantics,
- slow broad scans should log a warning suggesting `runId`, date-range filters,
  or a switch to SQLite/Prisma.

Use one file per runtime run:

```text
.effect-pm/records/
  2026-05-19T13-45-22.123Z__run_01HY....ndjson
  2026-05-19T14-10-01.955Z__run_01HZ....ndjson
```

Rules:

- file name starts with a safe ISO timestamp so runs sort lexically by start
  time,
- file name includes `runId` for direct run lookup,
- each line is one normalized `RuntimeRecord`,
- query planning may skip files by `runId` and/or date range when filters are
  provided,
- `all runs` remains the default semantic result when no run/date filters are
  supplied,
- use warnings, not silent result changes, when reads become expensive.

Date folders can be added later if directories become too large, but the first
debug-store shape should prefer the simpler sortable file-name convention.

Default file-backed storage safety warning:

- applies to default SQLite and default NDJSON paths under `./.effect-pm/`,
- does not apply when the user provides a custom file/directory path,
- on first-ever storage initialization, if the store has no existing records,
  log a warning:

```text
effect-pm file storage is writing runtime data to ./.effect-pm/.
Add ".effect-pm/" to .gitignore; do not commit this directory.
```

- if the store already has at least one record, do not warn,
- check after opening/creating storage but before first append.

### Store transfer utility

Switching storage layers should be easy. Add a transfer utility that copies
records from one store to another:

```typescript
yield* ProcessStore.transfer({
  from: ProcessStore.fileDebugLayer(".effect-pm/records"),
  to: ProcessStore.sqliteLayer("effect-pm.db"),
  query,
})
```

Rules:

- preserve record `id`, `runId`, `occurredAt`, indexed columns, `payload`, and
  `attributes`,
- stream or page records from the source where possible,
- append to the target through the generic record API,
- default conflict behavior is `skip` duplicate record ids,
- return counts:

```typescript
{
  read: number,
  written: number,
  skipped: number,
  failed: number,
}
```

Optional later conflict modes:

```typescript
conflict: "skip" | "fail" | "replace"
```

Default `skip` makes transfers rerunnable and safe for interrupted migrations.

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
  readonly runId: string

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
- `runId` is created when `ProcessStore` starts. `ProcessStore` should write a
  `runtime.run.started` marker so readers can discover the latest run and group
  all records from one program execution.
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
  runId,
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

### Query DSL and CRUD operations

Add a shared `Query.ts` module for both `RuntimeStorage` and `ProcessStore`.
The DSL should produce typed, immutable query / write operation values while
normalizing to adapter-friendly record filters and patches.

Use pipeable operations against services:

```typescript
yield* pipe(
  RuntimeStorage,
  Where(
    ProcessType.equals("queue"),
    ProcessId.equals(queueId),
    Occurred.after(startDate),
    Occurred.before(endDate),
  ),
  Select,
)
```

`ProcessStore` queries use the same DSL but can accept runtime declarations or
runtime family markers as the first `Where` argument:

```typescript
yield* pipe(
  ProcessStore,
  Where(
    MyQueue,
    Occurred.after(startDate),
    Occurred.before(endDate),
  ),
  Select,
)

yield* pipe(
  ProcessStore,
  Where(
    QueueResource,
    ProcessId.equals(queueId),
  ),
  Select,
)
```

Rules:

- `Where(MyQueue, ...)` means a specific resource/process id and infers the
  process type from the declaration.
- `Where(QueueResource, ...)` means all queue resources and requires an explicit
  `ProcessId.equals(...)` if the caller wants one queue.
- `Where(...)` should produce a typed query scope so later query pieces can be
  restricted to the selected process/resource family where possible.
- `RuntimeStorage` accepts raw record fields.
- `ProcessStore` accepts the same basic record fields plus semantic
  process/resource declarations.

Column helpers:

```typescript
ProcessId.equals(queueId)
ProcessId.notEquals(queueId)
ProcessId.in([queueIdA, queueIdB])
ProcessId.isNull
ProcessId.isNotNull

Occurred.after(startDate)
Occurred.before(endDate)
Occurred.between(startDate, endDate)

Created.after(startDate)
Created.before(endDate)
Created.between(startDate, endDate)
```

Boolean query composition:

```typescript
Where(
  And([
    ProcessType.equals("queue"),
    Or([
      Key.equals(key),
      Key.isNull,
    ]),
  ]),
)
```

`And`, `Or`, and `Xor` accept arrays of query blocks. Keep `Xor` only if the
semantics are explicitly tested; otherwise defer it and start with `And` / `Or`.

Ordering:

```typescript
OrderBy.occurredAt
OrderBy.occurredAt("asc")
OrderBy.createdAt("desc")
OrderBy.runId
```

Bare `OrderBy.occurredAt` defaults to descending. Implement this only for
obvious defaults where the bare form is unambiguous.

Read operation:

```typescript
yield* pipe(
  ProcessStore,
  Where(MyQueue, Key.equals(key)),
  Limit(100),
  Select,
)
```

`Select` returns raw normalized records for the current query. Projection/report
operations are deliberately deferred. Later query blocks such as
`QueueEntry.Report` can return process/resource-specific reports once queue
record semantics are implemented.

Write operations:

```typescript
yield* pipe(
  RuntimeStorage,
  Insert({
    type: "queue.entry.enqueued",
    processType: "queue",
    processId: queueId,
    subjectType: "queue-entry",
    subjectId: entryId,
  }),
)
```

```typescript
yield* pipe(
  RuntimeStorage,
  Where(ProcessId.equals(queueId), Key.equals(key)),
  Update({
    payload,
    attributes,
    indexA: null,
  }),
)
```

```typescript
yield* pipe(
  RuntimeStorage,
  Where(ProcessId.equals(queueId), Key.equals(key)),
  Update(
    Payload.set(payload),
    Attributes.set(attributes),
    IndexA.unset,
  ),
)
```

```typescript
yield* pipe(
  RuntimeStorage,
  Where(ProcessId.equals(queueId), Key.equals(key)),
  Delete,
)
```

Rules:

- `Insert`, `Update`, `Upsert`, and `Delete` are pipeable operations.
- `Update` is overloaded:
  - object patch,
  - composable column assignments such as `Payload.set(value)` and
    `IndexA.unset`.
- `Column.equals(value)` remains predicate syntax for `Where`.
- `Column.set(value)` / `Column.unset` are assignment syntax for `Update`.
- Avoid a top-level `Set` namespace because it collides conceptually with JS
  `Set`; use `Update(...)`.
- `Insert` works with id-less input at `ProcessStore` level. `RuntimeStorage`
  receives normalized records with `id`, timestamps, and `runId` already set.
- `Upsert` is allowed but must not replace `readonly: true` records.
- `Update` must never update `readonly: true` records or mutate `id`,
  `createdAt`, or `readonly`.
- `Delete` excludes readonly records by default. `Delete` can include readonly
  records only when the query explicitly includes `readonly: true`.
- `Delete` returns `{ deleted: number }`; deleting zero rows is success.
- `Update` returns `{ matched: number, updated: number }`; matched may include
  readonly rows, updated excludes readonly rows.
- Duplicate `Insert` fails with a typed storage error. Transfer utilities can
  keep default `conflict: "skip"` behavior separately.

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
