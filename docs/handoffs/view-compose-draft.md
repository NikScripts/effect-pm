# DI Views — Service Layers + mount (not JSX `R` bubbling)

**Status:** Eng on `cursor/file-router-prototype-125f`.  
**Not:** freestanding View values you call as JSX.  
**Not:** `View.succeed({ Child }, …)` bag compose — **removed**.  
**Opposite direction:** [view-provide-draft.md](./view-provide-draft.md) · spine [effect-app-router-plan.md](./effect-app-router-plan.md).

---

## Destination

```tsx
/** @jsxImportSource last-ts */
class Greeter extends View.Service<Greeter, { readonly name: string }>()("…") {
  static layer = View.succeed(Greeter, ({ name }) => <span>{name}</span>)
}

class Hello extends View.Service<Hello, { readonly who: string }>()("…") {
  static layer = View.gen(Hello, function* () {
    const GreeterView = yield* Greeter
    return (props: { readonly who: string }) => (
      <GreeterView name={props.who} />
    )
  })
}
// Hello.layer: Layer<Hello, never, Greeter>

const App = View.mount(
  Hello,
  Hello.layer.pipe(Layer.provide(Greeter.layer)),
)
// App: Component<{ who }> — only JSX-legal edge
```

---

## Rules

| Piece | Behavior |
|-------|----------|
| `View.Service` | Context slot; `yield*` → component |
| `View.succeed(Service, impl)` | `Layer.succeed` twin → {@link ViewLayer} |
| `View.gen(Service, function*)` | `Layer.effect` + gen → {@link ViewLayer} |
| `View.effect(Service, fx)` | `Layer.effect` twin |
| `static layer = …` | Effect v4 default Layer (camelCase; never `*Live`) |
| `View.mount(Service, layer)` | **Only** JSX-legal output |
| Freestanding `View.gen(function*)` / unary `succeed(fn)` | **Removed** |
| `View.provide` / `Service.provide` | **Removed** — use `View.succeed` |
| Bag `succeed({ Child }, …)` | **Removed** |

Stock TS types every `<… />` as black-box `JSX.Element`. We do **not** rely on that for `R`. Layer `R` is the compose channel.

---

## Verification

- `pnpm exec tsc -p packages/last-ts`
- `test/view-service.test-d.ts`, `test/view-jsx*.tsx`, `test/last-provide.*`, `examples/ui/view-typed-jsx.tsx`
