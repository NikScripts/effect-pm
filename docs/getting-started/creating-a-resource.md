{#creating-a-resource title="Creating a Resource" status="draft" appliesTo=all}
# Creating a Resource

{.draft}
**Draft.** Tip-check before treating as SSOT.

Build one [**Resource**](/docs/glossary#resource) end to end: declare a [**Tag**](/docs/glossary#tag),
fulfil its [**Contract**](/docs/glossary#contract) with an
[**Implementation**](/docs/glossary#implementation), place it with a
[**Layer**](/docs/glossary#layer), and call it through a [**Handle**](/docs/glossary#handle).

Each fence adds one piece. The Tag runs in-process when you finish. The same call site still works
when you later serve or client it.

This page teaches the task. Contract method shapes live in
[Core Concepts](/docs/core-concepts). Serve, client, and fleet Layers live in
[Managing Layers](/docs/managing-layers).

## Declare the Tag

Put the Contract on the Tag: methods and their schemas. Nothing runs yet. This is the typed name
everything else hangs from:

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

Return those methods from an Implementation. A `SubscriptionRef` backs the observable `value`:

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

Wire Tag and Implementation with `Resource.layer`:

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

`yield* Counter` returns the Handle. Increment, read `value`, reset. Same shapes later sit behind
RPC:

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

## Try It Live

This exact Counter — the same Tag, the same `Resource.layer` — is running in this page right now.
The buttons call `increment` / `reset` on the Handle; the count reads straight off `value.changes`.
There is no extra API between the UI and the resource, the Handle *is* the surface:

``` resource
docs/Counter
```

## What Changes Next

Serve or client the same Tag without rewriting the program body. Only the Layer at the edge changes.
That tour is [Managing Layers](/docs/managing-layers).

**Sharp edge.** A browser dashboard that opens many live streams hits the browser HTTP connection
cap if you pair `httpServer` with `connect(tag, protocolHttp(port))`. Serve with `Resource.wsServer` and connect with
`Resource.ws`. Same Tag, different wire. Details live on Managing Layers.
