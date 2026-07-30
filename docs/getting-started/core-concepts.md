{#core-concepts title="Core Concepts" done="api previews types verified" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version has navigation, search,
> and live type previews at <https://dev.hyperlink.cool/docs/core-concepts>.
<!-- docs-site-link:end -->
# Core Concepts

Every program depends on capabilities it does not build itself, a clock, a database, somewhere to
send email. Effect models each of those as a [**Service**](/docs/glossary#service). A
[**Hyperlink Service**](/docs/glossary#hyperlink-service) (or **HyperService**) is still a Service, 
same Tag, same `yield*`, with one addition that lets the seam sit between processes, not only
modules. This page starts with Services and adds that idea one step at a time.

## Services and Tags

A Service is a capability your program depends on. Rather than thread it through function after
function, you refer to it through a [**Tag**](/docs/glossary#tag): a typed name that stands for the
Service wherever it is used. Your code declares what it needs; the type system keeps track of it.

Working with a Service is three steps, define it, use it, and provide it:

{.twoslash}
``` ts
import { Context, Effect, Layer } from "effect"

// define: a service and its interface, named by a tag
class Random extends Context.Service<Random, {
  readonly next: Effect.Effect<number>
}>()("app/Random") {}

// use: reach the service by yielding its Tag
const program = Effect.gen(function* () {
  const random = yield* Random
  return yield* random.next
})

// provide: supply an implementation once, at the edge, with a Layer
const random = Layer.succeed(Random, {
  next: Effect.succeed(0.5),
})

program.pipe(Effect.provide(random))
```

The Tag sits between the two sides: ask for a capability on one side, fulfil it on the other.
Because that point is explicit, you can provide the real Service in production, a stub in a test, or
swap one for another, without touching the code that depends on it.

## From Services to Contracts

Hyperlink starts where Effect's Services leave off. A Hyperlink Service is a Service whose Tag
declares a [**Contract**](/docs/glossary#contract): the methods, together with a schema for every
value that passes through them.

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Schema } from "effect"

class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Hyperlink.ref(Schema.Number),                  // observable state
  increment: Hyperlink.effectFn({ by: Schema.Number }), // a call, with a typed argument
}) {}
```

That difference is what makes a HyperService *cross-runtime*. An ordinary Service is an interface for
one runtime to satisfy. A Contract, because every value it names is a schema, is an interface that
can be satisfied across runtimes, the schemas are enough to carry each call over the wire. The seam
a Tag creates, once a line between modules, can now be a line between processes.

## The same Tag, wherever it runs

You declare a HyperService once. Where it runs, you decide later, with the
[**Layer**](/docs/glossary#layer) you provide:

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Effect, Schema, SubscriptionRef } from "effect"
class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Hyperlink.ref(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }),
}) {}
const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Hyperlink.subscribable(ref),
    increment: ({ by }: { readonly by: number }) => SubscriptionRef.update(ref, (n) => n + by),
  }
})
// ---cut---
const inProcess = Hyperlink.layer(Counter, counterImpl) // run it in this runtime
const served = Hyperlink.serve(Counter, counterImpl)    // RPC handlers; mount with Node.http / Node.ws
const client = Hyperlink.connect(Counter, Hyperlink.protocolHttp(4000)) // dial one running elsewhere
// A browser dashboard opens many live streams: serve with Node.ws(…, port) and connect with
// Hyperlink.ws (WebSocket), or an HTTP client starves at the browser's connection cap.
// See Managing Layers for the full set of provide / serve / client layers.
// ---cut-after---
void inProcess; void served; void client
```

Whichever you choose, `yield* Counter` returns the same [**Handle**](/docs/glossary#handle). Reading
a value, calling a method, watching it change, the call site reads identically whether the
HyperService sits beside it or across a network. Only the Layer changes. That is what *cross-runtime*
means.

## The shape of a Contract

A Contract's methods take a small number of forms:

- **`Hyperlink.effect(schema)`**, a value to read (or a command with no payload).
- **`Hyperlink.effectFn(input, output?)`**, a call that takes an argument.
- **`Hyperlink.ref(schema)`**, observable state: read it with `.get`, follow it through `.changes`.
- **`Hyperlink.stream(schema)`**, a continuous stream of values.
- **`Hyperlink.value(schema)`**, materialize once at acquire into a plain value on the handle.
- **`Hyperlink.local`**, local-only (needs the local Layer; uncallable through a client).
- **`Hyperlink.default(…)`**. Tag-baked literal or sync fn; identical local and remote, no wire.
  Several extras: `Tag(…).pipe(Hyperlink.defaults({…}))` (see Creating).

Building your own Contract end to end is **[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**.
The package also ships a few **included** HyperServices ([`WorkPool`](/docs/work-pools),
[`Daemon`](/docs/daemons), and the rest) when you want a ready-made tool, secondary to building your
own.

## Nodes

When a program spans more than one runtime, each runtime is a [**Node**](/docs/glossary#node). A Node
carries the address at which its HyperServices can be reached, and served HyperServices find one
another through the Nodes they share. You reach for Nodes only when a HyperService is served or
distributed; a single-runtime program needs none. **[Fleets & Peers](/docs/fleets-and-peers)** covers
them in full; **[Managing Layers](/docs/managing-layers)** shows how to mount and dial them.

## The pieces, named

A **Tag** names a HyperService. Its **Contract** describes the methods and their schemas. An
**Implementation** fulfils the Contract, and a **Layer** places it (in process, served, or reached as
a client). The **Handle** you get from the Tag is the same in every case.

## Next

Place one with the Layer vocabulary in **[Managing Layers](/docs/managing-layers)**, or build one
end to end in **[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**.

Multi-node without a fixed address book: **[Fleets & Peers](/docs/fleets-and-peers)** ·
**[Identity coordinator](/docs/identity-coordinator)** · **[Policy](/docs/policy)** ·
**[Launcher](/docs/launcher)** · **[Client verify](/docs/client-verify)**.
