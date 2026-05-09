# ResourcePool Storage

The types and interfaces for ResourcePool storage are settled and documented in `08-resourcepool-types.md`. This doc covers the design rationale, flow, and usage patterns.

---

## Overview

ResourcePool storage is handled by the package-level storage service — the same service that covers process execution history, lifecycle events, and schedule switches. One service, one layer provided at the PM level.

Individual pools configure how storage hooks are used via the `storage` config object. All storage hooks are optional. The service functions passed to each hook are pre-wired — call them to use the default service, ignore them to use something else entirely, or do work around them.

Storage is completely separate from `forkWith`. They serve different purposes and never interact:

- **`forkWith`** — runs after the resource is released. Full Effect composition. Handles downstream logic, error handling, notifications, etc.
- **Storage hooks** — wired internally by the PM. Only care about the outcome. No composition needed.

---

## Schema — Only When Needed

Schema is optional. Only required when `T` is not directly storable (contains functions, class instances, Effects, Symbols, etc.).

When provided, the wrapping layer applies `Schema.encode` before the service call and `Schema.decode` when `pending` is called in `onEmpty`. Config hooks never call encode/decode directly — it happens automatically at the service boundary.

When not provided, `T` is passed to the service as-is.

---

## The `store` Function

Every storage hook (except `onEmpty`) receives a `store` function as its second arg. This is the package-level service function for that specific hook, pre-wired with pool context. The service function signature never includes `pool` — the service already has it.

```ts
// call it to use the default service
onEnqueued: (record, store, pool) => Effect.gen(function*() {
  yield* store(record)
})

// ignore it to use something else
onEnqueued: (record, _store, pool) => Effect.gen(function*() {
  yield* myOtherStorage.save(record)
})

// do work around it
onEnqueued: (record, store, pool) => Effect.gen(function*() {
  yield* Logger.info(`Enqueuing ${record.id}`)
  yield* store(record)
  yield* metrics.increment("enqueued")
})
```

---

## The `onEmpty` Hook

`onEmpty` receives `pool`, `pending`, and `fill` instead of a `store` function since it is a read-then-act operation, not a write.

- **`pending`** — fetches records from storage. Accepts an optional filter function. Default filter (no filter provided) returns only unprocessed items. Decode already applied by wrapping layer — returns `QueueRecord<T, R, E>[]`.
- **`fill`** — utility provided by the PM, not the storage service. Takes decoded records, uses `priority` from each record to sort items back into the correct queues, strips record wrapper before passing item to pool. Storage-agnostic.

```ts
onEmpty: (pool, pending, fill) => Effect.gen(function*() {
  // default — only unprocessed items
  const records = yield* pending()
  yield* fill(records)

  // custom filter — include failed items for retry
  const records = yield* pending(r =>
    "effect" in r && r.effect.status === "failure"
  )
  yield* fill(records)

  // ignore fill entirely — manual control
  const records = yield* pending()
  for (const record of records) {
    yield* pool.bump(record.item)  // re-enqueue all as high priority
  }
})
```

---

## Enqueue Flow

```
pool.bump/add/defer(item)
  → PM generates id
  → if getKey provided: derive key, fetch history from storage
  → if skipDuplicates: check history, skip if already succeeded
  → if maxRetries: count consecutive failures, call onMaxRetries if at limit
  → build EnqueuedRecord
  → fork onEnqueued (non-blocking — does not delay enqueue)
  → add item to priority queue
```

---

## Effect Complete Flow

```
effect runs
  → PM records effectStartedAt before running
  → effect completes (success, failure, defect, or interruption)
  → PM builds EffectCompleteRecord with effect.exit + convenience fields
  → calls onEffectComplete
  → effect.exit available in hook for full Cause inspection
  → store function receives record without exit (not serializable)
```

---

## Fork Complete Flow

```
forkWith fiber completes
  → PM records fork timing
  → PM determines fork outcome (success, defect, interrupted)
  → builds ForkCompleteRecord extending EffectCompleteRecord
  → calls onForkComplete
  → if forkWith not provided — onForkComplete never fires, fork fields remain absent
```

---

## History

When `getKey` is provided, the PM looks up previous runs for `key + resourceId` on every enqueue and attaches them to the record as `history`. Most recent first.

History enables:

- **Retry counting** — consecutive failures since last success
- **Duplicate detection** — `skipDuplicates` checks history for a prior success
- **Per-item analytics** — run frequency, average duration, success rate for a specific item
- **`maxRetries` enforcement** — count consecutive failures from front of history until a success is found

History is loaded before `onEnqueued` fires, so it is available in the hook. A `historyLimit` config option caps how many records are loaded — limit TBD during implementation.

---

## `onMaxRetries`

Two separate hooks — independent, both optional:

**Top-level config** — behavior concern. Called when consecutive failures hit `maxRetries`. Use for alerting, re-routing to a different pool, dead letter queue logic, etc.

**`storage.onMaxRetries`** — storage concern. Called at the same time. Use for marking the item as exhausted in storage, writing to a dead letter table, etc.

Both receive `EnqueuedRecord` (with history) and the pool. The storage version also receives the `store` function.

---

## Custom Storage Per Pool

To use a custom storage service for one specific pool, provide the layer directly using standard Effect composition. No special package support needed:

```ts
const MyPool = ResourcePool.make({
  name: "my-pool",
  effect: processItem,
  storage: { ... }
}).pipe(Effect.provide(MyCustomStorageLayer))
```

The layer only applies to that pool's scope. The PM-level storage service is unaffected.

---

## Usage Examples

### Zero config — storage omitted
```ts
ResourcePool.make({
  name: "email-pool",
  effect: sendEmail,
})
```

### Plain object, log around store
```ts
ResourcePool.make({
  name: "email-pool",
  effect: sendEmail,
  storage: {
    onEnqueued: (record, store, pool) => Effect.gen(function*() {
      yield* Logger.info(`Enqueuing ${record.id}`)
      yield* store(record)
    })
  }
})
```

### Non-storable item type, schema required
```ts
interface EmailJob {
  to: string
  template: (data: Record<string, string>) => string  // not storable
}

interface StoredEmailJob {
  to: string
  templateName: string
}

ResourcePool.make({
  name: "email-pool",
  effect: sendEmail,
  storage: {
    schema: Schema.transform(
      StoredEmailJobSchema,
      EmailJobSchema,
      {
        encode: (job) => ({ to: job.to, templateName: job.template.name }),
        decode: (stored) => ({ to: stored.to, template: templates[stored.templateName] })
      }
    )
  }
})
```

### With key, skip duplicates, max retries
```ts
ResourcePool.make({
  name: "email-pool",
  effect: sendEmail,
  getKey: (item) => item.emailId,
  skipDuplicates: true,
  maxRetries: 3,
  onMaxRetries: (record, pool) => Effect.gen(function*() {
    yield* alerting.notify(`Item ${record.key} exhausted after ${record.history?.length} attempts`)
  }),
  storage: {
    onMaxRetries: (record, store, pool) => Effect.gen(function*() {
      yield* deadLetterStorage.write(record)
    })
  }
})
```

### Bypass service entirely for one pool
```ts
ResourcePool.make({
  name: "large-payload-pool",
  effect: processLargeFile,
  storage: {
    onEnqueued: (record, _store, pool) => Effect.gen(function*() {
      yield* S3.putObject({ key: record.id, body: JSON.stringify(record.item) })
    }),
    onEffectComplete: (record, _store, pool) => Effect.gen(function*() {
      yield* S3.updateObject({ key: record.id, body: JSON.stringify(record) })
    }),
    onEmpty: (pool, _pending, _fill) => Effect.gen(function*() {
      const items = yield* S3.listObjects({ prefix: "queue/" })
      yield* pool.add(items)
    })
  }
})
```
