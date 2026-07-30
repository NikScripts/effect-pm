# Docs site — vision Router on Waku

**One API.** Path segments are **arguments**, not `{ params }`. Waku is the real router; this is a typed skin.

## API

```tsx
import * as Router from "hyperlink-ts/ui/Router" // → docs/site/src/ui/Router.tsx

<Router.Provider value={Router.docs}>
  <Router.Link to={(u) => u.docs("work-pools")}>Work pools</Router.Link>
  <Router.Link to={(u) => u.api.symbol("effect", "Effect.succeed")}>
    Effect.succeed
  </Router.Link>
  <Router.Link to={(u) => u.api.symbol("hyperlink-ts", "WorkPool", "Tag")}>
    WorkPool.Tag
  </Router.Link>
</Router.Provider>

const r = Router.useRouter()
void r.to((u) => u.releases())
void r.to((u) => u.api.symbol("effect", "Effect.succeed"))
```

```ts
urls.home()                                    // "/"
urls.docs("work-pools")                        // `/docs/${string}`
urls.api()                                     // "/api"
urls.api.pkg("hyperlink-ts")                   // `/api/${string}`
urls.api.module("hyperlink-ts", "WorkPool")    // `/api/${string}/${string}`
urls.api.symbol("effect", "Effect", "succeed") // `/api/effect/Effect/succeed`
urls.api.symbol("effect", "Effect.succeed")    // same (Module.symbol sugar)
```

## Mapping

| Call site | Engine |
|-----------|--------|
| `urls.*` / `to={(u) => …}` | typed path skin → Waku href |
| `Router.Link` / `to` / `go` | Waku `Link` / `push` / `replace` |
| `src/pages/` | RSC / SSG / SSR bodies (Twoslash) |
| `Router.Outlet` | no-op (bodies are file routes) |
