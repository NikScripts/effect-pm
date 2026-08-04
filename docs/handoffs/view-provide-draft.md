# Upward values — `yield* Last.provide` → Context.Service

**Status:** spike Eng’d on `cursor/file-router-prototype-125f`  
**Package:** `last-ts` (`Last`, `View`)  
**Spine:** [effect-app-router-plan.md](./effect-app-router-plan.md)  
**Sibling:** [view-compose-draft.md](./view-compose-draft.md)

---

## API

```tsx
class ShellMeta extends Context.Service<
  ShellMeta,
  { readonly title: string }
>()("app/shell-meta") {}

class Hello extends View.Service<Hello>()("app/Hello") {
  static layer = View.gen(Hello, function* () {
    yield* Last.provide(ShellMeta, { title: "uDumb" }) // partial OK
    return () => <p>body</p>
  })
}

class Page extends View.Service<Page>()("app/Page") {
  static layer = View.gen(Page, function* () {
    const meta = yield* ShellMeta
    return () => (
      <header>
        <h1>{meta.title}</h1>
        <p>body</p>
      </header>
    )
  })
}

const App = View.mount(
  Page,
  Page.layer.pipe(Layer.provide(Last.toLayer(ShellMeta, Hello.layer))),
)
// incomplete Last.provide → toLayer is not Layer<ShellMeta>
```

| Piece | Role |
|-------|------|
| `Context.Service` | Bag identity + full shape |
| `yield* Last.provide(Svc, partial)` | Typed partial; last wins per service |
| `ViewLayer` Provides phantom | Tokens from `Last.provide` yields |
| `Last.toLayer(Svc, viewLayer)` | Layer only if that layer covered required keys |
| `View.mount(Service, layer)` | App edge |

No `Last.provided`. Write path is only `Last.provide` inside `View.gen`.

---

## Verified

`test/last-provide.test-d.ts`, `test/last-provide.test.ts`
