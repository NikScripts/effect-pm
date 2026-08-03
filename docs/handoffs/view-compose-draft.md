# DI Views — bag compose + mount (not JSX `R` bubbling)

**Status:** Eng on `cursor/file-router-prototype-125f`.  
**Not:** pretending stock TypeScript carries `R` through `<Child />`.  
**Opposite direction (not Eng’d):** [view-provide-draft.md](./view-provide-draft.md) — Requires / Provides / `Last.provide`.

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
// Hello: Unresolved<{ who }, Greeter> — not JSX-legal

const Middle = View.succeed({ Hello }, ({ Hello }) => (_props) => (
  <aside>
    <Hello who="nik" />
  </aside>
))
// Middle: Unresolved<{}, Greeter>

const Outer = View.succeed({ Middle }, ({ Middle }) => (_props) => (
  <div>
    <Middle />
  </div>
))

const App = View.mount(
  Outer,
  Greeter.provide(({ name }) => <span>{name}</span>),
)
// App: Component<{}> — render <App />
```

---

## Rules

| Piece | Behavior |
|-------|----------|
| `View<P, never>` | {@link Component} — JSX call signature |
| `View<P, R>` (`R` ≠ `never`) | {@link Unresolved} — **no** JSX call signature |
| Bag `succeed` / `gen` | Child views as object values → names preserved; `R` merged; JSX OK **inside** callback |
| `View.mount(view, layer)` | Provides `R` via Layer + RuntimeProvider; returns view with remaining layer input (usually `never`) |
| `Tag.provide` / `View.provide` | Layer for a Tag skin (downward DI) |
| JSX `<OpenView />` | Type error while `R` open |

Stock TS types every `<… />` as black-box `JSX.Element`. We do **not** rely on that for `R`.

---

## Verification

- `test/view-jsx.test-d.tsx` — opaque open `R`, bag compose, mount
- `examples/ui/view-typed-jsx.tsx` + docs guide Twoslash
- `packages/last-ts` typecheck (`jsxImportSource: "last-ts"`)

---

## Not this

```ts
yield* needs(Hello)
View.el(Parent, { children: View.el(Child) })
// bare <Hello /> while Hello still has open R
```
