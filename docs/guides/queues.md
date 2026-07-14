{#queues title="Queues" status="draft" appliesTo=all}
# Queues

A **queue** takes a stream of items and drains them through a worker effect — one
item at a time, or many in parallel, with priority, de-duplication, retries, and
back-pressure. In this toolkit a queue is a **resource**: you declare it once, and
everywhere you `yield* MyQueue` you get a single handle that does *everything* —
enqueue work, watch it drain, and steer it — through the same value.

That handle is the whole surface. There is no separate "producer" and "admin"
API: the code that enqueues an email can also pause the queue, read how many are
pending, and subscribe to every completion. And because it's a resource, the
handle reads identically whether the queue runs in this process or across the
network — only the layer that provides it changes.

This guide starts at the start: the smallest queue that works, then each piece it
was built from.

## Your first queue

A queue has two halves: a **tag** (what the queue *is* — its item type and name)
and a **layer** (how it *runs* — the worker). Here is the whole thing:

{.twoslash}
``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect, Schema } from "effect"

// The item: a plain schema. This is the queue's payload type.
const EmailJob = Schema.Struct({
  to: Schema.String,
  subject: Schema.String,
})

// The tag: the contract. `Self` is the class itself (Effect's two-stage form).
class Emails extends QueueResource.Tag<Emails>()("app/Emails", {
  payload: EmailJob,
}) {}

// The layer: the worker. `effect` runs once per item.
const EmailsLive = QueueResource.layer(Emails, {
  effect: (job) => Effect.log(`sending "${job.subject}" to ${job.to}`),
  concurrency: 4,
})
```

That's a complete, running queue. To use it, `yield* Emails` for the handle and
`add` an item — anywhere the layer is provided:

{.twoslash}
``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends QueueResource.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
// ---cut---
const program = Effect.gen(function* () {
  const emails = yield* Emails
  yield* emails.add({ to: "reader@example.com", subject: "Welcome" })
})
```

Provide `EmailsLive` to `program` and the item drains through the worker. Nothing
else is wired: the worker pool, the retry machinery, and the observability store
all come with the layer.

## The handle

Hover `emails` and you'll see its type — the named handle:

{.twoslash}
``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends QueueResource.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
const program = Effect.gen(function* () {
// ---cut---
const emails = yield* Emails
//    ^?
})
```

`QueueResource<{ to: string; subject: string }, void, never, never>` reads as
`QueueResource<Payload, Success, Error, Requirements>`:

- **Payload** — the decoded item type. What `add` accepts.
- **Success** — the worker's return value (here `void`; see [Success values](#success-values)).
- **Error** — the worker's typed failure channel (here `never` — this queue's
  worker can't fail in a typed way; see [When work fails](#when-work-fails)).
- **Requirements** — what a local `yield*` needs (`never`); for a remote client
  it's the transport.

The handle groups its members by what they're *for*:

- **Enqueue** — `add`, `prioritize`, `defer`, `enqueue`.
- **Observe** — `size`, `isEmpty`, `status`, `events`, `metrics`.
- **Control** — `start`, `pause`, `resume`, `shutdown`, `clear`.
- **Route** — `release`, `deadLetter`, `drop`.

The rest of this guide walks those groups.

## The item, and its schema

The `payload` schema is the single source of truth for the item type. It is a
real Effect `Schema`, not just a type: it decodes the item on the way in and — when
the queue is served over RPC — validates it on the wire, so a bad item is rejected
before it ever reaches a worker. The decoded type flows everywhere: `add(item)`,
the worker's argument, and every event that carries the item.

Use whatever `Schema` shape fits — structs, unions, branded strings, nested data.
The only rule is that the payload is a single schema (a `Schema.Struct` is the
common case), so the wire contract is unambiguous.

## The worker

The worker lives on the layer. `effect` is the only required field; the rest tune
how it drains:

{.twoslash}
``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends QueueResource.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
// ---cut---
const EmailsLive = QueueResource.layer(Emails, {
  // runs once per item; the second arg is per-attempt context
  effect: (job, ctx) =>
    Effect.log(`send ${job.to} (attempt ${ctx.attempts}, ${ctx.priority})`),
  concurrency: 4,           // worker pool size — up to 4 items in flight
  attempts: 3,              // 1 try + 2 retries, then dead-lettered
  key: (job) => job.to,     // de-dup: same key is skipped while one is in flight
})
```

- **`concurrency`** — how many items drain at once. Default is 1 (strictly
  sequential); raise it for I/O-bound work.
- **`attempts`** — total tries per item. On the last failure the item is
  dead-lettered rather than retried.
- **`key`** — a de-duplication key. While an item with a given key is in flight,
  another with the same key is skipped — handy for "refresh user 7" style work.

The worker `effect` may require services (`R`); the layer captures that context at
build time and provides it to every run, so the resulting service needs nothing
beyond what the layer itself requires.

## When work fails

A queue's worker either **succeeds**, or it **fails in a way the queue declares**.
The tag's `error` schema is that declaration — and it's enforced: if you don't
declare an `error`, the worker's typed error channel is `never`, so a worker that
`Effect.fail`s won't even compile. Its failures must become **defects** (`orDie`),
which the queue still catches — they just aren't a *typed* part of the contract.

Declare an error schema and the worker may fail with it; that typed failure then
rides the `Failed` event's `cause`:

{.twoslash}
``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect, Schema } from "effect"
// ---cut---
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })

// declare the failure type on the tag…
class Emails extends QueueResource.Tag<Emails>()("app/Emails", {
  payload: EmailJob,
  error: Schema.String,     // the worker may fail with a string
}) {}

// …and now the worker is allowed to fail with it
const EmailsLive = QueueResource.layer(Emails, {
  effect: (job) =>
    job.to.includes("@")
      ? Effect.void
      : Effect.fail(`invalid address: ${job.to}`),
  attempts: 1,
})
```

The handle now types as `QueueResource<…, void, string, never>` — the `string`
error is visible to anyone watching `events`. The rule is deliberate: **the tag is
the error contract, and workers conform to it.** A queue's declared failures are
part of its public shape, not an implementation detail.

## Enqueueing

Four verbs put work in. Three are priority lanes:

{.twoslash}
``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends QueueResource.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
const program = Effect.gen(function* () {
const emails = yield* Emails
// ---cut---
yield* emails.add({ to: "a@b.c", subject: "Welcome" })           // normal
yield* emails.prioritize({ to: "a@b.c", subject: "Reset code" }) // jumps the line
yield* emails.defer({ to: "a@b.c", subject: "Newsletter" })      // sinks to the back
})
```

`add`, `prioritize`, and `defer` each also accept an **array** — one call enqueues
a batch, which matters over RPC (one round trip, not N). The fourth verb,
`enqueue`, re-injects existing entries (from a `release`, below) with their attempt
counts preserved.

## Observing

Three kinds of read, for three questions.

**"How much is waiting, right now?"** — `size`, `isEmpty`, and `status` are
reactive `Subscribable`s. `.get` reads the current value once; `.changes` is a live
stream you can render:

{.twoslash}
``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect, Schema, Stream } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends QueueResource.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
declare const onDepth: (n: number) => Effect.Effect<void>
const program = Effect.gen(function* () {
const emails = yield* Emails
// ---cut---
const pending = yield* emails.size.get          // a number, right now
const empty = yield* emails.isEmpty.get         // boolean
yield* emails.size.changes.pipe(Stream.runForEach(onDepth)) // live, every change
})
```

**"What just happened?"** — `events` is a stream of discrete facts: `Enqueued`,
`Started`, `Completed`, `Failed`, `RetryScheduled`, `RetryExhausted`, and more.
Subscribe once, off-fiber, and dispatch by tag:

{.twoslash}
``` ts
import { QueueResource, Resource } from "@nikscripts/effect-pm"
import { Cause, Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends QueueResource.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
const program = Effect.gen(function* () {
const emails = yield* Emails
// ---cut---
yield* Effect.forkScoped(
  emails.events.pipe(
    Resource.runForEachTag({
      Completed: (e) => Effect.log(`sent → ${e.entry.item.to}`),
      RetryExhausted: (e) =>
        Effect.logError(`dead-letter ${e.entry.item.to}: ${Cause.pretty(e.cause)}`),
    }),
  ),
)
})
```

**"How is it trending?"** — `metrics.stream` emits a windowed aggregate (throughput,
average wait, per-window counts) once per window; `metrics.query` reads historical
windows back from the store.

{.note}
Effect queues can't enumerate their pending items — there's no "list". You read
*counts* (`size`, per-priority `sizes` on `status`) and *facts* (`events`), and you
target what you already know by key (`drop`, `deadLetter`). That's a feature: it
keeps the queue O(1) to observe at any depth.

## Controlling

The same handle steers the queue. `pause` stops draining (items still enqueue and
accumulate); `resume` starts again; `shutdown` drains gracefully and stops; `clear`
empties the pending items and returns how many it cleared; `start` forks the worker
pool (idempotent — layers do this for you).

Three verbs **route** work out of the queue: `release` exports pending entries and
removes them (hand them to another runtime, then `enqueue` them there);
`deadLetter` removes entries matching a selector and records them as dead-lettered;
`drop` removes them without a trace. You target these by what you know — an entry
id or a matching item — never by listing.

## Success values

If the worker returns a value, declare a `success` schema and that value flows onto
the `Completed` event and the store's analytics:

{.twoslash}
``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect, Schema } from "effect"
// ---cut---
const Job = Schema.Struct({ id: Schema.String })

class Doubler extends QueueResource.Tag<Doubler>()("app/Doubler", {
  payload: Job,
  success: Schema.Number,   // the worker returns a number
}) {}

const DoublerLive = QueueResource.layer(Doubler, {
  effect: (job) => Effect.succeed(job.id.length * 2),
})
```

The handle types as `QueueResource<{ id: string }, number, never, never>`, and
`Completed.success` carries the `number`.

## The `.Service` shorthand

`Tag` + `layer` keeps the contract and the worker separate — which is what makes a
queue location-transparent (the same tag, a different layer, and it runs remotely).
When you don't need that split, `QueueResource.Service` fuses both into one class:

{.twoslash}
``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
// ---cut---
class Emails extends QueueResource.Service<Emails, typeof EmailJob.Type, never>()(
  "app/Emails",
  {
    concurrency: 4,
    effect: (job) => Effect.log(`send ${job.to}`),
  },
) {}
```

`yield* Emails` yields the exact same handle type. Reach for `Service` for a
self-contained local queue; reach for `Tag` + `layer` when the queue might move.

## Where to next

- **Persistence & analytics** — every queue has an observability store baked in;
  provide a durable one and `metrics.query` reads history back across restarts.
- **Running it remotely** — serve a queue over RPC and drive it from a browser or
  another process with the *same* `yield* Tag` code.
- **Custom priority lanes** — beyond high/normal/low, a custom queue defines its
  own levels.

Those build directly on what's here — same tag, same handle.
