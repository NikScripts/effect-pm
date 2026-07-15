{#core-concepts title="Core Concepts" status="draft" done="api previews types verified" appliesTo=all}
# Core Concepts

This page walks the book's spine one step at a time. The Introduction named it; here each piece
earns its place: [**Service**](/docs/glossary#service) → [**Tag**](/docs/glossary#tag) →
[**Contract**](/docs/glossary#contract) → [**Resource**](/docs/glossary#resource) →
[**Handle**](/docs/glossary#handle). Later guides recontextualize these terms; they do not invent
new ones.

## Services and Tags

Every program depends on capabilities it does not build itself — a clock, a database, somewhere to
send email. Effect models each of these as a **Service**. Rather than thread the capability through
function after function, you refer to it through a **Tag**: a typed name that stands for the Service
everywhere it is used. Your code declares what it needs, and the type system keeps track of it.

Working with a Service is three steps — define it, use it, and provide it:

{.twoslash}
``` ts
import { Context, Effect } from "effect"

// define: a service and its interface, named by a tag
class Random extends Context.Service<Random, {
  readonly next: Effect.Effect<number>
}>()("app/Random") {}
```

You reach the Service by yielding its Tag, and you supply an Implementation once, at the edge of the
program, with a **Layer**. The Tag sits between the two: the single point where a capability is asked
for on one side and fulfilled on the other. Because that point is explicit, you can provide the real
Service in production, a stub in a test, or swap one for another — without touching the code that
depends on it.

## From Services to Contracts

An ordinary Effect Service stops at one runtime. Cross-runtime work hits the wall immediately: you
own the Implementation here and invent a client there, and the two shapes drift. effect-pm starts at
that wall. A Resource is a Service whose Tag declares a **Contract**: the Resource's methods, together
with a schema for every value that passes through them.

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Schema } from "effect"

class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),                  // observable state
  increment: Resource.effectFn({ by: Schema.Number }), // a call, with a typed argument
}) {}
```

That difference is what makes a Resource *cross-runtime*. An ordinary Service is an interface for one
runtime to satisfy. A Contract, because every value it names is a schema, is an interface that can be
satisfied across runtimes — the schemas are enough to carry each call over the wire. The seam a Tag
creates, once a line between modules, can now be a line between processes.

## The Same Tag, Wherever It Runs

You declare a Resource once. Where it runs, you decide later — with the Layer you provide:

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
const client = Resource.clientHttp(Counter, 4000)      // reach one running elsewhere (server / CLI)
// A browser dashboard opens many live streams — use Resource.socketClient (WebSocket) instead of an
// HTTP client, or it starves at the browser's connection cap. See the Dashboard guide.
// ---cut-after---
void inProcess; void served; void client
```

Watch the axis of variation: three Layers, one Tag. Whichever you choose, `yield* Counter` returns
the same Handle. Reading a value, calling a method, watching it change — the code reads identically
whether the Resource sits beside it or across a network. Only the Layer changes. That is what
*cross-runtime* means.

**Sharp edge:** a browser dashboard that opens many live streams saturates the browser's HTTP
connection cap if you use `Resource.clientHttp`. Use `Resource.socketClient` (WebSocket) there — see
the [Dashboard](/docs/dashboard) guide.

## The Shape of a Contract

A Contract's methods take a small number of forms:

- **`Resource.effect(schema)`** — a value to read.
- **`Resource.effectFn(input, output?)`** — a call that takes an argument.
- **`Resource.ref(schema)`** — observable state: read it with `.get`, follow it through `.changes`.
- **`Resource.stream(schema)`** — a continuous stream of values.

## Nodes

When a program spans more than one runtime, each runtime is a [**Node**](/docs/glossary#node). A Node
carries the address at which its Resources can be reached, and served Resources find one another
through the Nodes they share. Reach for Nodes when a Resource is served or distributed; a
single-runtime program needs none. **[Fleets & Peers](/docs/fleets-and-peers)** covers them in full.

## In Brief

A **Tag** names a Resource. Its **Contract** describes the methods and their schemas. An
**Implementation** fulfils the Contract, and a **Layer** places it — in process, served, or reached as
a client. The **Handle** you get from the Tag is the same in every case.

## Next

Put it together in **[Creating a Resource](/docs/creating-a-resource)**.
