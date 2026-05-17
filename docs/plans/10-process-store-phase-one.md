# 10 - Plan 01 phase one: ProcessStore read foundation

## Purpose

This document replaces the old cross-plan roadmap with a focused implementation
plan for **phase one** of [01 - ProcessStore as the storage service](./01-process-store-service.md).

Phase one is intentionally narrow: make the current event store a reliable,
queryable boundary for the event types that already exist. It should not redesign
queue persistence, remove `persist` / `refill`, add handoff, or introduce
resource lifecycle storage. Those are later plan 01 slices.

Design note: after [11 - Runtime state, listener hooks, history, and mutable
config](./11-runtime-state-hooks-and-config.md), do not implement this phase by
adding a new store method for every resource feature. Reconcile the concrete API
with the generic state/fact storage model first. The useful parts of this plan
are the current-state audit, memory/Prisma consistency requirements, and
verification criteria.

## Relationship to Phase C runtime state/facts

Phase C should not start by renaming `ProcessStore` or by adding feature-specific
store reads. Use this document as the source of truth for the current
`ProcessStore` baseline:

- `ProcessStoreInterface` currently has `append`, `appendBatch`,
  `getProcessExecutions`, and `getProcessLifecycle`.
- Queue event types exist, and `QueueResource` can write queue completion and
  lifecycle events when a store is available.
- Runtime facts can be persisted today as `runtime.fact.recorded` analytics
  events through `RuntimeObserver.layerProcessStore`; state changes are not
  persisted yet.
- Generic `events(query)` plus dedicated queue completion/lifecycle reads have
  landed for memory, file-backed, and Prisma stores.
- Memory, file-backed, and Prisma stores must stay behaviorally aligned for
  ordering, filtering, and decode policy.

For the Phase C runtime-state boundary, keep `ProcessStore` as the rich
module-facing singleton facade and put `RuntimeStorage` underneath it as the
generic swappable persistence port. Runtime modules should depend on
`ProcessStore`, not `RuntimeStorage`; storage adapters should implement
`RuntimeStorage`, not module-specific APIs. Do not add `getRunResourceState`,
`getQueueState`, `getProcessStateMirror`, or similar one-method-per-feature APIs.
Because runtime facts now share the analytics envelope, this phase-one read plan
should prioritize:

1. add `events(query)` for existing analytics events and
   `runtime.fact.recorded`;
2. defer generic runtime state/fact append/read methods until state changes are
   persisted.

Do not add projections or feature-specific reads until `events(query)` has tests
proving that memory and Prisma storage can return the same records.

## Preflight: current code vs planned gaps

Before implementing phase one, verify these facts against the source. If any
fact changes, update this plan before coding.

| Area | Current fact | Phase-one meaning |
| ---- | ------------ | ----------------- |
| Store writes | `ProcessStoreInterface` already has `append` and `appendBatch`. | Keep the write API stable. |
| Process reads | `getProcessExecutions` and `getProcessLifecycle` already exist. | Preserve behavior and tests. |
| Queue events | `QueueItemCompletedEvent` and `QueueLifecycleChangedEvent` already exist in `src/ProcessStore.ts`. | Phase one can add reads for existing queue event types. |
| Queue enqueue history | There is no `queue.item.enqueued` event yet. | Do not pretend queue reads can show pending/enqueued history until a later event-model slice adds it. |
| Queue rejection history | There is no enqueue rejection event yet. | Plan it later; do not surface an empty or synthetic read in phase one. |
| Prisma schema | The event table stores `type`, `entityType`, `entityId`, `occurredAt`, and JSON payload. | Queue reads should need no schema migration. |
| `persist` / `refill` | They still exist on `QueueResourceConfig`. | Do not remove or deprecate them in phase one. |
| Control API | It does not expose store-backed queue history routes. | Keep control routes out of phase one. |

Known current-code issues found while writing this plan must be fixed before
phase one starts:

- Cleared keyed queue items must release their dedup keys so the same key can be
  enqueued again.
- In-memory and Prisma process execution reads must order and filter by
  `occurredAt` consistently.

Those are not future plan work. They are correctness checks that protect phase
one from building on a false baseline.

## Phase-one goal

Add a **read foundation** to `ProcessStoreInterface`:

1. A generic typed event query, `events(query)`, covering current analytics
   events and `runtime.fact.recorded`.
2. Dedicated queue reads for the queue event types already supported today.
3. Root exports for the queue analytics event types needed by users implementing
   custom stores.
4. Memory, file-backed, and Prisma implementations with the same ordering,
   filtering, and decode behavior.
5. Regression tests proving memory, file-backed, and Prisma return the same
   observable shape.

The result should let future CLI, control-service, and dashboard work read queue
history through `ProcessStore` instead of knowing queue internals.

## Non-goals

Do not include these in phase one:

- New queue event types such as `queue.item.enqueued`,
  `queue.item.enqueue_rejected`, retry-scheduled, dead-letter, or release events.
- Queue payload persistence or replay.
- Removal or deprecation of `QueueResourceConfig.persist` / `refill`.
- Store subscriptions, streams, or SSE.
- Resource lifecycle events.
- New database tables.
- Control-service v2 routes.

## API design

### Query shape

Use the existing event envelope as the query contract. The query should be
storage-neutral and should not expose Prisma-specific operators.

```typescript
export interface StoreEventQuery {
  readonly entityType?: AnalyticsEvent["entityType"];
  readonly entityId?: string;
  readonly types?: ReadonlyArray<AnalyticsEvent["type"]>;
  readonly opts?: QueryOpts;
}
```

Rules:

- `types` is an array so callers can query multiple event kinds without a new
  boolean flag.
- `opts.before` and `opts.after` apply to `AnalyticsEventBase.occurredAt`.
- Results are sorted by `occurredAt` descending.
- `opts.limit` is applied after filtering in memory and by the database in
  Prisma.
- Empty `types` means no type filter, not "return nothing"; avoid creating an
  accidental footgun.

### Interface extension

Keep the existing methods and add only the reads phase one can fulfill honestly.

```typescript
export interface ProcessStoreInterface {
  append: (event: AnalyticsEvent) => Effect.Effect<void>;
  appendBatch: (events: ReadonlyArray<AnalyticsEvent>) => Effect.Effect<void>;

  events: (query?: StoreEventQuery) => Effect.Effect<ReadonlyArray<AnalyticsEvent>>;

  getProcessExecutions: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ReadonlyArray<ProcessExecutionCompletedEvent>>;

  getProcessLifecycle: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ReadonlyArray<ProcessLifecycleChangedEvent>>;

  getQueueItemCompletions: (
    queueId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ReadonlyArray<QueueItemCompletedEvent>>;

  getQueueLifecycle: (
    queueId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ReadonlyArray<QueueLifecycleChangedEvent>>;
}
```

Use `getQueueItemCompletions`, not `getQueueItems`, in phase one. The current
event model does not record enqueue/start/pending rows, so a generic
`getQueueItems` name would overpromise.

### Public exports

The package root should export every event type needed to implement the expanded
interface:

```typescript
export {
  ProcessStore,
  type QueryOpts,
  type StoreEventQuery,
  type AnalyticsEventBase,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleTag,
  type ProcessLifecycleChangedEvent,
  type QueueItemStatus,
  type QueueItemCompletedEvent,
  type QueueLifecycleTag,
  type QueueLifecycleChangedEvent,
  type AnalyticsEvent,
  type ProcessStoreInterface,
} from "./ProcessStore";
```

This is additive public API surface. Prepare a changeset before release.

## In-memory implementation plan

Keep one append-only array. Add a small predicate pipeline rather than
duplicating filters in every read.

```typescript
const matchesStoreEventQuery =
  (query: StoreEventQuery | undefined) =>
  (event: AnalyticsEvent): boolean => {
    if (query?.entityType !== undefined && event.entityType !== query.entityType) {
      return false;
    }
    if (query?.entityId !== undefined && event.entityId !== query.entityId) {
      return false;
    }
    if (
      query?.types !== undefined &&
      query.types.length > 0 &&
      !query.types.includes(event.type)
    ) {
      return false;
    }
    return true;
  };
```

Then implement:

```typescript
events: (query) =>
  Effect.sync(() => {
    const rows = events
      .filter(matchesStoreEventQuery(query))
      .sort(byTimestampDesc((event) => event.occurredAt));
    return applyQueryOpts(rows, query?.opts, (event) => event.occurredAt);
  }),
```

Dedicated queue reads should delegate to `events` or share the same helper:

```typescript
getQueueItemCompletions: (queueId, opts) =>
  Effect.sync(() => {
    const rows = events
      .filter(
        (event): event is QueueItemCompletedEvent =>
          event.type === "queue.item.completed" &&
          event.entityType === "queue" &&
          event.entityId === queueId,
      )
      .sort(byTimestampDesc((event) => event.occurredAt));
    return applyQueryOpts(rows, opts, (event) => event.occurredAt);
  }),
```

Do not use type assertions to force event shapes. Narrow with discriminants.

## Prisma implementation plan

Extend the existing `findEventsOfType` idea into a generic row query.

```typescript
const buildEventWhere = (query: StoreEventQuery | undefined) => {
  const window = buildWindow(query?.opts);
  return {
    ...(query?.entityType === undefined ? {} : { entityType: query.entityType }),
    ...(query?.entityId === undefined ? {} : { entityId: query.entityId }),
    ...(query?.types === undefined || query.types.length === 0
      ? {}
      : { type: { in: query.types } }),
    ...(window === undefined ? {} : { occurredAt: window }),
  };
};
```

Implementation sketch:

```typescript
const findEvents = (
  client: PrismaProcessStoreClient,
  query: StoreEventQuery | undefined,
): Effect.Effect<ReadonlyArray<AnalyticsEvent>> => {
  const args: EffectPmEventFindManyArgs = {
    where: buildEventWhere(query),
    orderBy: { occurredAt: "desc" },
    ...(query?.opts?.limit === undefined ? {} : { take: Math.max(0, query.opts.limit) }),
  };

  return Effect.tryPromise({
    try: () => client.effectPmEvent.findMany(args),
    catch: (cause) => new PrismaProcessStoreError({ cause }),
  }).pipe(
    Effect.map((rows) => rows.flatMap(decodeStoredEvent)),
    Effect.orDie,
  );
};
```

Use a decoder helper that returns an array instead of throwing or casting:

```typescript
const decodeStoredEvent = (row: EffectPmEventRow): ReadonlyArray<AnalyticsEvent> => {
  const decoded = decodeEventRow(row);
  if (decoded instanceof PrismaProcessStoreDecodeError) {
    return [];
  }
  return [decoded];
};
```

Rows that fail to decode should continue to be skipped. That matches the current
adapter policy that analytics reads are best-effort.

Dedicated queue reads can call `findEvents` and then narrow:

```typescript
const isQueueItemCompleted = (
  event: AnalyticsEvent,
): event is QueueItemCompletedEvent =>
  event.type === "queue.item.completed" && event.entityType === "queue";
```

## File-backed implementation plan

Add a local durable adapter backed by Effect `FileSystem`, not direct Node
`fs`. Keep it append-only and compatible with the same event codec used by
memory and Prisma.

Recommended first slice:

- expose `ProcessStore.file(filePath)` as an `Effect` that materializes a
  `ProcessStoreInterface`,
- expose `ProcessStore.fileLayer(filePath)` as the corresponding `Layer`,
- store one encoded analytics row per line in an NDJSON file,
- create the parent directory with `FileSystem.makeDirectory(..., {
  recursive: true })`,
- append with `FileSystem.writeFileString(filePath, line, { flag: "a" })`,
- read by `FileSystem.readFileString`, decode each line, skip malformed rows,
  then apply the same `StoreEventQuery` filtering and timestamp ordering as
  memory and Prisma,
- serialize append/read access with an Effect semaphore so concurrent fibers do
  not interleave writes in-process.

The first file-backed adapter is intentionally single-file and local-process
oriented. Cross-process locking, compaction, snapshots, rotation, and streaming
tail reads are later slices.

## File-by-file implementation checklist

### `src/ProcessStore.ts`

- Add `StoreEventQuery`.
- Add queue event TSDoc and mark exported event types `@public`.
- Add `events`, `getQueueItemCompletions`, and `getQueueLifecycle` to
  `ProcessStoreInterface`.
- Add shared query helpers for `occurredAt` filtering.
- Keep process reads sorted and filtered by `occurredAt`.
- Add in-memory queue reads using discriminant narrowing.
- Add `file` and `fileLayer` helpers backed by Effect `FileSystem`.

### `src/prisma/PrismaProcessStore.ts`

- Import `StoreEventQuery`, `QueueItemCompletedEvent`, and
  `QueueLifecycleChangedEvent`.
- Replace process-only query internals with an event query helper that accepts
  `entityType`, `entityId`, `types`, and `opts`.
- Keep `getProcessExecutions` and `getProcessLifecycle` behavior unchanged from
  the caller's perspective.
- Add queue reads using the same helper.
- Keep malformed row handling best-effort.

### `src/prisma/types.ts`

- Confirm the structural `findMany` args support `type: { in: [...] }`.
- If they do not, add the minimal structural shape needed by the adapter tests.
- Do not import generated Prisma types.

### `src/index.ts`

- Export `StoreEventQuery` and queue analytics event types.
- Update package documentation to say `ProcessStore` has process reads today and
  phase-one queue event reads after this change.

### Tests

- `test/process-store.test.ts`
  - Assert `events()` returns all event types ordered by `occurredAt` desc.
  - Assert `events({ entityType, entityId, types, opts })` filters correctly.
  - Assert queue completion and lifecycle reads return only matching queue rows.
- `test/prisma-process-store.test.ts`
  - Mirror memory tests with the structural Prisma client.
  - Include a malformed row to prove it is skipped.
  - Include mixed process and queue rows to prove filters happen before narrowing.
- Add file-backed store tests with Node FileSystem/Path layers:
  - append events and read them through `events(query)`,
  - instantiate a second file store against the same file and confirm persisted
    rows are visible,
  - include a malformed line and confirm reads skip it.
- Existing queue and process tests should continue to pass.

## Acceptance criteria

Phase one is complete only when all of these are true:

- `ProcessStoreInterface` has a generic `events(query)` read that includes
  `runtime.fact.recorded`.
- `ProcessStoreInterface` has dedicated reads for existing queue completion and
  queue lifecycle events.
- Memory, file-backed, and Prisma stores return equivalent ordering and
  filtering behavior.
- File-backed store uses Effect `FileSystem`, persists rows across store
  instances, and matches the generic `events(query)` behavior.
- Queue event types needed by custom store authors are exported from the package
  root.
- No code uses unsafe type assertions to satisfy the expanded interface.
- No runtime behavior changes for `QueueResource.persist`, `refill`, process
  supervisors, or control routes.
- Tests cover memory, file-backed, and Prisma reads for process, queue, and
  mixed event rows.
- A changeset is prepared before release because public types changed.

## Verification commands

Run the full non-trivial-change suite from the repo root:

```bash
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

For faster iteration while editing:

```bash
pnpm vitest run test/process-store.test.ts test/prisma-process-store.test.ts
pnpm vitest run test/queue-resource.test.ts
```

## Later plan 01 slices

After phase one lands, continue with separate documents or commits for:

1. Enqueue, rejection, retry, dead-letter, release, and handoff event types.
2. Queue projections and summaries derived from the richer event stream.
3. Optional subscriptions or event streams.
4. Custom no-op and test store implementations.
5. Replacement strategy for `persist` / `refill`.
6. Control-service routes that consume store reads.
