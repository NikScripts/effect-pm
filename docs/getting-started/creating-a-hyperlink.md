{#creating-a-hyperlink title="Creating a Hyperlink Service" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/creating-a-hyperlink>.
<!-- docs-site-link:end -->
# Creating a Hyperlink Service

{.draft}
**Draft.** Tip-check before treating as SSOT.

Build one [hyperlink service](/docs/glossary#hyperlink-service) end to end: declare a
[tag](/docs/glossary#tag), write its [contract](/docs/glossary#contract) with an
[implementation](/docs/glossary#implementation), place it with a [layer](/docs/glossary#layer), and
call it through a [handle](/docs/glossary#handle).

Each fence adds one piece. The tag runs in-process when you finish. The same call site still works
when you later serve or client it.

This page teaches the task. Contract method shapes live in
[Core Concepts](/docs/core-concepts). Serve, client, and fleet layers live in
[Managing Layers](/docs/managing-layers). Prebuilt hyperservices
([`WorkPool`](/docs/work-pools), [`Daemon`](/docs/daemons), and the rest) are optional tools,
secondary to building your own.

## Declare the tag

Put the contract on the tag: methods and their schemas. Nothing runs yet. This is the typed name
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

## Fulfil it

Return those methods from an implementation. A `SubscriptionRef` backs the observable `value`:

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

## Place it in-process

Wire tag and implementation with `Hyperlink.layer`:

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

## Call the handle

`yield* Counter` returns the handle. Increment, read `value`, reset. Same shapes later sit behind
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

## Try It Live

This exact Counter (the same tag, the same `Hyperlink.layer`) is running in this page right now.
The buttons call `increment` / `reset` on the handle; the count reads straight off `value.changes`.
There is no extra API between the UI and the resource: the handle *is* the surface.

``` resource
docs/Counter
```

## Tag-baked defaults (optional)

Same value on local and remote, no impl slot, no RPC. One field in the contract with
`Hyperlink.default`; several extras with `Hyperlink.defaults` on the Tag:

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Schema } from "effect"

class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Hyperlink.ref(Schema.Number),
  label: Hyperlink.default((n: number) => `count=${n}`),
}, {
  defaults: { unit: "count" as const },
}) {}
```

`label` is on `Service` (Spec leaf). Factory `{ defaults }` (or `.pipe(Hyperlink.defaults(…))`)
widens `Service` the same way — `yield* Counter` sees both. Layer overrides are
**provide-site only** (local handle) — clients always see the Tag-baked value. Post-hoc
local patches: `Layer.updateService`.

## What changes next

Serve or client the same tag without rewriting the program body. Only the layer at the edge changes.
That tour is [Managing Layers](/docs/managing-layers).

**Sharp edge.** A browser dashboard that opens many live streams hits the browser HTTP connection
cap if you pair `Node.http(…, 3000)` with `connect(tag, protocolHttp(3000))`. Serve with
`Node.ws(…, 3000)` and connect with `Hyperlink.ws` (or `protocolWebsocket(3000)`). Same tag,
different wire. Details live on Managing Layers.
