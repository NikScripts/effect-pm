{#view-typed-jsx title="Typed Views (gen + mount)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed Views — gen and mount

TypeScript does not carry services `R` through `<Child />` expressions. Last
keeps `R` on the **view value** instead:

1. **`View.gen` / `View.succeed(fn)`** — build a view; open `R` ⇒ not a JSX component
2. **Tags** — `yield* Tag` or `yield* Effect.all({ A, B })`, then JSX the resolved views
3. **`View.mount(view, layer)`** — discharge `R` with a Layer → JSX-legal component

There is **no** `View.succeed({ Child }, ({ Child }) => …)` bag form.

Hover **`Hello`** → **`App`**.

## Hover these values

{.twoslash include="examples/ui/view-typed-jsx.tsx"}
``` tsx
```

| Symbol | Role |
|--------|------|
| `Hello` | `View.gen` + `yield* Greeter` → `Unresolved` with `R = Greeter` |
| `App` | `View.mount(…, Greeter.provide(…))` → `R = never` (JSX-legal) |

## Live render

`App` under the docs island (already mounted with `Greeter`):

```view-jsx
```

## Providing

- **Tag skins:** `View.provide(Greeter, impl)` / `Greeter.provide(impl)` → `Layer`
- **Open `R`:** **`View.mount(view, layer)`** at the edge
- **Upward values:** `yield* Last.provide(Service, value)` — see [effect-app-router-plan](../handoffs/effect-app-router-plan.md)

Do **not** write `<Hello />` while `Hello` still has open `R` — that is a type error. `mount` first (or keep the work inside one `View.gen` that `yield*`s the Tag).

## Opt-in

```ts
/** @jsxImportSource last-ts */
```

or `"jsxImportSource": "last-ts"` in tsconfig. See also [View Tag types](/docs/view-tag-types).
