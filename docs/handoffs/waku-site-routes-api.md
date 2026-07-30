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

## Use (parity with pre-router site)

Typed hrefs only — **native `<a href={urls…}>`** and `location.assign(urls…)` for
navigation. Same DOM / full-document nav as before the client Router skin.
No `RouterProvider` around book chrome (avoids a full-tree client boundary).

```tsx
<a href={urls.home()}>Home</a>
<a href={urls.docs("work-pools")}>Work pools</a>
<a href={urls.api.symbol("effect", "Effect.succeed")}>Effect.succeed</a>

window.location.assign(urls.search({ query: { q: "WorkPool" } }))
```

`docs/site/src/ui/Router.tsx` (aliased as `hyperlink-ts/ui/Router`) remains for
typed tests / optional app-style composition — **not** wired into page chrome.

## Layers

| Piece | Role |
|-------|------|
| `catalog` | SSOT path strings |
| `Route.make(site)` | Typed catalog from `catalog.*` |
| `Route.urlBuilder` + sugar | Positional href builders (`urls`) |
| Chrome + API + search | Native anchors / `location.assign` with `urls.*` (not raw `/api/…` strings) |
| Nav + chapter links | `hrefFor` / `resolveBookHref` / `docs/nav.ts` hrefs go through `urls` |
| `src/pages/` | Real match + RSC/SSG/SSR bodies |
| Optional `Router.tsx` | Vision API skin (tests); unused by site chrome for appearance/perf parity |
