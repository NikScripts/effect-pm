---
"last-ts": minor
---

`Page.make` / `Page.static` — HttpApi-shaped page classes (optional request options first). `Page.asDefault` bridges Waku’s function default export while keeping the class brand (`Page.extract`); adapts flat host props into `Page.Props`. `Page.configOf` / `Page.paramBagsOf` + `last-ts/vite` `pageConfig()` inject Waku `getConfig` / `staticPaths` from Literals (apps never write engine config). `Route.fromPage` merges a page class into the catalog; `Route.fromEffect` / `Route.staticFromEffect` lift literal param bags (get stays dynamic by default; staticFromEffect opts into SSG). Shared `RequestOptions` bag with `Route.get`. Docs surface: `docs/last/site`.
