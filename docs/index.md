{#index title="Introduction" appliesTo=all}
# effect-pm

**Build cross-runtime services on Effect.**

An Effect service lives inside one runtime. A *cross-runtime service* doesn't: define it once, run it
on one process or node, and call it from another over RPC — the same typed handle whether it's local
or across the network.

Normally, moving a queue or a background job to another process means rewriting the call site — an
HTTP client, serialization, its own error handling. A cross-runtime service erases that: you build it
in-process, then serve it, and **the call site never changes.** Local and remote are the same code —
only the layer you provide differs.

``` ts
// define once — a queue whose items are validated by a schema
class Emails extends QueueResource.Tag<Emails>()("app/Emails", EmailJob) {}

// the program that uses it — unchanged whether Emails runs here or elsewhere
const program = Effect.gen(function* () {
  const emails = yield* Emails
  yield* emails.add(job)
})
```

Run it in this process — provide the worker that drains the queue:

``` ts
Effect.provide(program, QueueResource.layer(Emails, { effect: sendEmail }))
```

…or split it across runtimes. **`program` doesn't change** — the server provides the worker, the
caller a client layer reaching it over HTTP:

``` ts
// server — serve the queue over RPC
Resource.httpServer(QueueResource.serve(Emails, { effect: sendEmail }))

// caller — the same program, now reached across the network
Effect.provide(program, Resource.clientHttp(Emails, { url: "https://mail.internal/rpc" }))
```

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
