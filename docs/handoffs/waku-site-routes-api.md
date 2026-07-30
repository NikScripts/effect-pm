# Docs site — `Route.make` + `Router.make` on Waku

Typed API is the usual hyperlink dream shape. Waku is the engine.

## SSOT

| Layer | Owns |
|-------|------|
| `src/pages/**` + `pages.gen` | Render / Twoslash / RSC-SSR file routes |
| `catalog` in `siteRoutes.ts` | Typed nav paths (written once) |

Waku `[param]` templates are **derived** from Route paths (`ToWaku` / `toWaku`).  
`test/site-routes.test-d.ts` fails if a required `pages.gen` path is missing from the catalog (or vice versa). Excluded on purpose: `/_root`, `/api/hyperlink-ts/…` (static specialize of `api.symbol`).

## Definition (`siteRoutes.ts`)

```ts
export const catalog = {
  home: "/",
  docs: "/docs/:chapter",
  api: {
    index: "/api",
    symbol: "/api/:pkg/:module/:symbol",
    // …
  },
} as const

export const site = Route.make("docsSite").add(
  Route.get("home", catalog.home),
  Route.get("docs", catalog.docs),
  Route.group("api").add(
    Route.get("symbol", catalog.api.symbol),
    // …
  ),
)

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
| `catalog` | SSOT path strings |
| `Route.make(site)` | Typed catalog from `catalog.*` |
| `Route.urlBuilder` + sugar | Positional href builders (`urls`) |
| `Router.make` / `Link` / `to` | Vision nav API → Waku `Link`/`push` |
| `src/pages/` | Real match + RSC/SSG/SSR bodies |
| `Router.Outlet` | No-op (bodies are file routes) |
