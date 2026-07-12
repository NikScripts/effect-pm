{#resource title="Resources" appliesTo=all}
# Resources

{.note}
**⚠️ Example only** — placeholder content that demonstrates the docs platform. **Not final**; to be replaced by Agent A. Do not treat as canonical.

A **resource** is a service you define by its *contract* and drive through a typed
handle. `Resource.Tag` is the base: you declare the methods, implement them with a
layer, and the same `yield* Tag` code runs locally or over RPC — only the layer
changes. Queues and run-gates are specialised resources; this is the raw one.

## 1. Define the contract

Each member is a `Resource.effect` (a read), a `Resource.effectFn` (a mutation, with
an optional `payload`), or a `Resource.stream` (a live source). Here's a counter:

``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"
import { Schema } from "effect"

class Counter extends Resource.Tag<Counter>()("app/Counter", {
  value: Resource.ref(Schema.Number),                                        // reactive: .get + .changes
  increment: Resource.effectFn({ by: Schema.Number }), // mutate
  reset: Resource.effect(Schema.Void),                                     // void command
}) {}
```

## 2. Implement it with a layer

`Resource.layer` provides the implementation — one entry per contract member. A
`SubscriptionRef` holds the value; `Resource.subscribable(ref)` surfaces it as the
`value` ref (its `get` + `changes`), and the mutations update it:

``` ts
import { Effect, SubscriptionRef } from "effect"

const ref = Effect.runSync(SubscriptionRef.make(0))
const counterLayer = Resource.layer(Counter, {
  value: Resource.subscribable(ref),
  increment: ({ by }) => SubscriptionRef.update(ref, (n) => n + by),
  reset: SubscriptionRef.set(ref, 0),
})
```

## 3. Use it

`yield* Counter` gives the handle — the methods, typed from the contract:

``` ts
const program = Effect.gen(function* () {
  const counter = yield* Counter
  yield* counter.increment({ by: 5 })
  const now = yield* counter.value.get    // 5 — read the ref
})
```

## 4. Wire it to the browser

Atoms make the resource reactive in React. `runtime.atom` turns the `changes`
stream into a live value; `runtime.fn` turns each mutation into a callable.

``` tsx
import { Atom } from "effect/unstable/reactivity"
import { Effect, Stream } from "effect"

const runtime = Atom.runtime(counterLayer)
const countAtom = runtime.atom(Stream.unwrap(Effect.map(Counter, (c) => c.value.changes)))
const increment = runtime.fn((by: number) => Effect.flatMap(Counter, (c) => c.increment({ by })))
const reset = runtime.fn(() => Effect.flatMap(Counter, (c) => c.reset))
```

## 5. Rig up the buttons

`useAtomValue` reads the live count; `useAtomSet` gives each button's handler.
Wrap the tree in `RegistryProvider`.

``` tsx
import { RegistryProvider, useAtomValue, useAtomSet } from "@nikscripts/effect-pm/web"
import { AsyncResult } from "effect/unstable/reactivity"

function CounterPanel() {
  const r = useAtomValue(countAtom)
  const count = AsyncResult.isSuccess(r) ? r.value : 0
  const inc = useAtomSet(increment)
  const doReset = useAtomSet(reset)
  return (
    <div>
      <div>{count}</div>
      <button onClick={() => inc(1)}>Increment</button>
      <button onClick={() => doReset(undefined)}>Reset</button>
    </div>
  )
}

export const App = () => (
  <RegistryProvider>
    <CounterPanel />
  </RegistryProvider>
)
```

## The result

Exactly the code above — the `Counter` resource, its layer, and this UI — running
live in your browser:

``` resource
docs/Counter
```
