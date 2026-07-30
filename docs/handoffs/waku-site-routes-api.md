# Docs site — `Route.make` + `Router.make` on Waku

Typed API is the usual hyperlink dream shape. Waku is the engine.

## Definition (`siteRoutes.ts`)

```ts
export const site = Route.make("docsSite").add(
  Route.get("home", "/"),
  Route.get("search", "/search"),
  Route.get("releases", "/releases"),
  Route.get("docs", "/docs/:chapter").pipe(
    Route.params(Schema.Struct({ chapter: Schema.String })),
  ),
  Route.group("api").add(
    Route.get("index", "/api"),
    Route.get("pkg", "/api/:pkg").pipe(/* … */),
    Route.get("module", "/api/:pkg/:module").pipe(/* … */),
    Route.get("symbol", "/api/:pkg/:module/:symbol").pipe(/* … */),
  ),
)

// package Route.urlBuilder(site) + Module.symbol sugar
urls.docs("work-pools")
urls.api.symbol("effect", "Effect", "succeed")
urls.api.symbol("effect", "Effect.succeed") // overload
urls.search({ query: { q: "WorkPool" } })
```

## Use (`Router.tsx` — aliased as `hyperlink-ts/ui/Router`)

```tsx
const router = Router.make(site)

<Router.Provider value={router}>
  <Router.Link to={(u) => u.home()}>Home</Router.Link>
  <Router.Link to={(u) => u.docs("work-pools")}>Work pools</Router.Link>
  <Router.Link to={(u) => u.api.symbol("effect", "Effect.succeed")}>
    Effect.succeed
  </Router.Link>
</Router.Provider>

const r = Router.useRouter()
void r.to((u) => u.api.symbol("hyperlink-ts", "WorkPool", "Tag"))
```

## Layers

| Piece | Role |
|-------|------|
| `Route.make(site)` | Typed catalog (the definition) |
| `Route.urlBuilder` + sugar | Positional href builders (`urls`) |
| `Router.make` / `Link` / `to` | Vision nav API → Waku `Link`/`push` |
| `src/pages/` | Real match + RSC/SSG/SSR bodies |
| `Router.Outlet` | No-op (bodies are file routes) |
