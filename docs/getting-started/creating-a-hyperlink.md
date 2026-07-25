{#creating-a-hyperlink title="Creating a HyperService" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/creating-a-hyperlink>.
<!-- docs-site-link:end -->
# Creating a Hyperlink Service

{.draft}
**Draft.** Tip-check before treating as SSOT.

Build one [**Hyperlink Service**](/docs/glossary#hyperlink-service) end to end: declare a
[**Tag**](/docs/glossary#tag), write its [**Contract**](/docs/glossary#contract) with an
[**Implementation**](/docs/glossary#implementation), place it with a
[**Layer**](/docs/glossary#layer), and call it through a [**Handle**](/docs/glossary#handle).

Each fence adds one piece. The Tag runs in-process when you finish. The same call site still works
when you later serve or client it.

This page teaches the task. Contract method shapes live in
[Core Concepts](/docs/core-concepts). Serve, client, and fleet Layers live in
[Managing Layers](/docs/managing-layers). Prebuilt HyperServices
([`WorkPool`](/docs/work-pools), [`Daemon`](/docs/daemons), and the rest) are optional tools —
secondary to building your own.

## Declare the Tag

Put the Contract on the Tag: methods and their schemas. Nothing runs yet. This is the typed name
everything else hangs from:

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Schema } from "effect"

class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Hyperlink.ref(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }),
  reset: Hyperlink.effect(Schema.Void),
}) {}
```

## Fulfil It

Return those methods from an Implementation. A `SubscriptionRef` backs the observable `value`:

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
    increment: ({ by }: { readonly by: number }) =>
      SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})
```

## Place It In-Process

Wire Tag and Implementation with `Hyperlink.layer`:

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
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
    increment: ({ by }: { readonly by: number }) =>
      SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})

// ---cut---
const inProcess = Hyperlink.layer(Counter, counterImpl)
```

## Call the Handle

`yield* Counter` returns the Handle. Increment, read `value`, reset. Same shapes later sit behind
RPC:

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
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
    increment: ({ by }: { readonly by: number }) =>
      SubscriptionRef.update(ref, (n) => n + by),
    reset: SubscriptionRef.set(ref, 0),
  }
})

const inProcess = Hyperlink.layer(Counter, counterImpl)

// ---cut---
const program = Effect.gen(function* () {
  const counter = yield* Counter // counter: the Counter handle
  yield* counter.increment({ by: 1 })
  const n = yield* counter.value.get // n: number
  yield* counter.reset
  return n
}).pipe(Effect.provide(inProcess))
```

## Try It

This exact Counter — the same Tag, the same `Hyperlink.layer` — is running in this page right now.
The buttons call `increment` / `reset` on the Handle; the count reads straight off `value.changes`.
There is no extra API between the UI and the resource, the Handle *is* the surface:

``` resource
docs/Counter
```

## What Changes Next

Serve or client the same Tag without rewriting the program body. Only the Layer at the edge changes.
That tour is [Managing Layers](/docs/managing-layers).

**Sharp edge.** A browser dashboard that opens many live streams hits the browser HTTP connection
cap if you pair `Node.http` with `connect(tag, protocolHttp(port))`. Serve with `Node.ws(…, port)`
and connect with `Hyperlink.ws`. Same Tag, different wire. Details live on Managing Layers.
