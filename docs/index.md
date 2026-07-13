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

The **worker runtime** owns the queue — it drains `Emails` and serves it on port 3001:

``` ts
const worker = localServer(QueueResource.serve(Emails, { effect: sendEmail }), 3001)
// worker: Layer — a runnable worker runtime, serving Emails on :3001
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

## Scale to a fleet

One runtime is rarely the whole story — run the same `Emails` queue on several worker runtimes, a
**fleet**, and reach them as one. Here's a standalone example. Each runtime is a **node**, and a node
carries **the port it's served on**, so the fleet is just a list of nodes:

``` ts
class WorkerA extends Resource.Node<WorkerA>("app/WorkerA", 3001) {} // → http://localhost:3001/rpc
class WorkerB extends Resource.Node<WorkerB>("app/WorkerB", 3002) {} // → http://localhost:3002/rpc

// on each runtime — mesh Emails with the fleet; transport comes from each node's port
const fleet = Resource.peersLayer(Emails, WorkerA, { nodes: [WorkerA, WorkerB] })
// fleet: Layer — provide it to join the mesh
```

A node's address takes the same forms as `clientHttp`: a **port** (`3001` → `localhost:3001/rpc`), a
`":port"`, or a full **url** for another machine. Because the node carries it, `peersLayer` wires
every peer's transport for you — no client to hand-configure.

### Ask the whole fleet one question

`peers` hands you a handle to **every** instance. `combineQuery` reads a field from each and folds the
results — sum them for a fleet-wide total, or keep them **per node**:

``` ts
const peers = yield* Resource.peers(Emails)          // peers: one Emails handle per instance

const totalBacklog = yield* combineQuery(peers, (p) => p.size, Combine.sum)    // number — 512
const perNode      = yield* combineQuery(peers, (p) => p.size, Combine.byNode) // { "app/WorkerA": 300, … }
```

A **down peer is skipped, never thrown** — you get a partial answer, not a crash. And because `peers`
is keyed by node, you can also reach a single instance directly to steer just it (`peers["app/WorkerB"]`).

### Follow the whole fleet, live

The same fold works on **streams**. `combineStream` merges every instance's live `events` into one —
tag each with its node, and you're watching the entire fleet from a single subscription:

``` ts
const allEvents = combineStream(peers, (p) => p.events, Combine.mergeByNode)
// allEvents: Stream<{ node: string; value: QueueEvent }> — every instance, interleaved
yield* allEvents.pipe(Stream.runForEach(render))
```

And a resource can expose a field that's **already folded across the fleet** — mark it with
`Resource.fleet` and its layer computes it from `peers`, so a caller just reads `emails.fleetBacklog`
like any other field and never sees the fan-out. **From one queue, to two runtimes, to a whole fleet —
all through the same tag.**

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
