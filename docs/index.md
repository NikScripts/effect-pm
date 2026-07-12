{#index title="Introduction" appliesTo=all}
# effect-pm

**Build cross-runtime services on Effect.**

An Effect service lives inside one runtime. A *cross-runtime service* doesn't: define it once, run it
on one runtime, and call it from another over RPC — with the same typed handle.

A real app runs as more than one runtime — a worker draining a queue here, a scheduler filling it
there. Wiring those together normally means one side owns a resource and the others reach it through
a hand-rolled HTTP client. Cross-runtime services drop that: every resource is reached with the same
typed handle, wherever it runs.

Here are two resources — a queue and a scheduled process — on two runtimes, working together.

``` ts
// two resources, defined once
class Emails extends QueueResource.Tag<Emails>()("app/Emails", EmailJob) {}
class Digest extends Process.Tag<Digest>()("app/Digest") {}
```

The **worker runtime** owns the queue — it drains `Emails` and serves it on port 3001:

``` ts
const worker = localServer(QueueResource.serve(Emails, { effect: sendEmail }), 3001)
```

The **scheduler runtime** runs `Digest` every hour, and each run **enqueues into `Emails`** — a queue
that lives on the *other* runtime, reached by port:

``` ts
const scheduler = Process.layer(Digest, {
  effect: Effect.gen(function* () {
    const emails = yield* Emails            // the queue on the worker runtime
    const email = yield* nextEmail
    yield* emails.add(email)
  }),
  polling: Polling.spaced(Duration.hours(1)),
}).pipe(Layer.provide(Resource.clientHttp(Emails, 3001)))
```

`Digest` runs on the scheduler, `Emails` on the worker — yet inside the process, `yield* Emails` and
`emails.add(…)` read exactly as if the two shared one process. **Two resources, two runtimes, one
program.** Move a runtime to another machine and only its port becomes a url — nothing else changes.

## Operate them live

A cross-runtime service isn't just callable across runtimes — it's **operable** across them. The same
handle that enqueues also controls and observes, so you steer and inspect the worker's queue from
anywhere it's reached:

``` ts
const emails = yield* Emails            // local, or a client to another runtime — same handle

yield* emails.pause                     // stop draining, at runtime
const depth = yield* emails.size.get    // how many are waiting, right now
yield* emails.events.pipe(Stream.runForEach(onChange)) // watch every state change, live
```

And it comes with dashboards over the same tag — a **`pm` CLI**, a **TUI**, and a **web** dashboard —
each reading the resource without ever touching its implementation.

## Build your own

Building your own cross-runtime service is a first-class part of effect-pm, not an escape hatch.
Describe a contract — its methods and their schemas — give it an implementation, and effect-pm turns
it into a service you run in-process or serve over RPC: one typed handle, plus the runtime control and
dashboards every cross-runtime service gets.

## The included types

You don't start from scratch, either — the types you reach for most ship ready-made, each a
cross-runtime service you use like an Effect primitive:

- **Long-running processes** (`Process`) — continuous or recurring work: a polling cadence, arm/disarm
  schedule windows, execution history, and more.
- **Queue** (`QueueResource`) — a priority work queue: enqueue items, workers drain them with dedup,
  retry, and concurrency control; durable when you provide a store.
