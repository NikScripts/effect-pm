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

## Use (soft-nav, no layout Provider)

In-app nav uses `Router.Link` / `router.to` / `router.go` — Waku soft-nav under
the hood. `Link` defaults to the docs catalog, so **no `RouterProvider` wrap**
around book chrome (avoids a full-tree client boundary). Hash / external links
stay native `<a>`.

```tsx
<Router.Link to={(u) => u.home()}>Home</Router.Link>
<Router.Link to={(u) => u.docs("work-pools")}>Work pools</Router.Link>
<Router.Link to={(u) => u.api.symbol("effect", "Effect.succeed")}>
  Effect.succeed
</Router.Link>

const r = Router.useRouter()
void r.to((u) => u.search({ query: { q: "WorkPool" } }))
```

## Layers

| Piece | Role |
|-------|------|
| `catalog` | SSOT path strings |
| `Route.make(site)` | Typed catalog from `catalog.*` |
| `Route.urlBuilder` + sugar | Positional href builders (`urls`) |
| `Router.Link` / `to` / `go` | Soft-nav via Waku (`docs/site/src/ui/Router.tsx`) |
| Chrome + API + search | In-app hrefs use `Router.Link` / `urls.*` (not raw `/api/…` strings) |
| Nav + chapter links | `hrefFor` / `resolveBookHref` / `docs/nav.ts` hrefs go through `urls` |
| `src/pages/` | Real match + RSC/SSG/SSR bodies |
| `Router.Outlet` | No-op (bodies are file routes) |
