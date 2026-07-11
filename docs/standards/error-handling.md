{#error-handling title="Error handling & correctness" order=120 appliesTo=src}
# Error handling & correctness

The bugs that only show up when two fibers race, or a process dies mid-write. *Principles* covers the
philosophy (errors are values, fail loudly); these are the concrete traps.

{#atomic-check-then-act .must appliesTo=src}
## Decide and commit in one atomic step

A check-then-act split across a `yield*` is a race: another fiber can slip between the read and the
write. Collapse it into a single `Ref.modify` (or one transaction) so the decision and the commit are
indivisible.

``` ts
// ❌ bad — read, then act; two fibers both pass the check and both enqueue
const seen = yield* Ref.get(dedup)
if (!seen.has(key)) {
  yield* Ref.update(dedup, (s) => s.add(key))
  yield* enqueue(item)
}

// ✅ good — decide and commit atomically
const isNew = yield* Ref.modify(dedup, (s) => (s.has(key) ? [false, s] : [true, s.add(key)]))
if (isNew) yield* enqueue(item)
```

{#codecs-through-error-channel .must appliesTo=src}
## Codecs go through the error channel, never a thrown defect

A `*Sync` codec throws, and a throw inside an Effect becomes an unrecoverable **defect**. Prefer the
Effect-returning codec so failure lands in the typed `E` channel; if a sync codec is unavoidable,
wrap it in `Effect.try` with a typed error.

``` ts
// ❌ bad — decodeUnknownSync throws; the failure escapes as a defect
const item = Schema.decodeUnknownSync(Item)(raw)

// ✅ good — the Effect-returning codec puts failure in E
const item = yield* Schema.decodeUnknown(Item)(raw)

// ✅ acceptable — forced to use a sync codec: wrap it into a typed error
const item = yield* Effect.try({
  try: () => Schema.decodeUnknownSync(Item)(raw),
  catch: (cause) => new DecodeFailed({ cause }),
})
```

{#multi-row-one-transaction .must appliesTo=src}
## Multi-row writes are one transaction

Two writes that must both land are a single `sql.withTransaction` — otherwise a crash between them
leaves half-written state that no reader can trust.

``` ts
// ❌ bad — a crash after the insert leaves counts wrong forever
yield* sql`INSERT INTO entries ${row}`
yield* sql`UPDATE counts SET n = n + 1 WHERE q = ${queueId}`

// ✅ good — all-or-nothing
yield* sql.withTransaction(
  Effect.gen(function* () {
    yield* sql`INSERT INTO entries ${row}`
    yield* sql`UPDATE counts SET n = n + 1 WHERE q = ${queueId}`
  }),
)
```
