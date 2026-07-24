{#index title="Introduction" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/index>.
<!-- docs-site-link:end -->
# Hyperlink for Effect

**Define once. Run anywhere. `yield*` everywhere.**

JavaScript has been multi-core for a decade. Hyperlink makes writing it feel single-threaded again.

`yield*` a Service and it answers — from a parallel process, a second machine, the far side of the
network. Typed end to end, schema-validated at the wire. You never write the difference.

Heavy work moves off the event loop and onto your other cores; the app spreads across machines; and
not one call site changes: monolith in dev, fleet in prod, the same code either way. Change a
contract and the compiler flags every caller, in every process, on every machine. One typed surface.

That Service is a *Hyperlink Service*: define it once, run it on one runtime, call it from another
over RPC — with the **same typed Handle**. The Handle can **call, observe, and steer** wherever the
service runs. Inspired by and built on Effect RPC.

## Two runtimes, one program

Here is that claim as a program. A worker drains a queue; a scheduler fills it — two runtimes, one
Tag. No hand-rolled HTTP client on the scheduler side.

Define two HyperServices once — a priority queue and a scheduled daemon (included tools, used here
as the demo):

{.twoslash}
``` ts
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Daemon from "hyperlink-ts/Daemon"
import { Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String })
// ---cut---
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
class Digest extends Daemon.Tag<Digest>()("app/Digest") {}
```

Serve the queue on the **worker** runtime. `Node.httpServer` is platform-agnostic — you provide the
HTTP server once (Node, Bun, Deno, edge); that is the only line that names a platform:

{.twoslash}
``` ts
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Node from "hyperlink-ts/Node"
import { Effect, Schema, Layer } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
const EmailJob = Schema.Struct({ to: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
declare const sendEmail: (job: typeof EmailJob.Type) => Effect.Effect<void>
const nodeServer = (port: number) => <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Node.httpServer(layer).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  )
// ---cut---
const worker = WorkPool
  .serve(Emails, { effect: sendEmail })
  .pipe(nodeServer(3001))
```

On the **scheduler** runtime, `Digest` ticks every hour and enqueues into `Emails` — a queue that
lives on the *other* runtime. Inside the effect it still reads as `yield* Emails`:

{.twoslash}
``` ts
import * as Daemon from "hyperlink-ts/Daemon"
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Polling from "hyperlink-ts/Polling"
import { Effect, Duration, Layer, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
class Digest extends Daemon.Tag<Digest>()("app/Digest") {}
declare const nextEmail: Effect.Effect<typeof EmailJob.Type>
// ---cut---
const scheduler = Daemon.layer(Digest, {
  effect: Effect.gen(function* () {
    const emails = yield* Emails   // RPC client — same Handle type as local
    const email = yield* nextEmail
    yield* emails.add(email)
  }),
  polling: Polling.spaced(Duration.hours(1)),
}).pipe(Layer.provide(Hyperlink.connect(Emails, Hyperlink.protocolHttp(3001))))
```

`Digest` runs on the scheduler, `Emails` on the worker — yet `emails.add(…)` looks like one process.
**Two HyperServices, two runtimes, one program.** Move a runtime to another machine and only the
address changes.

## The same Handle steers it

Callable across runtimes is half the product. The Handle is also **operable** across them — pause,
depth, live events — from anywhere the Tag is reached:

{.twoslash}
``` ts
import * as WorkPool from "hyperlink-ts/WorkPool"
import { Effect, Stream, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
declare const onChange: (e: unknown) => Effect.Effect<void>
const program = Effect.gen(function* () {
// ---cut---
const emails = yield* Emails            // local OR remote — same type

yield* emails.pause                     // stop draining, at runtime
const depth = yield* emails.size.get    // how many waiting, right now
yield* emails.events.pipe(Stream.runForEach(onChange))
// ---cut-after---
})
```

Dashboards ride the same Tag — a **`pm` CLI**, a **TUI**, and a **web** dashboard — without touching
the Implementation.

## Build your own

`Emails` and `Digest` are not special cases. Every Hyperlink Service is a **Contract** plus an
**Implementation**. You use that primitive directly:

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Schema } from "effect"
// ---cut---
class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Hyperlink.ref(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }),
  reset: Hyperlink.effect(Schema.Void),
}) {}
```

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Effect, Schema, SubscriptionRef } from "effect"
class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Hyperlink.ref(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }),
  reset: Hyperlink.effect(Schema.Void),
}) {}
// ---cut---
const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Hyperlink.subscribable(ref),
    increment: ({ by }: { by: number }) => SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})
```

Same Tag, three placements — in-process, served, or connected:

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Effect, Schema, SubscriptionRef, Layer } from "effect"
class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Hyperlink.ref(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }),
  reset: Hyperlink.effect(Schema.Void),
}) {}
const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Hyperlink.subscribable(ref),
    increment: ({ by }: { by: number }) => SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})
const nodeServer = (port: number) => <A, E, R>(layer: Layer.Layer<A, E, R>) => layer
// ---cut---
Hyperlink.layer(Counter, counterImpl)                                         // in-process
Hyperlink.serve(Counter, counterImpl).pipe(nodeServer(4000))                  // served over RPC
Hyperlink.connect(Counter, Hyperlink.protocolHttp(4000))                      // from another runtime
```

It gets operability and dashboard slots for free — because it is the same kind of thing `Emails` is.
Walk through this end to end in [Creating a Hyperlink Service](/docs/creating-a-hyperlink).

## Working with peers

The same Tag can reach its **peers** — other instances of itself — and coordinate. Sessions sharded
across droplets: each Node holds what it owns; a lookup for someone else's session is **forwarded to
the owner**. [`ShardMap`](/docs/shardmap) is that pattern as an included HyperService factory:

{.twoslash}
``` ts
import * as ShardMap from "hyperlink-ts/ShardMap"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Schema } from "effect"
class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}
class DropletCentral extends Node.Tag<DropletCentral>()("app/DropletCentral") {}
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String })
// ---cut---
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(
  Hyperlink.nodes([DropletEast, DropletWest, DropletCentral]),
) {}
```

Serve a droplet — local shard + peer clients from one materialization:

{.twoslash}
``` ts
import * as ShardMap from "hyperlink-ts/ShardMap"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Layer, Schema } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
class DropletEast extends Node.Tag<DropletEast>()("app/DropletEast") {}
class DropletWest extends Node.Tag<DropletWest>()("app/DropletWest") {}
class DropletCentral extends Node.Tag<DropletCentral>()("app/DropletCentral") {}
const SessionId = Schema.String
const Session = Schema.Struct({ id: SessionId, userId: Schema.String })
class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: SessionId,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(
  Hyperlink.nodes([DropletEast, DropletWest, DropletCentral]),
) {}
const nodeServer = (port: number) => <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Node.httpServer(layer).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  )
// ---cut---
const east = ShardMap.serve(Sessions).pipe(
  Layer.provide(Hyperlink.peersLayer(Sessions, DropletEast)),
  nodeServer(3001),
)
```

From any Node, a caller just asks — ownership and the hop stay inside the HyperService:

{.twoslash}
``` ts
import * as ShardMap from "hyperlink-ts/ShardMap"
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

An unreachable owner degrades to a miss instead of blocking. **Every instance an equal — reached,
and reaching others, through the same Tag.**

## Included HyperServices

Building your own is the focus. The package also ships a few **included** HyperServices — full
HyperServices you can drop in when you need them:

- **[`WorkPool`](/docs/work-pools)** — priority work queue: enqueue, drain, dedup, retry, concurrency
- **[`Daemon`](/docs/daemons)** — continuous or recurring work: polling, schedules, run history
- **[`ShardMap`](/docs/shardmap)** — partitioned key/value across a fleet, with peer routing
- **[`Gate`](/docs/gates)** · **[`Telemetry`](/docs/telemetry)** · **[`FleetHealth`](/docs/fleet-health)** —
  concurrency gates and glass over the mesh
