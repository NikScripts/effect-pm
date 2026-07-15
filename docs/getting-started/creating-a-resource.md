{#creating-a-resource title="Creating a Resource" status="draft" appliesTo=all}
# Creating a Resource

{.draft}
**Draft** — tip-check before treating as SSOT.

Build the spine one delta at a time: declare a Tag, give it an Implementation, place it with a Layer,
call it through a Handle. Each fence adds one piece. By the end the same Tag runs in-process — and
the same call site will read identically when you later serve or client it.

This page is the task door. For Contracts, method shapes, and Nodes, see
**[Core Concepts](/docs/core-concepts)**. For serving and clients, see the Resources chapters and
the guides.

## Declare the Tag

Start with the Contract on the Tag — methods and their schemas. Nothing runs yet; this is the typed
name everything else hangs from:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Schema } from "effect"

class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
}) {}
```

## Fulfil It

Add an Implementation that returns those methods. A `SubscriptionRef` backs the observable `value`:

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
    value: Resource.subscribable(ref),
    increment: ({ by }: { readonly by: number }) =>
      SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})
```

## Place It In-Process

Wire Tag and Implementation with `Resource.layer`. That is the only new line from the previous fence:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Effect, Schema, SubscriptionRef } from "effect"

class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
}) {}

const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Resource.subscribable(ref),
    increment: ({ by }: { readonly by: number }) =>
      SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})

// ---cut---
const CounterLive = Resource.layer(Counter, counterImpl)
```

## Call the Handle

`yield* Counter` returns the Handle. Increment, read `value`, reset — same shapes you will use when
this Tag later sits behind RPC:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Effect, Schema, SubscriptionRef } from "effect"

class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
}) {}

const counterImpl = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  return {
    value: Resource.subscribable(ref),
    increment: ({ by }: { readonly by: number }) =>
      SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})

const CounterLive = Resource.layer(Counter, counterImpl)

// ---cut---
const program = Effect.gen(function* () {
  const counter = yield* Counter // counter: the Counter handle
  yield* counter.increment({ by: 1 })
  const n = yield* counter.value.get // n: number
  yield* counter.reset
  return n
}).pipe(Effect.provide(CounterLive))
```

## What Changes Next

Serve or client the same Tag without rewriting the program body:

- `Resource.serve(Counter, counterImpl)` — expose it over HTTP.
- `Resource.clientHttp(Counter, port)` — reach one running elsewhere.

Only the Layer at the edge changes. That is the whole point of the spine — see
**[Core Concepts → The Same Tag, Wherever It Runs](/docs/core-concepts#the-same-tag-wherever-it-runs)**
and the [Introduction](/docs/).

**Sharp edge:** browser dashboards that open many live streams need `Resource.socketClient`, not
`clientHttp` — the browser's connection cap queues forever otherwise. See
[Dashboard](/docs/dashboard).
