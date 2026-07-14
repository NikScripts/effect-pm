{#core-concepts title="Core Concepts" status="draft" done="api previews types verified" appliesTo=all}
# Core Concepts

Every program depends on capabilities it does not build itself — a clock, a database, somewhere to send
email. Effect models each of these as a [**service**](/docs/glossary#service), and effect-pm's resources
build directly on that model. This page starts with services and adds one idea at a time.

## Services and tags

A service is a capability your program depends on. Rather than thread it through function after
function, you refer to it through a [**tag**](/docs/glossary#tag): a typed name that stands for the service everywhere it is
used. Your code declares what it needs, and the type system keeps track of it for you.

Working with a service is three steps — define it, use it, and provide it:

{.twoslash}
``` ts
import { Context, Effect } from "effect"

// define: a service and its interface, named by a tag
class Random extends Context.Service<Random, {
  readonly next: Effect.Effect<number>
}>()("app/Random") {}
```

You reach the service by yielding its tag, and you supply an implementation once, at the edge of the
program, with a **layer**. The tag sits between the two: the single point where a capability is asked
for on one side and fulfilled on the other. Because that point is explicit, you can provide the real
service in production, a stub in a test, or swap one for another — without touching the code that
depends on it.

## From services to contracts

effect-pm starts where Effect's services leave off. A resource is a service, but its tag declares a
[**contract**](/docs/glossary#contract): the resource's methods, together with a schema for every value that passes through them.

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Schema } from "effect"

class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),                  // observable state
  increment: Resource.effectFn({ by: Schema.Number }), // a call, with a typed argument
}) {}
```

That difference is what makes a resource *cross-runtime*. An ordinary service is an interface for one
runtime to satisfy. A contract, because every value it names is a schema, is an interface that can be
satisfied across runtimes — the schemas are enough to carry each call over the wire. The seam a tag
creates, once a line between modules, can now be a line between processes.

## The same tag, wherever it runs

You declare a resource once. Where it runs, you decide later — with the layer you provide:

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

Whichever you choose, `yield* Counter` returns the same handle. Reading a value, calling a method,
watching it change — the code reads identically whether the resource sits beside it or across a
network. Only the layer changes. That is what *cross-runtime* means.

## The shape of a contract

A contract's methods take a small number of forms:

- **`Resource.effect(schema)`** — a value to read.
- **`Resource.effectFn(input, output?)`** — a call that takes an argument.
- **`Resource.ref(schema)`** — observable state: read it with `.get`, follow it through `.changes`.
- **`Resource.stream(schema)`** — a continuous stream of values.

## Nodes

When a program spans more than one runtime, each runtime is a [**node**](/docs/glossary#node). A node carries the address at
which its resources can be reached, and served resources find one another through the nodes they share.
You reach for nodes only when a resource is served or distributed; a single-runtime program needs none.
**[Fleets & Peers](/docs/fleets-and-peers)** covers them in full.

## In brief

A **tag** names a resource. Its **contract** describes the methods and their schemas. An
**implementation** fulfils the contract, and a **layer** places it — in process, served, or reached as
a client. The **handle** you get from the tag is the same in every case.

## Next

Put it together in **[Creating a Resource](/docs/creating-a-resource)**.
