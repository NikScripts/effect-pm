# Docs site — vision Router on Waku

**One API.** Same shape as `hyperlink-ts/ui/Router`. Waku is the engine (SSG/SSR/RSC soft-nav). File routes in `src/pages/` still own page bodies.

## API (what you write)

```tsx
import * as Route from "hyperlink-ts/ui/Route"
import * as Router from "hyperlink-ts/ui/Router"  // aliased → docs/site/src/ui/Router.tsx
import { site } from "./lib/siteRoutes"

const router = Router.make(site)

<Router.Provider value={router}>
  <Router.Link to={(u) => u.docs({ params: { chapter: "work-pools" }})}>
    Work pools
  </Router.Link>
  <Router.Link
    to={(u) =>
      u.apiSymbol({
        params: { pkg: "effect", module: "Effect", symbol: "succeed" },
      })
    }
  >
    Effect.succeed
  </Router.Link>
</Router.Provider>

const r = Router.useRouter()
void r.to((u) => u.releases())
r.pathname
r.match
```

Catalog SSOT: `docs/site/src/lib/siteRoutes.ts` (`Route.make` — static + dynamic).

## Mapping

| Vision | Docs site |
|--------|-----------|
| `Route.make` / `urlBuilder` | `site` / `urls` |
| `Router.make` / `Provider` | catalog bind (`mode: "waku"`) |
| `Router.Link` / `to` / `go` | Waku `Link` / `push` / `replace` |
| `Router.Outlet` | **no-op** — bodies are Waku `src/pages/` (keeps Twoslash SSG) |
| `Router.memory` / `history` | N/A here (apps still use package Router) |

## Wiring

- Alias: `hyperlink-ts/ui/Router` → `src/ui/Router.tsx` (`waku.config.ts` + `tsconfig`)
- Book layout: `RouterProvider` island
- Sidebar: `GroupedNav` uses `Router.Link`
