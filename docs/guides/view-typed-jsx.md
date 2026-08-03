{#view-typed-jsx title="Typed Views (compose + mount)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed Views — bag compose and mount

TypeScript does not carry services `R` through `<Child />` expressions. Last
keeps `R` on the **view value** instead:

1. **`View.gen` / `View.succeed`** — build a view; open `R` ⇒ not a JSX component
2. **Bag form** — `succeed({ Hello }, ({ Hello }) => …)` / `gen({ Hello }, function* ({ Hello }) { … })` merges child `R` and keeps names for JSX inside the callback
3. **`View.mount(view, layer)`** — discharge `R` with a Layer → JSX-legal component

Hover **`Hello`** → **`Middle`** → **`Outer`** → **`App`**.

## Hover these values

{.twoslash include="examples/ui/view-typed-jsx.tsx"}
``` tsx
```

| Symbol | Role |
|--------|------|
| `Hello` | `View.gen` + `yield* Greeter` → `Unresolved` with `R = Greeter` |
| `Middle` / `Outer` | Bag `succeed` — use child in JSX; `R` still `Greeter` |
| `App` | `View.mount(Outer, Greeter.provide(…))` → `R = never` (JSX-legal) |

## Live render

`App` under the docs island (already mounted with `Greeter`):

```view-jsx
```

## Providing

- **Tag skins:** `View.provide(Greeter, impl)` / `Greeter.provide(impl)` → `Layer`
- **Open view graph:** compose with bag `gen` / `succeed`, then **`View.mount(view, layer)`** at the page/island edge
- **Opposite direction (not Eng’d):** upward value bag — `Last.provide` / Requires / Provides — see [view-provide-draft](../handoffs/view-provide-draft.md)

Do **not** write `<Hello />` while `Hello` still has open `R` — that is a type error. Convert via bag compose and/or `mount` first.

## Opt-in

```ts
/** @jsxImportSource last-ts */
```

or `"jsxImportSource": "last-ts"` in tsconfig. See also [View Tag types](/docs/view-tag-types).
