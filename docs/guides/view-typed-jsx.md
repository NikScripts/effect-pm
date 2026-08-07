{#view-typed-jsx title="Typed Views (Service + mount)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed Views — Service and mount

TypeScript does not carry services `R` through `<Child />` expressions. Last
keeps `R` on **Layers** instead of inventing View-shaped masks:

1. **`View.Service`** — `Context.Service` whose shape is a render fn (`ViewFn`)
2. **`Layer.succeed` / `Layer.effect` + `Effect.gen`** — build the service Layer
3. **`static layer`** — compose deps with `Layer.provide` until `R = never`
4. **`View.mount(Service)`** — only JSX edge; uses `Service.layer`

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
| `App` | `View.mount(Hello)` → JSX-legal component |

## Live render

`App` under the docs island:

```view-jsx
```

## Providing

```ts
class Greeter extends View.Service<Greeter, { readonly name: string }>()(
  "app/view/greeter",
) {
  static layer = Layer.succeed(
    Greeter,
    ({ name }) => <span>hello {name}</span>,
  )
}

class Hello extends View.Service<Hello, { readonly who: string }>()("app/Hello") {
  static layer = Layer.effect(
    Hello,
    Effect.gen(function* () {
      const G = yield* Greeter
      return (props: { readonly who: string }) => <G name={props.who} />
    }),
  ).pipe(Layer.provide(Greeter.layer))
}

const App = View.mount(Hello)
```

Upward values: `yield* Last.provide(Service, value)` — see
[effect-app-router-plan](../handoffs/effect-app-router-plan.md).

Use normal React JSX (`react/jsx-runtime`). See also [View Tag types](/docs/view-tag-types).
