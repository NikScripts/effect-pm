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

function* helloProvides() {
  yield* Last.provide(ShellMeta, { title: "uDumb" }) // partial OK
}

class Page extends View.make<Page>()("app/Page") {
  static layer = Layer.effect(
    Page,
    Effect.gen(function* () {
      const meta = yield* ShellMeta
      return () => (
        <header>
          <h1>{meta.title}</h1>
          <p>body</p>
        </header>
      )
    }),
  ).pipe(Layer.provide(Last.toLayer(ShellMeta, helloProvides)))
}

const App = View.mount(Page)
```

| Piece | Role |
|-------|------|
| `Context.Service` | Bag identity + full shape |
| `yield* Last.provide(Svc, partial)` | Typed partial; last wins |
| `Last.toLayer(Svc, function*)` | Layer only if generator covered required keys |
| `View.mount(Service)` | App edge |

---

## Verified

`test/last-provide.test-d.ts`, `test/last-provide.test.ts`
