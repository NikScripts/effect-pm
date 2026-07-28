{#index title="Introduction" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/index>.
<!-- docs-site-link:end -->
# Hyperlink for Effect

**Define once. Run anywhere. `yield*` everywhere.**

An Effect Service lives in one runtime. A *Hyperlink Service* is still a Service — same Tag,
same `yield*` — but its Contract is schema-typed, so the seam can sit between processes, not just
modules. You define it once; you decide later whether it runs in-process, on another core, or across
the network. The call site does not change.

What you `yield*` is a typed **Handle**: call methods, observe live state, steer the service at
runtime. Local and remote are the same type. Change the Contract and TypeScript flags every caller —
in every process that imports the Tag. One surface.

The rest of this page is that idea under load: two runtimes sharing a queue, the same Handle
operating it live, building your own HyperService, then peers across a fleet.

## Two runtimes, one program

A worker drains a queue; a scheduler fills it. Two runtimes, one Tag — no hand-rolled client on the
scheduler side.

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

Same-machine, nameless: `Node.unix` mints a Node when you don't pass one — no `Node.Tag`, no path,
no port. The engine is mounted; discovery is built in:

{.twoslash}
``` ts
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Node from "hyperlink-ts/Node"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
declare const sendEmail: (job: typeof EmailJob.Type) => Effect.Effect<void>
// ---cut---
const worker = Node.unix([
  WorkPool.serve(Emails, { effect: sendEmail }),
])
```

The scheduler dials the same Tag — still `yield* Emails`:

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
    const emails = yield* Emails   // same Handle type as local
    const email = yield* nextEmail
    yield* emails.add(email)
  }),
  polling: Polling.spaced(Duration.hours(1)),
}).pipe(Layer.provide(Hyperlink.unix(Emails)))
```

`Digest` runs on the scheduler, `Emails` on the worker — yet `emails.add(…)` looks like one process.
**Two HyperServices, two runtimes, one program.** (Named Node: `Node.unix(Worker, …)` pairs with
`Hyperlink.unix(Worker)`; nameless: `Node.unix([serve…])` pairs with `Hyperlink.unix(Tag)`.)

When you need another machine (or a browser), step up to HTTP. Same worker, same Tag — only the
listen changes:

{.twoslash}
``` ts
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Node from "hyperlink-ts/Node"
import { Effect, Schema } from "effect"
const EmailJob = Schema.Struct({ to: Schema.String })
class Emails extends WorkPool.Tag<Emails>()("app/Emails", { payload: EmailJob }) {}
declare const sendEmail: (job: typeof EmailJob.Type) => Effect.Effect<void>
// ---cut---
const worker = Node.http(
  WorkPool.serve(Emails, { effect: sendEmail }),
  3001,
)
```

The scheduler dials with `Hyperlink.connect(Emails, Hyperlink.protocolHttp(3001))`. Move a runtime to
another machine and only the address changes. (`Node.httpServer` is the escape hatch when you need a
custom platform bind — prefer `Node.http` / `Node.ws` day to day; see
[Managing Layers](/docs/managing-layers).)

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

Dashboards ride the same Tag — a **CLI**, a **TUI**, and a **web** dashboard — without touching
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
import * as Node from "hyperlink-ts/Node"
import { Effect, Schema, SubscriptionRef } from "effect"
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
// ---cut---
Hyperlink.layer(Counter, counterImpl)                            // in-process
Node.http(Hyperlink.serve(Counter, counterImpl), 4000)           // served over RPC
Hyperlink.connect(Counter, Hyperlink.protocolHttp(4000))         // from another runtime
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
// ---cut---
const east = Node.http([ShardMap.serve(Sessions)], 3001).pipe(
  Layer.provide(Hyperlink.peersLayer(Sessions, DropletEast)),
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

## Included Hyperlink Services

Building your own is the focus. The package also ships a few **included** Hyperlink Services — full
Hyperlink Services you can drop in when you need them:

- **[`WorkPool`](/docs/work-pools)** — priority work queue: enqueue, drain, dedup, retry, concurrency
- **[`Daemon`](/docs/daemons)** — continuous or recurring work: polling, schedules, run history
- **[`ShardMap`](/docs/shardmap)** — partitioned key/value across a fleet, with peer routing
- **[`Gate`](/docs/gates)** · **[`Telemetry`](/docs/telemetry)** · **[`FleetHealth`](/docs/fleet-health)** —
  concurrency gates and glass over the mesh
