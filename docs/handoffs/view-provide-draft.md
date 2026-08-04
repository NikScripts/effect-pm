# Upward values — `yield* Last.provide` → Context.Service

**Status:** spike Eng’d on `cursor/file-router-prototype-125f`  
**Package:** `last-ts` (`Last`, `View`)  
**Spine:** [effect-app-router-plan.md](./effect-app-router-plan.md) — `Page.view` / Layout `yield*`  
**Sibling:** [view-compose-draft.md](./view-compose-draft.md)

---

## JSX import

**Not required** for this channel. Stock `react` jsx is fine.

---

## API (this is the product shape)

```tsx
class ShellMeta extends Context.Service<
  ShellMeta,
  { readonly title: string }
>()("app/shell-meta") {}

const Hello = View.gen(function* () {
  yield* Last.provide(ShellMeta, { title: "uDumb" }) // partial OK
  return () => <p>body</p>
})

const App = View.mount(
  View.gen(function* () {
    const meta = yield* ShellMeta
    return () => (
      <header>
        <h1>{meta.title}</h1>
        <p>body</p>
      </header>
    )
  }),
  Last.toLayer(ShellMeta, Hello),
)
// incomplete Last.provide → toLayer is not Layer<ShellMeta>
```

| Piece | Role |
|-------|------|
| `Context.Service` | Bag identity + full shape |
| `yield* Last.provide(Svc, partial)` | Typed partial; last wins per service |
| `View.ProvidesOf` | Tokens from `Last.provide` yields |
| `Last.toLayer(Svc, view)` | Layer only if that view covered required keys |
| `View.mount` | Discharge `R` as today |

No `Last.provided`. Write path is only `Last.provide` inside gen.

---

## Verified

`test/last-provide.test-d.ts`, `test/last-provide.test.ts`

## Not yet

- Layout / Page
- Auto `Last.layer(Page)` merging every service Page’s Provides cover
- Prototype annotation Requirement stays separate
