{#view-typed-jsx title="Typed Views (Service + Last.provide)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed Views — Service and Last.provide

TypeScript does not carry services `R` through `<Child />` expressions. Last
keeps `R` on **Layers** instead of inventing View-shaped masks:

1. **`View.make`** — `Context.Service` whose shape is a render fn (`ViewFn`)
2. **`Layer.succeed` / `Layer.effect` + `Effect.gen`** — build the service Layer
3. **`static layer`** — compose deps with `Layer.provide` until `R = never`
4. **`Last.provide(Service, Service.layer)`** — only JSX edge (`Effect.provide` + `runSync`)

Compose multiple services with `yield* Effect.all({ A, B })`. There is **no** bag
`Layer.succeed({ Child }, …)` form. Layer values are camelCase (`greeter.layer` /
`Callout.layer` on the class — never `*Live`).

Hover **`Hello`** → **`App`**.

## Hover these values

{.twoslash include="examples/ui/view-typed-jsx.tsx"}
``` tsx
```

| Symbol | Role |
|--------|------|
| `Hello` | `Layer.effect` + `yield* Greeter`; deps on `Hello.layer` |
| `App` | `Last.provide(AppRoot, AppRoot.layer)` → JSX-legal component |

## Live render

`App` under the docs island:

```view-jsx
```

## Providing

```ts
class Greeter extends View.make<Greeter, { readonly name: string }>()(
  "app/view/greeter",
) {
  static layer = Layer.succeed(
    Greeter,
    ({ name }) => <span>hello {name}</span>,
  )
}

class Hello extends View.make<Hello, { readonly who: string }>()("app/Hello") {
  static layer = Layer.effect(
    Hello,
    Effect.gen(function* () {
      const G = yield* Greeter
      return (props: { readonly who: string }) => <G name={props.who} />
    }),
  ).pipe(Layer.provide(Greeter.layer))
}

const App = Last.provide(Hello, Hello.layer)
```

Open-`R` at the edge: `Last.provide(Open, Layer.provide(Open.layer, Greeter.layer))`.

Use normal React JSX (`react/jsx-runtime`). See also [View Tag types](/docs/view-tag-types).

## Optional slots (`default`)

Pass a default component as the second argument — mint becomes a
`Context.Reference`. Layouts can always `yield*` the slot; pages / themes
override with `Effect.provideService` or `Layer.provideMerge`.

```ts
class Sidebar extends View.make<Sidebar>()(
  "app/Sidebar",
  () => <aside>default</aside>,
) {}
```
