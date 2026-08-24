{#view-typed-jsx title="Typed Views (View.make + Last.provide)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed Views — View.make and Last.provide

{.draft}
**Draft** — Twoslash fences include the **full** runnable files under
`examples/ui/view-typed-jsx/` (no `---cut---`); each fence shows its path.

**App:** [`examples/ui/view-typed-jsx/`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/ui/view-typed-jsx/)  
**Live island** imports the same `App` export.

TypeScript does not carry services `R` through `<Child />` expressions. Last
keeps `R` on **Layers** instead of inventing View-shaped masks:

1. **`View.make(key, default?)`** — Context slot; shape is a render fn (`ViewFn`).
   Pass a default for leaf HTML (Reference) — **no `static layer`**.
2. **`Layer.effect` + `Effect.gen` + `yield*`** — build a **const** Layer that
   pulls other Views (this is why View exists).
3. **`Last.provide(Tag, layer)`** — only JSX edge (`Effect.provide` + `runSync`).

## Layout

```text
examples/ui/view-typed-jsx/
  ui/
    Greeter.tsx     leaf DOM (View.make 2nd-arg default)
    Frame.tsx       Outer / Middle leaf shells
  lib/
    Hello.tsx       Hello Tag + helloLayer (yield* Greeter.Greeter)
    AppRoot.tsx     AppRoot Tag + appLayer (yield* Frame + Hello)
  App.tsx           Last.provide(AppRoot.AppRoot, AppRoot.appLayer)
```

Leaf Views own DOM. Composition Layers / `AppRoot` place Views only — **zero HTML**.
`import * as` for last-ts and local modules (lock).

## Greeter (leaf)

{.twoslash include="examples/ui/view-typed-jsx/ui/Greeter.tsx"}
``` tsx
```

## Frame shells (leaf)

{.twoslash include="examples/ui/view-typed-jsx/ui/Frame.tsx"}
``` tsx
```

## Hello (yield* Greeter)

{.twoslash include="examples/ui/view-typed-jsx/lib/Hello.tsx"}
``` tsx
```

## AppRoot (composition)

{.twoslash include="examples/ui/view-typed-jsx/lib/AppRoot.tsx"}
``` tsx
```

## Edge

Hover **`App`** → discharged root (`ViewFn`, no open `R`).

{.twoslash include="examples/ui/view-typed-jsx/App.tsx"}
``` tsx
```

| Symbol | Role |
|--------|------|
| `Greeter.Greeter` / `Frame.Outer` / `Frame.Middle` | Leaf References — HTML in the mint default |
| `Hello.helloLayer` / `AppRoot.appLayer` | Const Layers — `yield*` deps; never `static layer` |
| `App` | `Last.provide(AppRoot.AppRoot, AppRoot.appLayer)` → JSX-legal component |

## Live render

`App` under the docs island (same module as the fence above):

```view-jsx
```

Open-`R` at the edge: `Last.provide(Open, Layer.provide(openLayer, greeterLayer))`.

Optional slots stay `View.make(key, default)` — override with `Effect.provideService`
or `Layer.provideMerge`. See also [View Tag types](/docs/view-tag-types).
