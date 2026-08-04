# DI Views — gen + mount (not JSX `R` bubbling, not bag compose)

**Status:** Eng on `cursor/file-router-prototype-125f`.  
**Not:** pretending stock TypeScript carries `R` through `<Child />`.  
**Not:** `View.succeed({ Child }, ({ Child }) => …)` bag compose — **removed**.  
**Opposite direction:** [view-provide-draft.md](./view-provide-draft.md) · spine [effect-app-router-plan.md](./effect-app-router-plan.md).

---

## Destination

```tsx
/** @jsxImportSource last-ts */
class Greeter extends View.Tag<Greeter, { readonly name: string }>()("…") {}

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
  Greeter.provide(({ name }) => <span>{name}</span>),
)
// App: Component<{}>
```

---

## Rules

| Piece | Behavior |
|-------|----------|
| `View<P, never>` | {@link Component} — JSX call signature |
| `View<P, R>` (`R` ≠ `never`) | {@link Unresolved} — **no** JSX call signature |
| `yield* Effect.all({ A, B })` | Resolve Tags/services; JSX the results |
| `View.mount(view, layer)` | Discharge `R` via Layer + RuntimeProvider |
| `Tag.provide` / `View.provide` | Layer for a Tag skin |
| Bag `succeed({ Child }, …)` | **Removed** |

Stock TS types every `<… />` as black-box `JSX.Element`. We do **not** rely on that for `R`.

---

## Verification

- `test/view-jsx.test-d.tsx` — opaque open `R`, Effect.all, mount
- `examples/ui/view-typed-jsx.tsx` + docs guide Twoslash
- `packages/last-ts` typecheck

---

## Not this

```ts
View.succeed({ Hello }, ({ Hello }) => () => <Hello />)
// bare <Hello /> while Hello still has open R
```
