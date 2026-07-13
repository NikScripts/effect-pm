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
class Emails extends QueueResource.Tag<Emails>()("app/Emails", EmailJob) {} // a queue of EmailJob
class Digest extends Process.Tag<Digest>()("app/Digest") {}                 // a scheduled process
```

`Resource.httpServer(serve)` is platform-agnostic — it just needs an HTTP server provided, and that
provide is where you pick your runtime. Define it **once** as a small helper; swapping `NodeHttpServer`
for Bun, Deno, or an edge runtime is the only line that changes:

``` ts
// your app, once — the single place that names a platform (data-last, so it pipes)
const nodeServer = (port: number) => <A, E, R>(resource: Layer.Layer<A, E, R>) =>
  Resource.httpServer(resource).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  )
```

Now the **worker runtime** is one pipe — `QueueResource.serve` gives `Emails` its worker (the `effect`
that drains each job), piped onto port 3001:

``` ts
const worker = QueueResource
  .serve(Emails, { effect: sendEmail })
  .pipe(nodeServer(3001))
// worker: Layer — provide it to a runtime to run the queue on :3001
```

The **scheduler runtime** runs `Digest` every hour, and each run **enqueues into `Emails`** — a queue
that lives on the *other* runtime, reached by port:

``` ts
const scheduler = Process.layer(Digest, {
  effect: Effect.gen(function* () {
    const emails = yield* Emails            // emails: the Emails handle (here, an RPC client)
    const email = yield* nextEmail          // email: EmailJob
    yield* emails.add(email)                // add(email: EmailJob): Effect<void>
  }),
  polling: Polling.spaced(Duration.hours(1)),
}).pipe(Layer.provide(Resource.clientHttp(Emails, 3001)))
// scheduler: Layer — the scheduler runtime
```

`Digest` runs on the scheduler, `Emails` on the worker — yet inside the process, `yield* Emails` and
`emails.add(…)` read exactly as if the two shared one process. **Two resources, two runtimes, one
program.** Move a runtime to another machine and only its port becomes a url — nothing else changes.

## Operate them live

A cross-runtime service isn't just callable across runtimes — it's **operable** across them. The same
handle that enqueues also controls and observes, so you steer and inspect the worker's queue from
anywhere it's reached:

``` ts
const emails = yield* Emails            // emails: the Emails handle — local OR an RPC client, same type

yield* emails.pause                     // pause: Effect<void> — stop draining, at runtime
const depth = yield* emails.size.get    // depth: number — how many are waiting, right now
yield* emails.events.pipe(Stream.runForEach(onChange)) // events: Stream<QueueEvent> — every change, live
```

And it comes with dashboards over the same tag — a **`pm` CLI**, a **TUI**, and a **web** dashboard —
each reading the resource without ever touching its implementation.

## Working with peers

The same tag also lets a resource reach its **peers** — its own other instances — and coordinate with
them. Take a session store sharded across nodes: each node holds the sessions for the users connected
to it, and a lookup for someone else's session is **forwarded to the node that owns it**.

``` ts
class Sessions extends Resource.Tag<Sessions>()("app/Sessions", {
  get: Resource.effectFn(SessionId, Schema.Option(Session)),      // from whoever owns it
  getLocal: Resource.effectFn(SessionId, Schema.Option(Session)), // this node's own shard
}) {}
```

Inside the layer, `Resource.peers` is an addressable set of siblings and `Resource.selfNode` says which
one you are — so `get` routes to **the one peer** that owns the key:

``` ts
get: (id) => Effect.gen(function* () {
  const self = yield* Resource.selfNode(Sessions)
  const peers = yield* Resource.peers(Sessions)          // my other instances, keyed by node
  const owner = ownerOf(id, [self, ...Object.keys(peers)])

  if (owner === self) return yield* getLocal(id)         // mine — answer directly
  const peer = peers[owner]
  if (peer === undefined) return Option.none()           // owner unreachable → miss
  return yield* peer.getLocal(id)                        // forward to THAT peer
})
```

From any node, a caller just asks — the routing and the cross-node hop stay inside the resource:

``` ts
const sessions = yield* Sessions
const session = yield* sessions.get(id) // Option<Session> — from whatever node owns it
```

An unreachable owner degrades to a miss instead of blocking. **Every instance an equal — reached, and
reaching others, through the same tag.**

## Build your own

Everything so far — `Emails`, `Digest`, `Sessions` — is built on one primitive you use directly. A
resource is a **contract** plus an **implementation**, and it's first-class, not an escape hatch.

Describe the contract — methods and their schemas:

``` ts
class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),          // an observable value — get + live changes
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
}) {}
```

Give it an implementation:

``` ts
const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Resource.subscribable(ref),                    // surface the ref as the observable field
    increment: ({ by }) => SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})
```

That's it — it's now a cross-runtime service like any built-in. The **same tag**, provided the same
three ways:

``` ts
Resource.layer(Counter, counterImpl)                        // in-process
Resource.serve(Counter, counterImpl).pipe(nodeServer(4000)) // served over RPC
Resource.clientHttp(Counter, 4000)                          // reached from another runtime
```

And it gets the rest for free — the live `value`, runtime control, and a slot in the `pm` CLI, TUI,
and web dashboards — because it's the same kind of thing `Emails` is.

## The included types

You don't start from scratch, either — the types you reach for most ship ready-made, each a
cross-runtime service you use like an Effect primitive:

- **Long-running processes** (`Process`) — continuous or recurring work: a polling cadence, arm/disarm
  schedule windows, execution history, and more.
- **Queue** (`QueueResource`) — a priority work queue: enqueue items, workers drain them with dedup,
  retry, and concurrency control; durable when you provide a store.
