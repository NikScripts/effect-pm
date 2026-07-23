{#queues title="Queues" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/queues>.
<!-- docs-site-link:end -->
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

A queue has two halves: a [**Tag**](/docs/glossary#tag) (what the queue *is* — its
item type and name) and a **layer** (how it *runs* — the worker). Here is the whole
thing:

{.twoslash}
``` ts
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"

// The item: a plain schema. This is the queue's payload type.
const EmailJob = Schema.Struct({
  to: Schema.String,
  subject: Schema.String,
})

// The tag: the contract. `Self` is the class itself (Effect's two-stage form).
class Emails extends WorkPool.Tag<Emails>()("app/Emails", {
  payload: EmailJob,
}) {}

// The layer: the worker. `effect` runs once per item.
const EmailsLive = WorkPool.layer(Emails, {
  effect: (job) => Effect.log(`sending "${job.subject}" to ${job.to}`),
  concurrency: 4,
})
```

That's a complete, running queue. To use it, `yield* Emails` for the handle and
`add` an item — anywhere the layer is provided:

{.twoslash}
``` ts
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
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
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
const program = Effect.gen(function* () {
// ---cut---
const emails = yield* Emails
//    ^?
})
```

`WorkPool<{ to: string; subject: string }, void, never, never>` reads as
`WorkPool<Payload, Success, Error, Requirements>`:

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
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
// ---cut---
const EmailsLive = WorkPool.layer(Emails, {
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
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"
// ---cut---
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })

// declare the failure type on the tag…
class Emails extends WorkPool.Tag<Emails>()("app/Emails", {
  payload: EmailJob,
  error: Schema.String,     // the worker may fail with a string
}) {}

// …and now the worker is allowed to fail with it
const EmailsLive = WorkPool.layer(Emails, {
  effect: (job) =>
    job.to.includes("@")
      ? Effect.void
      : Effect.fail(`invalid address: ${job.to}`),
  attempts: 1,
})
```

The handle now types as `WorkPool<…, void, string, never>` — the `string`
error is visible to anyone watching `events`. The rule is deliberate: **the tag is
the error contract, and workers conform to it.** A queue's declared failures are
part of its public shape, not an implementation detail.

## Enqueueing

Four verbs put work in. Three are priority lanes:

{.twoslash}
``` ts
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
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
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema, Stream } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
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
import { WorkPool, Hyperlink } from "hyperlink-ts"
import { Cause, Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
const program = Effect.gen(function* () {
const emails = yield* Emails
// ---cut---
yield* Effect.forkScoped(
  emails.events.pipe(
    Hyperlink.runForEachTag({
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
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"
// ---cut---
const Job = Schema.Struct({ id: Schema.String })

class Doubler extends WorkPool.Tag<Doubler>()("app/Doubler", {
  payload: Job,
  success: Schema.Number,   // the worker returns a number
}) {}

const DoublerLive = WorkPool.layer(Doubler, {
  effect: (job) => Effect.succeed(job.id.length * 2),
})
```

The handle types as `WorkPool<{ id: string }, number, never, never>`, and
`Completed.success` carries the `number`.

## The `.Service` shorthand

`Tag` + `layer` keeps the contract and the worker separate — which is what makes a
queue location-transparent (the same tag, a different layer, and it runs remotely).
When you don't need that split, `WorkPool.Service` fuses both into one class — a
self-contained [**Service**](/docs/glossary#service):

{.twoslash}
``` ts
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
// ---cut---
class Emails extends WorkPool.Service<Emails, typeof EmailJob.Type, never>()(
  "app/Emails",
  {
    concurrency: 4,
    effect: (job) => Effect.log(`send ${job.to}`),
  },
) {}
```

`yield* Emails` yields the exact same handle type. Reach for `Service` for a
self-contained local queue; reach for `Tag` + `layer` when the queue might move.

---

Everything so far is the *basic* queue. The rest of this guide is the operating
surface — the controls you reach for once a queue is real.

## Handling failure

`attempts` is the blunt instrument: try N times, then dead-letter. Real failure
handling is per-error, and that's what **`onFailure`** is for. It runs when an
attempt fails, receives the entry and the `Cause`, and *decides* what happens
next — retry, dead-letter, or drop:

{.twoslash}
``` ts
import { WorkPool } from "hyperlink-ts"
import { Cause, Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", {
  payload: EmailJob,
  error: Schema.String,
}) {}
declare const isTransient: (cause: Cause.Cause<string>) => boolean
declare const send: (job: { to: string }) => Effect.Effect<void, string>
// ---cut---
const EmailsLive = WorkPool.layer(Emails, {
  effect: (job) => send(job),
  attempts: 5,
  onFailure: (entry, cause) =>
    isTransient(cause)
      ? Effect.succeed("retry" as const)        // a blip — spend an attempt
      : Effect.succeed("dead-letter" as const),  // a bad address — set it aside
})
```

Three dispositions: **`"retry"`** re-enqueues (until `attempts` runs out),
**`"dead-letter"`** sets the entry aside as failed (a `DeadLettered` event), and
**`"drop"`** discards it silently. Without `onFailure`, the default is retry until
`attempts`, then dead-letter. For *retrying the effect itself* (backoff, jitter),
put `Effect.retry` on your worker `effect` — that's a different layer of the onion:
`onFailure` decides the entry's fate *after* the effect has given up.

## Rate limiting the drain

A queue that hammers a downstream API needs a ceiling. `rateLimit` caps how many
items start per window; excess wait, and a `RateLimitExceeded` event fires when the
ceiling bites:

{.twoslash}
``` ts
import { WorkPool } from "hyperlink-ts"
import { Duration, Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
// ---cut---
const EmailsLive = WorkPool.layer(Emails, {
  effect: (job) => Effect.log(`send ${job.to}`),
  concurrency: 8,
  rateLimit: { limit: 100, window: Duration.seconds(1) }, // ≤ 100 starts/sec
})
```

`concurrency` and `rateLimit` are orthogonal: concurrency bounds *in-flight* work,
rate limit bounds *start rate*. Use both — a pool of 8 workers that collectively
start no faster than 100/sec.

## Bootstrapping: start paused

Sometimes you want to load a queue *before* it drains — seed a backlog, wire up a
subscriber, then let it rip. Start it paused and `resume` when ready:

{.twoslash}
``` ts
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
const EmailsLive = WorkPool.layer(Emails, {
  effect: (job) => Effect.log(job.to),
  paused: true,        // workers are forked but idle
})
const program = Effect.gen(function* () {
const emails = yield* Emails
// ---cut---
yield* emails.add({ to: "a@b.c", subject: "queued while paused" })
yield* emails.resume  // now it drains
})
```

## Pulling work in

The queues so far are *push* — something calls `add`. A queue can also *pull*, with
**`refill`**: a loader that the engine calls to fetch work. `onStart` seeds it once
on boot; `onDrained` re-polls the source every time the queue empties — turning a
queue into a durable poller over an external source (a table, a topic, an inbox):

{.twoslash}
``` ts
import { WorkPool } from "hyperlink-ts"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
declare const nextBatch: Effect.Effect<ReadonlyArray<{ to: string; subject: string }>>
// ---cut---
const EmailsLive = WorkPool.layer(Emails, {
  effect: (job) => Effect.log(job.to),
  refill: {
    onStart: true,                                    // seed on boot
    onDrained: true,                                  // re-poll when empty
    load: (queue) => Effect.flatMap(nextBatch, queue.add),
  },
})
```

The loader gets the queue handle, so it enqueues with the same verbs you do.

## Operating a live queue

Three streams tell you what a running queue is doing, from three angles.

**`events`** is the fact log. Every discrete thing the queue does is a tagged event,
and they fall into four families:

- *lifecycle* — `Enqueued`, `Started`, `Completed`
- *failure* — `Failed`, `RetryScheduled`, `RetryExhausted`
- *routing* — `Released`, `DeadLettered`, `Dropped`, `Cleared`
- *queue-level* — `Start`, `RateLimitExceeded`, `ShutdownRequested`, `ShutdownComplete`, `Drained`

You never handle all of them — pick the tags you care about with
`Hyperlink.runForEachTag` and ignore the rest.

**`status`** is the current-state snapshot (a `Subscribable`): per-priority pending
`sizes`, how many are `inFlight`, the running `completed` count, whether it's
`paused`, and its `phase` — `running`, then `draining` after a shutdown request,
then `off`. It's the one value a dashboard renders.

**`metrics`** is the aggregate view: `metrics.stream` emits one windowed summary per
window (throughput, average wait and execution time, per-window counts);
`metrics.query` reads past windows back from the store for charts and trends.

{.note}
`status` answers "what *is* true now", `events` answers "what *happened*", `metrics`
answers "how is it *trending*". Reach for the one that matches the question — they
don't overlap.

## Persistence and analytics

Every queue comes with an **observability store** already wired in. By default it's
in-memory: lifecycle events and metric windows are recorded, and `metrics.query`
reads them back — for the life of the process. Provide a **durable** store instead
(the toolkit ships a SQLite-backed one) and that history survives restarts: a
dashboard reconnecting after a redeploy still sees yesterday's throughput.

The store is also an analytics surface in its own right — beyond `metrics.query` it
answers questions like "the *slowest* completions" and "how many have completed",
computed over the recorded history rather than the live queue. You reach it with
`WorkPool.store(tag)`.

## Running it across the network

This is the payoff of the tag/layer split. The **tag is the contract**; the
**layer decides where the work runs** — and nothing else in your code changes.

Provide `WorkPool.layer` and the queue is local. Provide
`WorkPool.serve` instead and the worker runs behind an RPC server, its
handlers mounted for callers. A *different* process then provides
`Hyperlink.client(Tag)` (or `Hyperlink.connect(Tag, Hyperlink.protocolHttp(port))` over HTTP), and the
**same `yield* Tag` code** drives the remote queue — `add`, `size`, `events`,
`pause`, all of it — as if it were in-process. The handle's `Requirements` param is
the only tell: `never` locally, the transport for a client.

For moving *pending work* between runtimes, `release` exports entries decoded and
`releaseEncoded` exports them in wire form (no item schema needed on the receiver);
the other side `enqueue`s them, attempt budgets intact.

## Reconfiguring at runtime

A queue's `concurrency`, `rateLimit`, or `paused` state isn't frozen at definition.
`WorkPool.configure(Tag, patch)` is a layer that overlays a config patch on top
of the base — `Layer.provideMerge` it, and the queue drains under the merged config:

{.twoslash}
``` ts
import { WorkPool } from "hyperlink-ts"
import { Layer, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
declare const EmailsLive: Layer.Layer<Emails>
// ---cut---
const Tuned = EmailsLive.pipe(
  Layer.provideMerge(WorkPool.configure(Emails, { concurrency: 16 })),
)
```

Because it's just a layer, the patch can come from anywhere a layer can — an env
flag, or a live `DynamicConfig` swap that re-tunes the queue while it runs.

## Custom priority lanes

`high` / `normal` / `defer` covers most needs, but some domains have their own
ordering — tiers, SLAs, numbered levels. `CustomQueueHyperlink` is the same queue
with **arbitrary lanes**: you define the levels, and `add` targets one by name. The
handle reads the same; only the priority axis is yours to shape.

## A live control panel

Because the handle *is* the whole surface, a UI is just another consumer of it.
These docs render one inline: a ` ``` queue ` block mounts a live control panel for
a declared queue — buttons that call `add` / `prioritize` / `pause` / `resume` /
`clear`, and stats read straight off the `status` stream. Enqueue an item and watch
`pending` climb, then drain to `completed`:

``` queue
app/EmailQueue
```

The same handle that runs the queue drives the panel — no separate admin API, no
extra wiring.

## The raw engine

Under the resource wrapper is a plain queue engine. `WorkPool.make(config)`
returns a handle directly — the workers, retries, and events, without the Tag,
Layer, or RPC machinery. `layer` and `Service` are built on it; reach for `make`
only when you want to embed a queue inside something else and manage its scope
yourself. For everything else, the tag *is* the queue.
