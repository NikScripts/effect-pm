---
"@nikscripts/effect-pm": major
---

**Breaking — silo per-domain storage facets onto `RuntimeStorage` directly.**

Storage facets now own their wire codec end-to-end. Shared infrastructure
(`internal/store/spine.ts`, `internal/store/helpers.ts`) is type-agnostic;
each facet builds and decodes its own `RuntimeRecord` rows and pushes
predicates into `RuntimeStorageQuery` directly.

Removed
-------

- **`AnalyticsEvent` envelope union** and the central
  `internal/store/codec.ts` decoder. Facets no longer share a wire-event
  vocabulary.
- **`StoreEventQuery`** — replaced by per-facet query types (e.g.
  `QueueEntryQuery`, `RunResourceFactQuery`, `ProcessExecutionQuery`).
- **`EffectPmEventRow` / `EffectPmEventCreateInput`** are no longer
  re-exported from the package root or from `ProcessStoreEvent`. They
  live as structural placeholder types inside `@nikscripts/effect-pm/prisma`
  for the legacy table shape only.
- **Prisma row codec exports** (`decodeEventRow`, `encodeEvent`,
  `PrismaProcessStoreDecodeError`) — removed from
  `@nikscripts/effect-pm/prisma` and `@nikscripts/effect-pm/storage/prisma`.
  Prisma is being rebuilt as a `RuntimeStorage` adapter and no longer
  exposes a row codec at the package boundary.
- **Per-facet wire-event narrowing helpers**
  (`isQueueEntryRecordedEvent`, `isQueueLifecycleChangedEvent`,
  `isQueueDedupeKeyChangedEvent`) — only the surviving
  `isLogEntryRecorded` guard remains, now exported from
  `@nikscripts/effect-pm/store/Log`.
- **Internal plumbing** `src/internal/store/codec.ts` and
  `src/internal/store/factEnvelope.ts`. The `FactEnvelope` /
  `FactEnvelopeStateChange` envelope is gone — each facet writes its own
  payload shape.
- **Legacy spine shims** (`append`, `appendBatch`, `events`) on the
  internal `ProcessStoreSpine`. Facets call `s.create` / `s.createBatch` /
  `s.read` / `s.upsert` / `s.update` / `s.delete` directly.

Reshaped queue wire types
-------------------------

The queue facet now exposes per-status concrete fact / change types
instead of a single `runtime.fact.recorded` envelope:

- `QueueEntryFact = QueueEntryEnqueuedFact | QueueEntryStartedFact | …`
  (one type per `queue.entry.<status>`).
- `QueueLifecycleChange = QueueLifecycleStartedChange | …` (one type per
  `queue.lifecycle.<tag>`, including the new `queue.lifecycle.drained`).
- `QueueDedupeKeyChange = QueueDedupeKeyAddedChange | …`.

Emit API: a single `recordEntry(fact)` / `recordLifecycle(change)` /
`recordDedupeKey(change)` (plus `*Batch` variants). The previous
per-status methods (`entryEnqueued`, `entryStarted`, …) and contextual
binders (`withQueue`, `withEntry`) are gone.

Read API:

- `entries(query?: QueueEntryQuery)` with pushable `queueId`, `entryId`,
  `key`, `batchId`, `releaseId`, `types`, and `opts`.
- `entriesByKey(key, query?)` for cross-queue key lookups.
- `lifecycle(query?: QueueLifecycleQuery)` and
  `dedupeKeys(query?: QueueDedupeKeyQuery)` with their own pushable
  predicates.

Per-facet ownership
-------------------

- `LogEntryRecordedEvent` and `isLogEntryRecorded` now live in
  `src/store/log.ts` (re-exported via the package root).
- `ProcessLifecycleChangedEvent` / `ProcessLifecycleTag` now live in
  `src/store/processLifecycle.ts`.
- `ProcessExecutionCompletedEvent` / `ProcessExecutionStatus` now live in
  `src/store/processExecution.ts`.
- `RunResourceFactRecordedEvent` / `RunResourceStateChangedEvent` are
  removed (the run-resource facet returns concrete `RunResourceFact[]` /
  `RunResourceStateChange[]` already).
- `ProcessStoreEvent` now exports only `JsonValue`, `QueryOpts`,
  `AnalyticsEventBase`, and the `ProcessStoreWriteError` channel.

`ProcessStore.record(...)` DX flip
----------------------------------

`ProcessStore.record` now takes an object literal of
`{ [methodName]: (s) => method }` factories instead of a single
`(s) => api` factory. Emit method names are read from the object literal
at module load time, which makes the static optional emitters typed
without runtime introspection. The internal `stubSpine` is gone.

Read query semantics
--------------------

`ProcessStoreQueueResource`, `ProcessStoreProcessGroup`, and
`ProcessStoreProcessExecution` now apply `opts.limit` to the **post-
filter** result whenever the storage query is a strict superset of the
final projection (e.g. group queries that filter by
`attributes.groupId`, or `executions({ scheduleKey })`). Previously
`opts.limit` was pushed to storage first, which could collapse a
`limit: N` query that targeted a sparse post-filter to zero rows. The
`before` / `after` time window is still pushed down. A new internal
helper `windowOpts` is shared across the three facets.

Queue dedupe-key emit
---------------------

`QueueResource` now writes `queue.dedupe-key.added` rows when items
acquire a dedupe key on enqueue, and `queue.dedupe-key.released` rows
on completion, drop, dead-letter, retry-restore, and `clear`. The
previously-documented dedupe projection (`.dedupeKeys`) is now backed
by real data instead of being unwired.

Worker route fix
----------------

`QueueResource.drop` and `.deadLetter` now persist the caller-supplied
`reason` as a top-level field on the resulting `queue.entry.dropped` /
`queue.entry.dead-lettered` fact, instead of nesting it inside
`attributes`. Reads through `.entries({ types })` therefore expose the
typed `reason` field directly.
