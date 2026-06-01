# Queue telemetry index and batch recipe

## Goal

Migrate `QueueResourceStore` from flat `ProcessStore.record(...)` helpers to
schema-backed telemetry without reintroducing hand-maintained wire strings,
index predicates, or batch write APIs.

This is a design recipe for the next build slice. Code examples are the intended
shape, not yet implemented API.

## Current pain

`QueueResourceStore` is the largest remaining storage facet that still has all
of these patterns:

```ts
ProcessStore.record({
  recordEntry: (s) => (fact: QueueEntryFact) =>
    s.create(makeQueueEntryRecord(fact)),
  recordEntryBatch: (s) => (facts: ReadonlyArray<QueueEntryFact>) =>
    s.createBatch(facts.map(makeQueueEntryRecord)),
  recordLifecycle: (s) => (change: QueueLifecycleChange) =>
    s.create(makeQueueLifecycleRecord(change)),
  recordDedupeKeyBatch:
    (s) => (changes: ReadonlyArray<QueueDedupeKeyChange>) =>
      s.createBatch(changes.map(makeQueueDedupeKeyRecord)),
})
```

It also repeats queue-specific indexing in record encoders and read predicates:

```ts
subjectType: QUEUE_ENTRY_SUBJECT_TYPE,
subjectId: fact.entryId,
key: fact.key,
indexA: fact.batchId,
indexB: fact.type === "queue.entry.released" ? fact.releaseId : undefined,
```

The next slice should make those columns event metadata instead of per-record
manual wiring.

## Decisions

### 1. Indexing is an event pipe

Use a `Telemetry.index(...)` pipe on each event. It belongs beside
`Telemetry.logWarning(...)` because it is event write metadata, not read
projection logic.

```ts
Telemetry.event("Enqueued", QueueEntryEnqueued).pipe(
  Telemetry.index(({ field }) => ({
    subjectType: "QueueEntry",
    subjectId: field("entryId"),
    key: field("key").optional(),
    indexA: field("batchId").optional().named("batchId"),
  })),
  Telemetry.logWarning(
    "QueueResourceStore write failed for enqueued entry",
    ({ queueId, entryId }) => ({
      queueId: String(queueId),
      entryId: String(entryId),
    }),
  ),
);
```

Why this shape:

- Keeps event definition as the single source of truth.
- Avoids another top-level object DSL.
- Allows indexes to see materialized event fields, whether they came from scope,
  input, a terminal, or a literal.
- Keeps read projections local to the facet.

### 2. Index selectors reference schema field names, not raw payload paths

`field("entryId")` refers to a `Telemetry.Schema` field, not an arbitrary JSON
path. The helper should be typed from the event schema fields.

```ts
class QueueEntryEnqueued extends Telemetry.Schema<QueueEntryEnqueued>()(
  QueueEntryScope,
)({
  queueId: QueueState.queueId,
  entryId: QueueEntryState.entryId,
  occurredAt: Telemetry.terminal.clockMillis,
  key: Schema.optional(Schema.String),
  batchId: Schema.optional(Schema.String),
  priority: Schema.optional(QueuePrioritySchema),
  payload: Schema.optional(Schema.Unknown),
}) {}
```

Then:

```ts
Telemetry.index(({ field }) => ({
  subjectType: "QueueEntry",
  subjectId: field("entryId"),
  key: field("key").optional(),
  indexA: field("batchId").optional().named("batchId"),
}));
```

If a field is absent from the event schema, TypeScript should reject the index
definition.

### 3. Batch is generated on input-shaped emitters

Batch should not be a second authoring style. If an event emitter is a function,
the generated emitter gets a `.batch(...)` member with the same input type.

```ts
yield* QueueResourceStore.Entry.Enqueued({
  entryId,
  key,
  priority,
  payload,
});

yield* QueueResourceStore.Entry.Enqueued.batch(
  entries.map((entry) => ({
    entryId: entry.entryId,
    key: entry.key,
    priority: entry.priority,
    payload: entry.payload,
  })),
);
```

For events that emit as a value effect (no input), no `.batch(...)` member is
generated.

### 4. Batch writes use one `createBatch`

The generated `.batch(...)` emitter materializes each event to a runtime row and
writes all rows with one spine batch call.

```ts
const rows = yield* Effect.forEach(inputs, materializeEvent, {
  concurrency: "inherit",
});
yield* spine.createBatch(rows);
```

`Telemetry.logWarning(...)` applies once around the batch write. Its annotation
callback receives a summary object:

```ts
Telemetry.logWarning(
  "QueueResourceStore write failed for dedupe-key batch",
  ({ count }) => ({ count }),
);
```

### 5. QueueResource call sites stop building fact envelopes

Queue internals should call telemetry emitters directly:

```ts
yield* QueueResourceStore.Entry.Started({
  entryId: internal.entryId,
  key: internal.key,
  priority: internal.priority,
  attempts: internal.retries + 1,
  startedAt,
});
```

And for dedupe batches:

```ts
yield* QueueResourceStore.DedupeKey.Added.batch(
  addedDedupeKeys.map((key) => ({ key })),
);
```

No `buildEntryFact(...)`, no `recordEntry(...)`, no `recordDedupeKeyBatch(...)`.

## Intended final facet shape

```ts
const QueueResourceTelemetry = ProcessStore.telemetry(QueueResourceScope)(
  Telemetry.namespace("Queue"),
  Telemetry.tag("Entry")(
    Telemetry.event("Enqueued", QueueEntryEnqueued).pipe(
      Telemetry.index(({ field }) => ({
        subjectType: "QueueEntry",
        subjectId: field("entryId"),
        key: field("key").optional(),
        indexA: field("batchId").optional().named("batchId"),
      })),
    ),
    Telemetry.event("Started", QueueEntryStarted).pipe(
      Telemetry.index(({ field }) => ({
        subjectType: "QueueEntry",
        subjectId: field("entryId"),
        key: field("key").optional(),
        indexA: field("batchId").optional().named("batchId"),
      })),
    ),
    Telemetry.event("Released", QueueEntryReleased).pipe(
      Telemetry.index(({ field }) => ({
        subjectType: "QueueEntry",
        subjectId: field("entryId"),
        key: field("key").optional(),
        indexB: field("releaseId").named("releaseId"),
      })),
    ),
  ),
  Telemetry.tag("Lifecycle")(
    Telemetry.event("Started", QueueLifecycleStarted).pipe(
      Telemetry.index(({ field }) => ({
        subjectType: "QueueLifecycle",
        subjectId: field("queueId"),
      })),
    ),
  ),
  Telemetry.tag("DedupeKey")(
    Telemetry.event("Added", QueueDedupeKeyAdded).pipe(
      Telemetry.index(({ field }) => ({
        subjectType: "QueueDedupeKey",
        subjectId: field("key"),
        key: field("key"),
      })),
    ),
  ),
  Telemetry.tag("RateLimit")(
    Telemetry.event("Exceeded", QueueRateLimitExceeded).pipe(
      Telemetry.index(({ field }) => ({
        subjectType: "QueueRateLimit",
        subjectId: field("entryId"),
        key: field("limitKey"),
      })),
    ),
  ),
);

const QueueResourceCodec = Telemetry.codec(QueueResourceTelemetry)({
  Entry: {
    Enqueued: decodeEntry,
    Started: decodeEntry,
    Completed: decodeEntry,
    Failed: decodeEntry,
    Retried: decodeEntry,
    Exhausted: decodeEntry,
    Released: decodeEntry,
    DeadLettered: decodeEntry,
    Dropped: decodeEntry,
  },
  Lifecycle: {
    Started: decodeLifecycle,
    Paused: decodeLifecycle,
    Resumed: decodeLifecycle,
    Shutdown: decodeLifecycle,
    Cleared: decodeLifecycle,
    Drained: decodeLifecycle,
  },
  DedupeKey: {
    Added: decodeDedupeKey,
    Released: decodeDedupeKey,
  },
  RateLimit: {
    Exceeded: decodeRateLimit,
  },
});

export const QueueResourceStore = ProcessStore.Service(
  "@nikscripts/effect-pm/store/queueResource/QueueResourceStore",
  QueueResourceTelemetry,
  ProcessStore.query((s) => ({
    entries: (query?: QueueEntryQuery) =>
      s.read(runtimeRecordQuery(entryPredicates(query), query?.opts)).pipe(
        Effect.map((records) =>
          records.flatMap((record) =>
            Option.fromNullable(QueueResourceCodec.decodeTag("Entry", record)),
          ),
        ),
      ),
  })),
  ProcessStore.for((queueId, s) => ({
    entries: (query?: QueueScopedEntryQuery) =>
      readEntries(s, { queueId, ...query }),
  })),
);
```

## Acceptance checks

```ts
type EntryWire = Telemetry.Type.Event<typeof QueueResourceTelemetry, "Entry">
// "Queue.Entry.Enqueued" | "Queue.Entry.Started" | ...

QueueResourceStore.Entry.Enqueued
// (input: QueueEntryEnqueuedInput) => Effect<void>

QueueResourceStore.Entry.Enqueued.batch
// (inputs: ReadonlyArray<QueueEntryEnqueuedInput>) => Effect<void>

QueueResourceCodec.types("Entry")
// ["Queue.Entry.Enqueued", "Queue.Entry.Started", ...]

QueueResourceCodec.decodeTag("Entry", record)
// QueueEntryFact | null
```

## Build order

1. Implement `Telemetry.index(...)` metadata and row stamping for single writes.
2. Add generated `.batch(...)` for input-shaped schema events.
3. Add focused tests on a small fixture facet before touching Queue.
4. Migrate `QueueResourceStore` definitions and reads.
5. Replace QueueResource call sites with direct telemetry emits.
6. Delete flat `record*` queue APIs and old lowercase queue wire strings.
