# Docs site — `Route.make` + Waku layer (`Router.waku`)

Typed API is the usual hyperlink dream shape. Waku is the engine via
`hyperlink-ts/ui/Router/waku` — **not** lite `Router.make` (Memory/History).

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

## Use (Waku layer + site skin)

Package Waku **layer** (`hyperlink-ts/ui/Router/waku`) — binding + adapters only,
not a mirror of `ui/Router`. Site `docs/site/src/ui/Router.tsx` is a thin skin —
branded `urls`, `setDefault(docs)`, no-op `Outlet` for file-route bodies.

```tsx
import * as Router from "../ui/Router" // site skin → Waku layer

const binding = Router.waku(site) // preferred; site `make` is a deprecated alias

<Router.Link to={urls.home()}>Home</Router.Link>
<Router.Link to={urls.docs("work-pools")}>Work pools</Router.Link>

const r = Router.useRouter()
void r.to((u) => u.search({ query: { q: "WorkPool" } }))
// live service: r._tag === "Waku"
```

## Layers

| Piece | Role |
|-------|------|
| `catalog` | SSOT path strings |
| `Route.make(site)` | Typed catalog from `catalog.*` |
| `Route.urlBuilder` + sugar | Positional href builders (`urls`) |
| `hyperlink-ts/ui/Router/waku` | Waku layer — `waku` / `Provider` / `Link` / `useRouter` |
| Site `ui/Router.tsx` | Skin: default binding + no-op Outlet |
| Chrome + API + search | In-app hrefs use `Router.Link` / `urls.*` |
| Nav + chapter links | `hrefFor` / `resolveBookHref` / `docs/nav.ts` via `urls` |
| `src/pages/` | Real match + RSC/SSG/SSR bodies |
