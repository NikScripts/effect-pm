{#error-handling title="Error Handling & Correctness" order=120 appliesTo=src}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/error-handling>.
<!-- docs-site-link:end -->
# Error Handling & Correctness

Errors are first-class values here — modelled, named, carried, and handled with the same care as any
other data. *Principles → Errors are values* is the stance; this chapter is how you do it well, plus
the concurrency traps that corrupt state when you don't.

{#one-error-per-mode .must appliesTo="src examples"}
## One named error per failure mode, carrying its data

Every distinct way something can fail is its own `Data.TaggedError`, carrying the fields a handler
needs to act — never a generic `Error` and never a stringly-typed message. The error *is* the
explanation.

``` ts
// ❌ bad — one opaque error; a handler can only read a string
return yield* Effect.fail(new Error(`queue ${id} is full (${capacity})`))

// ✅ good — a named error with the data to decide on
class QueueFull extends Data.TaggedError("QueueFull")<{
  readonly queueId: string
  readonly capacity: number
}> {}
return yield* new QueueFull({ queueId: id, capacity })
```

{#failure-vs-defect .must appliesTo="src examples"}
## Failure vs defect is a deliberate choice

An **expected, recoverable** condition is a failure in the `E` channel. An **impossible state or a
bug** is a defect — crash loudly, don't smuggle it into `E`. Choose on purpose: never `orDie` a
recoverable error, never put a programming mistake in the typed channel where a caller is asked to
"handle" it.

``` ts
// recoverable → failure the caller can react to
if (full) return yield* new QueueFull({ queueId, capacity })

// impossible / invariant broken → defect; it should never happen, so make it loud
if (rank < 0) return yield* Effect.die(new Error("unreachable: negative priority rank"))
```

{#catch-by-tag .must appliesTo="src examples"}
## Catch by tag; the error union is your checklist

Handle failures by their tag with `catchTag` / `catchTags`. The `E` union is the exhaustive list of
what can go wrong — recover the cases you can, and let the type tell you what's left. Never a blanket
`catchAll` that flattens distinct failures into one.

``` ts
work.pipe(
  Effect.catchTags({
    QueueFull: (e) => applyBackpressure(e.queueId),
    DedupRejected: (e) => Effect.logDebug(`dropped duplicate ${e.key}`),
  }),
)
```

{#preserve-the-cause .must appliesTo="src examples"}
## Wrap and preserve the cause; never blind-swallow

When you translate an error, carry the original as `cause` so the chain survives. A
`catchAll(() => fallback)` that discards the error is how failures vanish silently — the opposite of
*fail loudly*.

``` ts
// ❌ bad — the real failure disappears; you debug a fallback with no trail
fetchQuote(url).pipe(Effect.catchAll(() => Effect.succeed(defaultQuote)))

// ✅ good — translate deliberately, keep the cause
fetchQuote(url).pipe(
  Effect.catchTag("Timeout", (e) => Effect.fail(new QuoteUnavailable({ url, cause: e }))),
)
```

{#recover-with-schedule .must appliesTo="src examples"}
## Recover with a `Schedule`, not a hand-rolled loop

Retry and repeat are declarative policies, not manual counters and `sleep`s. Compose a `Schedule` so
the backoff, jitter, and cap live in one value you can test and reuse.

``` ts
// ✅ good — exponential backoff, capped at 5 attempts
fetchQuote(url).pipe(
  Effect.retry(Schedule.exponential(Duration.millis(100)).pipe(Schedule.intersect(Schedule.recurs(5)))),
)
```

{#atomic-check-then-act .must appliesTo="src examples"}
## Decide and commit in one atomic step

A check-then-act split across a `yield*` is a race: another fiber slips between the read and the
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

{#codecs-through-error-channel .must appliesTo="src examples"}
## Codecs go through the error channel, never a thrown defect

A `*Sync` codec throws, and a throw inside an Effect becomes an unrecoverable **defect**. Prefer the
Effect-returning codec so failure lands in `E`; if a sync codec is unavoidable, wrap it in
`Effect.try` with a typed error.

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

{#multi-row-one-transaction .must appliesTo="src examples"}
## Multi-row writes are one transaction

Two writes that must both land are a single `sql.withTransaction` — otherwise a crash between them
leaves half-written state no reader can trust.

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

{.note}
Errors that cross the wire are `Schema.TaggedErrorClass`, so they encode as well as throw — see
*Effect idioms → Errors that cross the wire*.
