# DI Views — gen + mount (not JSX `R` bubbling, not bag compose)

**Status:** Eng on `cursor/file-router-prototype-125f`.  
**Not:** pretending stock TypeScript carries `R` through `<Child />`.  
**Not:** `View.succeed({ Child }, ({ Child }) => …)` bag compose — **removed**.  
**Opposite direction:** [view-provide-draft.md](./view-provide-draft.md) · spine [effect-app-router-plan.md](./effect-app-router-plan.md).

---

## Destination

```tsx
/** @jsxImportSource last-ts */
class Greeter extends View.Service<Greeter, { readonly name: string }>()("…") {
  static layer = Greeter.provide(({ name }) => <span>{name}</span>)
}

const Hello = View.gen(function* () {
  const GreeterView = yield* Greeter
  return (props: { readonly who: string }) => (
    <GreeterView name={props.who} />
  )
})
// Hello: Unresolved<{ who }, Greeter>

const App = View.mount(
  View.gen(function* () {
    const views = yield* Effect.all({ Greeter })
    return () => (
      <div>
        <views.Greeter name="nik" />
      </div>
    )
  }),
  Greeter.layer,
)
// App: Component<{}>
```

---

## Rules

| Piece | Behavior |
|-------|----------|
| `View<P, never>` | {@link Component} — JSX call signature |
| `View<P, R>` (`R` ≠ `never`) | {@link Unresolved} — **no** JSX call signature |
| `yield* Effect.all({ A, B })` | Resolve Services; JSX the results |
| `View.mount(view, layer)` | Discharge `R` via Layer + RuntimeProvider |
| `View.Service` + `static layer` | Effect v4 style default Layer (camelCase; never `*Live`) |
| `Service.provide` / `View.provide` | Layer builder (assign to `static layer` when wanted) |
| Bag `succeed({ Child }, …)` | **Removed** |
| `View.Tag` / `{ default }` bake-in | **Removed** — use `View.Service` + `static layer` |

Stock TS types every `<… />` as black-box `JSX.Element`. We do **not** rely on that for `R`.

---

## Verification

- `pnpm exec tsc -p packages/last-ts`
- `test/view-service.test-d.ts`, `test/view-jsx*.tsx`, `examples/ui/view-typed-jsx.tsx`
