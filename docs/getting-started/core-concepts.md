{#core-concepts title="Core Concepts" status="draft" done="api previews types verified" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/core-concepts>.
<!-- docs-site-link:end -->
# Core Concepts

Every program depends on capabilities it does not build itself — a clock, a database, somewhere to send
email. Effect models each of these as a [**Service**](/docs/glossary#service), and Hyperlinks
build directly on that model. This page starts with Services and adds one idea at a time.

## Services and Tags

A Service is a capability your program depends on. Rather than thread it through function after
function, you refer to it through a [**Tag**](/docs/glossary#tag): a typed name that stands for the Service everywhere it is
used. Your code declares what it needs, and the type system keeps track of it for you.

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

Hyperlink starts where Effect's Services leave off. A Hyperlink is a Service, but its Tag declares a
[**Contract**](/docs/glossary#contract): the Hyperlink's methods, together with a schema for every value that passes through them.

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Schema } from "effect"

class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Hyperlink.ref(Schema.Number),                  // observable state
  increment: Hyperlink.effectFn({ by: Schema.Number }), // a call, with a typed argument
}) {}
```

That difference is what makes a Hyperlink *cross-runtime*. An ordinary Service is an interface for one
runtime to satisfy. A Contract, because every value it names is a schema, is an interface that can be
satisfied across runtimes — the schemas are enough to carry each call over the wire. The seam a Tag
creates, once a line between modules, can now be a line between processes.

## The same Tag, wherever it runs

You declare a Hyperlink once. Where it runs, you decide later — with the Layer you provide:

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Effect, Schema, SubscriptionRef } from "effect"
class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Hyperlink.ref(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }),
}) {}
const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Hyperlink.subscribable(ref),
    increment: ({ by }: { readonly by: number }) => SubscriptionRef.update(ref, (m) => m + by),
  }
})
// ---cut---
const inProcess = Hyperlink.layer(Counter, counterImpl) // run it in this runtime
const served = Hyperlink.serve(Counter, counterImpl)    // expose it over HTTP
const client = Hyperlink.connect(Counter, Hyperlink.protocolHttp(4000))      // reach one running elsewhere (server / CLI)
// A browser dashboard opens many live streams — serve with Node.wsServer and connect with
// Hyperlink.ws (WebSocket), or an HTTP client starves at the browser's connection cap.
// See Managing Layers for the full set of provide/serve/client layers.
// ---cut-after---
void inProcess; void served; void client
```

Whichever you choose, `yield* Counter` returns the same Handle. Reading a value, calling a method,
watching it change — the code reads identically whether the Hyperlink sits beside it or across a
network. Only the Layer changes. That is what *cross-runtime* means.

## The shape of a Contract

A Contract's methods take a small number of forms:

- **`Hyperlink.effect(schema)`** — a value to read.
- **`Hyperlink.effectFn(input, output?)`** — a call that takes an argument.
- **`Hyperlink.ref(schema)`** — observable state: read it with `.get`, follow it through `.changes`.
- **`Hyperlink.stream(schema)`** — a continuous stream of values.

## Nodes

When a program spans more than one runtime, each runtime is a [**Node**](/docs/glossary#node). A Node carries the address at
which its Hyperlinks can be reached, and served Hyperlinks find one another through the Nodes they share.
You reach for Nodes only when a Hyperlink is served or distributed; a single-runtime program needs none.
**[Fleets & Peers](/docs/fleets-and-peers)** covers them in full.

## In brief

A **Tag** names a Hyperlink. Its **Contract** describes the methods and their schemas. An
**Implementation** fulfils the Contract, and a **Layer** places it — in process, served, or reached as
a client. The **Handle** you get from the Tag is the same in every case.

## Next

Put it together in **[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**.
