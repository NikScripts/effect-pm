{#index title="Introduction" appliesTo=all}
# effect-pm

**Build cross-runtime services on Effect.**

An Effect service lives inside one runtime. A *cross-runtime service* doesn't: define it once, run it
on one runtime, and call it from another over RPC — with the same typed handle.

A real app already runs as more than one runtime — a web server here, a background worker there.
Sharing a queue between them normally means one side owns it and the other reaches it through a
hand-rolled HTTP client. A cross-runtime service drops that: one runtime owns the queue, the other
calls it **as if it were in-process.**

``` ts
// define once — the queue both runtimes share
class Emails extends QueueResource.Tag<Emails>()("app/Emails", EmailJob) {}

// the enqueue code — identical to using an in-process queue
const enqueue = Effect.gen(function* () {
  const emails = yield* Emails
  yield* emails.add(job)
})
```

Two runtimes on your machine — the worker owns the queue, the web process enqueues to it:

``` ts
// worker runtime — drains the queue, served on localhost
Resource.httpServer(QueueResource.serve(Emails, { effect: sendEmail }))

// web runtime — enqueues over localhost, with no client code of its own
Effect.provide(enqueue, Resource.clientHttp(Emails, { url: "http://localhost:3001/rpc" }))
```

Move the worker to another machine and only the url changes — two runtimes here, two runtimes
anywhere, the same code.

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
