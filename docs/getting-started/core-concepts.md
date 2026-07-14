{#core-concepts title="Core Concepts" status="draft" done="api previews types verified" appliesTo=all}
# Core Concepts

Everything in effect-pm is a **resource** — a service you define once and reach through a tag, wherever
it runs. Three ideas carry the whole toolkit; the rest is detail.

## A resource is a contract + an implementation

The **contract** is the resource's methods and their schemas. You declare it as a **tag**:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Schema } from "effect"

class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),                  // observable state
  increment: Resource.effectFn({ by: Schema.Number }), // a call with an argument
}) {}
```

The tag is the entire interface — you don't import a class or a client, only the tag. `yield* Counter`
hands you the **handle**:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Effect, Schema } from "effect"
class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),
  increment: Resource.effectFn({ by: Schema.Number }),
}) {}
Effect.gen(function* () {
// ---cut---
const counter = yield* Counter        // the handle
const n = yield* counter.value.get    // read observable state — n: number
yield* counter.increment({ by: 1 })   // call a method
// ---cut-after---
void n
})
```

The **implementation** fills that contract in. You rarely touch it directly — you provide it as a
*layer*, which is the next idea.

## The same tag, provided differently

This is the core of the toolkit. A resource is defined once; *how* it runs is a layer you choose:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Effect, Schema, SubscriptionRef } from "effect"
class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),
  increment: Resource.effectFn({ by: Schema.Number }),
}) {}
const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Resource.subscribable(ref),
    increment: ({ by }: { readonly by: number }) => SubscriptionRef.update(ref, (m) => m + by),
  }
})
// ---cut---
const inProcess = Resource.layer(Counter, counterImpl) // run it here
const served = Resource.serve(Counter, counterImpl)    // expose it over HTTP
const client = Resource.clientHttp(Counter, 4000)      // reach a remote one
// ---cut-after---
void inProcess; void served; void client
```

- **In-process** — `Resource.layer` runs the resource in this runtime.
- **Served** — `Resource.serve` exposes it over RPC (provide a platform HTTP server to bind a port).
- **Client** — `Resource.clientHttp` connects to one already running elsewhere.

The handle is identical in all three: `yield* Counter` reads the same whether Counter runs beside you or
across the network. Swapping the layer is the *only* change — that's the "cross-runtime" in
cross-runtime service.

## The method kinds

A contract's methods are a handful of kinds:

- **`Resource.effect(schema)`** — a value you read (a query).
- **`Resource.effectFn(input, output?)`** — a call that takes an argument.
- **`Resource.ref(schema)`** — observable state: `.get` the value, subscribe to `.changes`.
- **`Resource.stream(schema)`** — a live stream of values.

## Nodes

When your app spans more than one runtime, name each runtime a **node** (`Resource.Node`), carrying its
address. A served resource reaches its peers through nodes. You only need them once you serve or mesh
across runtimes — see **[Fleets & Peers](/docs/fleets-and-peers)**.

## In a sentence

A **tag** names a resource; its **contract** is the methods; an **implementation** fills them; a
**layer** decides where it runs — local, served, or a client — and the **handle** from `yield* Tag` is
the same either way.

## Next

Put it together in **[Creating a Resource](/docs/creating-a-resource)**.
