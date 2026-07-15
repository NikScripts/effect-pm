{#index title="Introduction" done="api previews types" appliesTo=all}
# effect-pm

**Build cross-runtime Services on Effect.**

An Effect Service lives inside one runtime. A *cross-runtime Service* doesn't: define it once, run it
on one runtime, and call it from another over RPC — with the same typed Handle.

A real app runs as more than one runtime — a worker draining a queue here, a scheduler filling it
there. Wiring those together normally means one side owns a Resource and the others reach it through
a hand-rolled HTTP client. Cross-runtime Services drop that: every Resource is reached with the same
typed Handle, wherever it runs.

Here are two Resources — a queue and a scheduled process — on two runtimes, working together.

{.twoslash}
``` ts
import * as QueueResource from "@nikscripts/effect-pm/QueueResource"
import * as Process from "@nikscripts/effect-pm/Process"
import { Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String })
// ---cut---
// two resources, defined once
class Emails extends QueueResource.Tag<Emails>()("app/Emails", EmailJob) {} // a queue of EmailJob
class Digest extends Process.Tag<Digest>()("app/Digest") {}                 // a scheduled process
```

[`Resource.httpServer(serve)`](/docs/resource) is platform-agnostic — it just needs an HTTP server
provided, and that provide is where you pick your runtime. Define it **once** as a small helper; swapping `NodeHttpServer`
for Bun, Deno, or an edge runtime is the only line that changes:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Layer } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
// ---cut---
// your app, once — the single place that names a platform (data-last, so it pipes)
const nodeServer = (port: number) => <A, E, R>(resource: Layer.Layer<A, E, R>) =>
  Resource.httpServer(resource).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  )
```

Now the **worker runtime** is one pipe — [`QueueResource.serve`](/docs/queues) gives `Emails` its worker (the `effect`
that drains each job), piped onto port 3001:

{.twoslash}
``` ts
import * as QueueResource from "@nikscripts/effect-pm/QueueResource"
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Effect, Schema, Layer } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
const EmailJob = Schema.Struct({ to: Schema.String })
class Emails extends QueueResource.Tag<Emails>()("app/Emails", EmailJob) {}
declare const sendEmail: (job: typeof EmailJob.Type) => Effect.Effect<void>
const nodeServer = (port: number) => <A, E, R>(resource: Layer.Layer<A, E, R>) =>
  Resource.httpServer(resource).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  )
// ---cut---
const worker = QueueResource
  .serve(Emails, { effect: sendEmail })
  .pipe(nodeServer(3001))
// worker: Layer — provide it to a runtime to run the queue on :3001
```

The **scheduler runtime** runs `Digest` every hour, and each run **enqueues into `Emails`** — a queue
that lives on the *other* runtime, reached by port:

{.twoslash}
``` ts
import * as Process from "@nikscripts/effect-pm/Process"
import * as QueueResource from "@nikscripts/effect-pm/QueueResource"
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Polling } from "@nikscripts/effect-pm/Polling"
import { Effect, Duration, Layer, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String })
class Emails extends QueueResource.Tag<Emails>()("app/Emails", EmailJob) {}
class Digest extends Process.Tag<Digest>()("app/Digest") {}
declare const nextEmail: Effect.Effect<typeof EmailJob.Type>
// ---cut---
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
`emails.add(…)` read exactly as if the two shared one process. **Two Resources, two runtimes, one
program.** Move a runtime to another machine and only its port becomes a url — nothing else changes.

## Operate them live

A cross-runtime Service isn't just callable across runtimes — it's **operable** across them. The same
Handle that enqueues also controls and observes, so you steer and inspect the worker's queue from
anywhere it's reached:

{.twoslash}
``` ts
import * as QueueResource from "@nikscripts/effect-pm/QueueResource"
import { Effect, Stream, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String })
class Emails extends QueueResource.Tag<Emails>()("app/Emails", EmailJob) {}
declare const onChange: (e: unknown) => Effect.Effect<void>
const program = Effect.gen(function* () {
// ---cut---
const emails = yield* Emails            // emails: the Emails handle — local OR an RPC client, same type

yield* emails.pause                     // pause: Effect<void> — stop draining, at runtime
const depth = yield* emails.size.get    // depth: number — how many are waiting, right now
yield* emails.events.pipe(Stream.runForEach(onChange)) // events: Stream<QueueEvent> — every change, live
// ---cut-after---
})
```

And it comes with dashboards over the same Tag — a **`pm` CLI**, a **TUI**, and a **web** dashboard —
each reading the Resource without ever touching its Implementation.

## Working with peers

The same Tag also lets a Resource reach its **peers** — its own other instances — and coordinate with
them. Take sessions sharded across droplets: each Node holds the entries it owns, and a lookup for
someone else's session is **forwarded to the Node that owns it**. [`ShardMap`](/docs/shardmap) is that
pattern as a Resource factory — schemas on the Tag, routed ops, leaf shards, fleet sizes.

{.twoslash}
``` ts
import * as ShardMap from "@nikscripts/effect-pm/ShardMap"
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Schema } from "effect"
class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}
class DropletCentral extends Resource.Node<DropletCentral>("app/DropletCentral") {}
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String })
// ---cut---
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(
  Resource.distributed([DropletEast, DropletWest, DropletCentral]),
) {}
```

Serve a droplet with the mesh discharge — local shard + peer clients from one materialization:

{.twoslash}
``` ts
import * as ShardMap from "@nikscripts/effect-pm/ShardMap"
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Layer, Schema } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
class DropletEast extends Resource.Node<DropletEast>("app/DropletEast") {}
class DropletWest extends Resource.Node<DropletWest>("app/DropletWest") {}
class DropletCentral extends Resource.Node<DropletCentral>("app/DropletCentral") {}
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String })
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(
  Resource.distributed([DropletEast, DropletWest, DropletCentral]),
) {}
const nodeServer = (port: number) => <A, E, R>(resource: Layer.Layer<A, E, R>) =>
  Resource.httpServer(resource).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  )
// ---cut---
const east = ShardMap.serve(Sessions).pipe(
  Layer.provide(Resource.peersLayer(Sessions, DropletEast)),
  nodeServer(3001),
)
```

From any Node, a caller just asks — ownership and the cross-Node hop stay inside the Resource:

{.twoslash}
``` ts
import * as ShardMap from "@nikscripts/effect-pm/ShardMap"
import { Effect, Schema } from "effect"
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String })
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}) {}
declare const id: typeof SessionId.Type
// ---cut---
const program = Effect.gen(function* () {
  const sessions = yield* Sessions
  const session = yield* sessions.get(id) // Option<Session> — from whoever owns it
})
```

An unreachable owner degrades to a miss instead of blocking. **Every instance an equal — reached, and
reaching others, through the same Tag.**

## Build your own

Everything so far — `Emails`, `Digest`, `Sessions` — is built on one primitive you use directly. A
Resource is a **Contract** plus an **Implementation**, and it's first-class, not an escape hatch.

Describe the Contract — methods and their schemas:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Schema } from "effect"
// ---cut---
class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),          // an observable value — get + live changes
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
}) {}
```

Give it an Implementation:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Effect, Schema, SubscriptionRef } from "effect"
class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
}) {}
// ---cut---
const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Resource.subscribable(ref),                    // surface the ref as the observable field
    increment: ({ by }: { by: number }) => SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})
```

That's it — it's now a cross-runtime Service like any built-in. The **same Tag**, provided the same
three ways:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Effect, Schema, SubscriptionRef, Layer } from "effect"
class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
}) {}
const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Resource.subscribable(ref),
    increment: ({ by }: { by: number }) => SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})
const nodeServer = (port: number) => <A, E, R>(resource: Layer.Layer<A, E, R>) => resource
// ---cut---
Resource.layer(Counter, counterImpl)                        // in-process
Resource.serve(Counter, counterImpl).pipe(nodeServer(4000)) // served over RPC
Resource.clientHttp(Counter, 4000)                          // reached from another runtime
```

And it gets the rest for free — the live `value`, runtime control, and a slot in the `pm` CLI, TUI,
and web dashboards — because it's the same kind of thing `Emails` is.

## The included types

You don't start from scratch, either — the types you reach for most ship ready-made, each a
cross-runtime Service you use like an Effect primitive:

- **Long-running processes** ([`Process`](/docs/processes)) — continuous or recurring work: a polling
  cadence, arm/disarm schedule windows, execution history, and more.
- **Queue** ([`QueueResource`](/docs/queues)) — a priority work queue: enqueue items, workers drain them
  with dedup, retry, and concurrency control; durable when you provide a store.
- **Shard map** ([`ShardMap`](/docs/shardmap)) — partitioned key/value across a fleet: routed
  `get` / `put` / `delete`, leaf shards, and fleet size folds via peers.
