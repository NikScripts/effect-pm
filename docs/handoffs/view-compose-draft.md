# DI Views — gen as component (draft)

**Status:** design lean — correct the Layer mistake  
**Rule:** `View.gen` **is** the component you export and render. Do not wrap it in `.provide` / Layer just to exist.

---

## Shape

```ts
import * as View from "last-ts/View"

// Tag = Context service whose value is a component fn (others can yield* it)
class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
  "app/view/greeter",
) {}

// App edge (once): put Greeter's impl in the runtime Layer
// Greeter.provide(({ name }) => <h1>{name}</h1>)

// Component = straight View.gen export — NOT Tag.provide(View.gen(…))
export const Hello = View.gen(function* () {
  const GreeterView = yield* Greeter // service → component fn
  return (props: { readonly who: string }) => (
    <GreeterView name={props.who} />
  )
})

// Use as a normal component inside another View (under RuntimeProvider)
export const Page = View.gen(function* () {
  return () => <Hello who="nik" />
})

// void / undefined from the generator → treat as () => null
export const Empty = View.gen(function* () {
  yield* someSetup
  // no return / return void  →  component is () => null
})
```

| | Role |
|--|------|
| `View.Tag` | Named service identity so `yield* Tag` works |
| `Tag.provide` / Layer | **App edge only** — fulfill Tags the runtime needs |
| `View.gen` | **The component** — export it, render `<Hello />` |
| `yield* SomeTag` | Downward: need that Tag’s impl in the runtime Layer |
| `Last.provide` | Upward values (other direction) |

---

## Not this

```ts
// WRONG — gen is already the component
Hello.provide(View.gen(…))
Layer.succeed(Hello, View.gen(…))
```

---

## Types vs erasure

`yield* Greeter` already puts `Greeter` in the **Effect**’s `R` while the gen runs (under the runtime). That is enough for “this component needs Greeter provided at the app Layer.”

Pushing the same debt through React JSX types / `MyTag.View` / custom JSX is optional sugar — easy to over-invest for little gain. Prefer: gen + `yield* Tag` + runtime Layer at the root.

---

## Open small

- `View.gen`: normalize `void` → `() => null` (Eng).
- Whether a gen export can also be registered as a Tag without forcing Layer-first DX (only if someone needs `yield* Hello`).
