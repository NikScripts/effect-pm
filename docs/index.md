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

One runtime is rarely the whole story — run the same resource on several runtimes, a **fleet**, and
have it aggregate across all of them. Each runtime is a **node**, and a node carries **the port it's
served on**, so the fleet is just a list of nodes:

``` ts
class WorkerA extends Resource.Node<WorkerA>("app/WorkerA", 3001) {} // → http://localhost:3001/rpc
class WorkerB extends Resource.Node<WorkerB>("app/WorkerB", 3002) {} // → http://localhost:3002/rpc
```

A node's address takes the same forms as `clientHttp`: a **port** (`3001` → `localhost:3001/rpc`), a
`":port"`, or a full **url** for another machine. The node carries it, so meshing needs nothing else.

### A resource that knows its own fleet

Fleet-awareness lives **inside the resource**, not at the call site. A field marked `Resource.fleet`
is one the resource folds across every instance — here `active` is *this* node's own count, and
`fleetActive` is the whole fleet's:

``` ts
class Workers extends Resource.Tag<Workers>()("app/Workers", {
  active: Resource.effect(Schema.Number),                            // this instance's own count
  fleetActive: Resource.effect(Schema.Number).pipe(Resource.fleet),  // folded across the fleet
}) {}
```

The resource computes that fold **in its own layer**, where `Resource.peers` hands it the *other*
instances — every node **but itself**, keyed by node. It folds their `active` and adds its own value,
because `peers` never includes you:

``` ts
// in the Workers layer — `own` is this node's live count
const peers = yield* Resource.peers(Workers)   // the OTHER instances (not me), keyed by node
return {
  active: Effect.succeed(own),
  fleetActive: combineQuery(peers, (p) => p.active, Combine.sum).pipe(
    Effect.map((others) => own + others),       // my own + peers = the true fleet total
  ),
}
```

Mesh the fleet with one line per runtime — `peersLayer` gives the resource its peers, reaching each by
the port on its node. Then a **caller just reads the field**; the fan-out stays hidden in the layer:

``` ts
const mesh = Resource.peersLayer(Workers, WorkerA, { nodes: [WorkerA, WorkerB] })

const workers = yield* Workers
const total = yield* workers.fleetActive       // total: number — the whole fleet, one call
```

### The rest of the fleet toolkit

`peers` is the primitive; a few helpers cover the common shapes, all layer-internal like `peers`:

- **`Resource.selfNode`** — the node key *this* instance runs as, to key its own row in a per-node
  fold (`{ ...byNode, [self]: own }`) without hand-threading it.
- **`Combine.byNode`** — keep a fold **per node** (`{ "app/WorkerA": 5, … }`) instead of summing.
- **`combineStream`** — the same fold over **streams**: merge every peer's live stream into one,
  optionally node-tagged.
- **`Resource.fleetHealth`** — the canned per-node table: peers folded by node **plus** this node's
  own value.

A **down peer is skipped, never thrown** — a fleet fold degrades to a partial answer, never a crash.
**From one resource, to two runtimes, to a whole fleet — all through the same tag.**

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
