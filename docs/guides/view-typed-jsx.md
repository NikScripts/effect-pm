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

1. **`View.make`** — `Context.Service` whose shape is a render fn (`ViewFn`)
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

const App = View.mount(Hello)
```

Upward values: `yield* Last.provide(Service, value)` — see
[effect-app-router-plan](../handoffs/effect-app-router-plan.md).

Use normal React JSX (`react/jsx-runtime`). See also [View Tag types](/docs/view-tag-types).

## Optional slots (`default`)

Pass a default component as the second argument — mint becomes a
`Context.Reference`. Layouts can always `yield*` the slot; pages / themes
override with `Effect.provideService` or `Layer.provideMerge`.

```ts
class Sidebar extends View.make<Sidebar>()(
  "app/Sidebar",
  () => <nav data-sidebar="default">Menu</nav>,
) {}

// Nested settings chrome — swap for this tree only
Effect.provideService(
  Sidebar,
  () => <nav data-sidebar="settings">Settings</nav>,
)

// Theme / section Layer (Reference is not in R — use provideMerge)
Layer.effect(Shell, …).pipe(
  Layer.provideMerge(Layer.succeed(Sidebar, ThemedSidebar)),
)
```

Annotations on Prototype mints stay as an **object** second arg:
`Service()(key, { spec: … })`. Default component is a **function** second arg.

Live toggle (default sidebar ↔ settings override):

```view-sidebar
```
