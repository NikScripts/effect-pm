{#core-concepts title="Core Concepts" status="draft" done="api previews types verified" appliesTo=all}
# Core Concepts

effect-pm builds directly on Effect's model of services. Understanding that model first makes
everything that follows straightforward, so this page begins there and adds one idea at a time.

## Services and tags

In Effect, the things a program depends on — a clock, a database, a source of randomness — are
**services**. A service is reached through a **tag**: a typed identifier that stands in for the service
wherever the program refers to it. Code written against a tag states *what* it needs without deciding
*how* that need will be met.

{.twoslash}
``` ts
import { Context, Effect } from "effect"

class Random extends Context.Service<Random, {
  readonly next: Effect.Effect<number>
}>()("app/Random") {}
```

A program obtains the service by yielding its tag, and supplies it by providing a **layer**. Between the
two sits the tag — the single point where a capability is requested on one side and fulfilled on the
other. Nothing else couples them, which is what lets an implementation be swapped, mocked in a test, or
assembled at the edge of the application.

## From services to contracts

effect-pm begins where Effect's services leave off. A resource is a service, but its tag carries more
than a shape: it carries a **contract** — a description of the resource's methods together with the
schemas of every value that passes through them.

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Schema } from "effect"

class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),                  // observable state
  increment: Resource.effectFn({ by: Schema.Number }), // a call, with a typed argument
}) {}
```

The difference is consequential. An ordinary service tag describes an interface for a single runtime to
satisfy. A contract, because everything it names is a schema, describes an interface that can be
satisfied *across* runtimes — the schemas are enough to carry each call over the wire. The seam the tag
creates, once only a boundary between modules, becomes a boundary between processes.

## The same tag, wherever it runs

A resource is declared once. Where it runs is decided later, by the layer you provide:

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
const inProcess = Resource.layer(Counter, counterImpl) // run it in this runtime
const served = Resource.serve(Counter, counterImpl)    // expose it over HTTP
const client = Resource.clientHttp(Counter, 4000)      // reach one running elsewhere
// ---cut-after---
void inProcess; void served; void client
```

The handle returned by `yield* Counter` is identical in every case. Reading a value, calling a method,
observing a change — the code is the same whether the resource sits beside it or across a network. Only
the layer differs. This is the meaning of a *cross-runtime service*.

## The shape of a contract

A contract's methods take a small number of forms:

- **`Resource.effect(schema)`** — a value to read.
- **`Resource.effectFn(input, output?)`** — a call that takes an argument.
- **`Resource.ref(schema)`** — observable state: read it with `.get`, follow it through `.changes`.
- **`Resource.stream(schema)`** — a continuous stream of values.

## Nodes

When a program spans more than one runtime, each runtime is named a **node**. A node carries the address
at which its resources can be reached, and served resources find one another through the nodes they
share. Nodes enter the picture only when a resource is served or distributed; a single-runtime program
needs none. **[Fleets & Peers](/docs/fleets-and-peers)** covers them in full.

## In brief

A **tag** names a resource. Its **contract** describes the methods and their schemas. An
**implementation** fulfils the contract, and a **layer** places it — in process, served, or reached as
a client. The **handle** obtained from the tag is the same in every case.

## Next

Put it together in **[Creating a Resource](/docs/creating-a-resource)**.
