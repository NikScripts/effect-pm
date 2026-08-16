# Typed Views — `View.make` + `Last.provide`

**Guide:** [`docs/guides/view-typed-jsx.md`](../../../docs/guides/view-typed-jsx.md)

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

## Rules

- **`import * as`** for last-ts and local modules (`import * as Greeter from "../ui/Greeter"`)
- **HTML only in `ui/`** leaf Views (defaults on `View.make`)
- **Composition / Layers in `lib/`** — zero DOM tags
- **No `static layer`** — const Layers at the edge (`Hello.helloLayer`, `AppRoot.appLayer`)
