{#work-pools title="WorkPool" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/work-pools>.
<!-- docs-site-link:end -->
# WorkPool

`WorkPool` is an **included** [Hyperlink Service](/docs/glossary#hyperlink-service) — a
priority work queue you can drop in when you need one. It takes a stream of items and
drains them through a worker effect — one at a time, or many in parallel, with
priority, de-duplication, retries, and back-pressure. You declare it once, and
everywhere you `yield* Emails` you get a single handle that does *everything* —
enqueue work, watch it drain, and steer it — through the same value.

That handle is the whole surface. There is no separate "producer" and "admin"
API: the code that enqueues an email can also pause the queue, read how many are
pending, and subscribe to every completion. And because it's a HyperService, the
handle reads identically whether the queue runs in this process or across the
network — only the layer that provides it changes.

The library's focus is [building your own](/docs/creating-a-hyperlink) HyperServices;
`WorkPool` is a ready-made one when a priority queue is what you need. This page
starts at the smallest `WorkPool` that works, then each piece it was built from.

## Your first WorkPool

A WorkPool has two halves: a [**Tag**](/docs/glossary#tag) (what the queue *is* — its
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

That's a complete, running WorkPool. To use it, `yield* Emails` for the handle and
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

Tag payloads must be a `Schema.Struct` (nest unions / branded fields inside members).
That keeps the wire contract unambiguous for RPC and Soft journals.

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

Four verbs put work in. Three map to priority levels (`high` / `normal` / `low`):

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

`yield* Emails` on a `Service` is the engine handle; on a `Tag` it is the named
`WorkPool<…>` HyperService handle (same verbs, different packaging). Reach for
`Service` for a self-contained local queue; reach for `Tag` + `layer` when the
queue might move.

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
      : Effect.succeed("deadLetter" as const),  // a bad address — set it aside
})
```

Three dispositions: **`"retry"`** re-enqueues (until `attempts` runs out),
**`"deadLetter"`** sets the entry aside as failed (a `DeadLettered` event), and
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

`rateLimit` is Effect’s `RateLimiter.consume` options (same shape as Gate). The
backing store is **presence-driven**: provide `RateLimiter.layerStoreRedis` +
`NodeRedis.layer` at the app root for a fleet-wide budget; omit it and the
queue Soft-builds in-memory. Do **not** rely on Soft memory across multiple
Nodes — that yields N× the limit. Live Redis proof:
`test/rate-limit-redis.test.ts` (shared store across two queues + Gate
child-process peer). Local Redis: `docker compose -f docker-compose.redis.yml up -d`.

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
    load: (queue) => Effect.flatMap(nextBatch, queue.add).pipe(Effect.orDie),
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

Three separate planes — do not collapse them into one “SQLite store”. Full wiring SSOT:
[Stores](/docs/stores).

### Soft observability (`Store.Service`)

Every WorkPool soft-defaults an in-memory journal. Lifecycle events and analytics live there
for the process lifetime. Override with an app `Store.Service` that registers
`WorkPool.store(tag)` (SQLite or memory + Logs).

```ts
import * as Store from "hyperlink-ts/Store"
import * as WorkPool from "hyperlink-ts/WorkPool"
import { Effect, Schema } from "effect"

const Job = Schema.Struct({ id: Schema.String })
class Jobs extends WorkPool.Tag<Jobs>()("@app/Jobs", { payload: Job }) {}

class JobsStore extends Store.Service<JobsStore>("@app/JobsStore")(
  WorkPool.store(Jobs),
) {}

const program = Effect.gen(function* () {
  // Single registration → yield the store service directly (no `.at`).
  const store = yield* JobsStore
  const rate = yield* store.failureRate()
  const worst = yield* store.slowest(5)
  return { rate, worst }
})
```

`WorkPool.store(tag, additions)` adds app-specific shapes on top of base + analytics.

Given `const store = yield* JobsStore`:

| Read | Result |
|------|--------|
| `failures()` | Failed rows |
| `deadLettered()` | Entries from `RetryExhausted` |
| `inFlight()` | Started with no terminal yet |
| `history(entryId)` | All events for one entry |
| `lastFailure()` | `Option` of latest Failed |
| `slowest(n)` | Completions by `elapsed` desc |
| `recent(n)` | Last `n` events |
| `since(when)` | Events enqueued at/after `when` |
| `stats()` | Counts (`enqueued`, `started`, `completed`, `failed`, `retried`, `deadLettered`) |
| `failureRate()` | `failed / (completed + failed)` |
| `latency()` | `{ mean, p50, p95, p99, max }` over `Completed.elapsed` |
| `changes()` | Live stream of events |

Exercised in `test/queue-store-analytics.test.ts`.

### Durability (`DurableWorkPoolStore`)

Pending + in-flight work that must survive a restart (at-least-once + dedup).
Presence-driven: provide the backend layer (needs `payload` / `itemSchema` on the tag).
Omit the layer and the queue is not durable.

```ts
import * as WorkPool from "hyperlink-ts/WorkPool"
import { SQLiteDurableWorkPoolStore } from "hyperlink-ts/storage/sqlite"
import { Effect, Layer, Schema } from "effect"

const Job = Schema.Struct({ id: Schema.String })
class Jobs extends WorkPool.Tag<Jobs>()("@app/Jobs", { payload: Job }) {}
declare const effect: (job: typeof Job.Type) => Effect.Effect<void>

const live = WorkPool.layer(Jobs, { effect }).pipe(
  Layer.provide(SQLiteDurableWorkPoolStore.layer({ filename: "queue.db" })),
)
```

The durable store is then the **source of truth** for the backlog: enqueue persists, a feeder
leases work into workers, and a restart recovers in-flight work. Distinct from the Soft
event-log / analytics plane above.

### History backfill (`HistoryStore`)

Optional keyed append-log for windowed `metrics.query`. Without a `HistoryStore` layer,
capture is skipped and history reads stay empty.

```ts
import { HistoryStore } from "hyperlink-ts"
import * as WorkPool from "hyperlink-ts/WorkPool"
import { Effect, Layer, Schema } from "effect"

const Job = Schema.Struct({ id: Schema.String })
class Jobs extends WorkPool.Tag<Jobs>()("@app/Jobs", { payload: Job }) {}
declare const effect: (job: typeof Job.Type) => Effect.Effect<void>

const withHistory = WorkPool.layer(Jobs, { effect }).pipe(
  Layer.provide(HistoryStore.layerMemory()),
)
```

Fleet rate limits use Effect `RateLimiterStore` (Soft memory, or Redis — see [Stores](/docs/stores)).

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

## Reconfiguring (layer patches)

`WorkPool.configure(Tag, patch)` (and the same shape on `Daemon.configure` /
`Gate.configure`) is a **Layer** that folds a config patch onto the resource layer
**once at build** — not hot reload of a running engine. Merge it with the base layer:

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

Patches are partials (`{ concurrency: 3 }`), effect updaters, or full reducers — later
patches win. For **live** retunes after the engine is up, use [DynamicConfig](/docs/configuration)
(or rebuild the layer stack). Same configure verb on Daemon and Gate.

## Custom priority lanes

`high` / `normal` / `low` (via `prioritize` / `add` / `defer`) covers most needs, but
some domains have their own ordering — tiers, SLAs, numbered levels. Reach for
`WorkPool.priority` — the same HyperService with **arbitrary lanes**: you define the
levels, and `add` targets one by name. The handle reads the same; only the priority
axis is yours to shape.

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

Under the HyperService wrapper is a plain queue engine. `yield* WorkPool.make(config)`
(scoped Effect) gives the engine handle — workers, retries, and events — without the
Tag, Layer, or RPC machinery. `layer` and `Service` are built on it; reach for `make`
only when you want to embed a queue inside something else and manage its scope
yourself. For everything else, the Tag *is* the WorkPool.
