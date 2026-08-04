{#view-typed-jsx title="Typed Views (Service + mount)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed Views — Service and mount

TypeScript does not carry services `R` through `<Child />` expressions. Last
keeps `R` on the **view value** instead:

1. **`View.Service`** — `Context.Service`-shaped DI handle; optional `{ default }` → `.layer`
2. **`View.gen`** — build a view; open `R` ⇒ not a JSX component
3. **`View.mount(view, Service.layer)`** — discharge `R` → JSX-legal component

Compose multiple services with `yield* Effect.all({ A, B })`. There is **no** bag
`View.succeed({ Child }, …)` form. Layer values are camelCase (`greeter.layer` /
`Callout.layer` on the class — never `*Live`).

Hover **`Hello`** → **`App`**.

## Hover these values

{.twoslash include="examples/ui/view-typed-jsx.tsx"}
``` tsx
```

| Symbol | Role |
|--------|------|
| `Hello` | `View.gen` + `yield* Greeter` → `Unresolved` with `R = Greeter` |
| `App` | `View.mount(…, Greeter.layer)` → `R = never` (JSX-legal) |

## Live render

`App` under the docs island:

```view-jsx
```

## Providing

```ts
class Greeter extends View.Service<Greeter, { readonly name: string }>()(
  "app/view/greeter",
  { default: ({ name }) => <span>hello {name}</span> },
) {}

View.mount(Hello, Greeter.layer)
```

Without a default: `const greeterLayer = Greeter.provide(impl)`.

Upward values: `yield* Last.provide(Service, value)` — see
[effect-app-router-plan](../handoffs/effect-app-router-plan.md).

## Opt-in

```ts
/** @jsxImportSource last-ts */
```

or `"jsxImportSource": "last-ts"` in tsconfig. See also [View Tag types](/docs/view-tag-types).
