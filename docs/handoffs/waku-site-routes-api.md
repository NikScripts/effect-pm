# Docs site — `Route.make` + `Router.make` on Waku

Typed API is the usual hyperlink dream shape. Waku is the engine.

## SSOT

| Layer | Owns |
|-------|------|
| `src/pages/**` + `pages.gen` | Render / Twoslash / RSC-SSR file routes |
| `destinations` in `siteRoutes.ts` | Typed nav catalog (Route path ↔ Waku `[param]` template) |

`test/site-routes.test-d.ts` fails if a required `pages.gen` path is missing from `destinations` (or vice versa). Excluded on purpose: `/_root`, `/api/hyperlink-ts/…` (static specialize of `api.symbol`).

## Definition (`siteRoutes.ts`)

```ts
export const destinations = [
  { id: "home", path: "/", waku: "/" },
  { id: "docs", path: "/docs/:chapter", waku: "/docs/[chapter]" },
  { id: "api.symbol", path: "/api/:pkg/:module/:symbol", waku: "/api/[pkg]/[module]/[symbol]" },
  // …
] as const

export const site = Route.make("docsSite").add(/* matches destinations */)

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
| `destinations` | SSOT bridge (Route ↔ Waku templates) |
| `Route.make(site)` | Typed catalog |
| `Route.urlBuilder` + sugar | Positional href builders (`urls`) |
| `Router.make` / `Link` / `to` | Vision nav API → Waku `Link`/`push` |
| `src/pages/` | Real match + RSC/SSG/SSR bodies |
| `Router.Outlet` | No-op (bodies are file routes) |
