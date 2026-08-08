---
"last-ts": minor
---

`Page.make` / `Page.static` — HttpApi-shaped page classes (optional request options first). `Page.asDefault` bridges Waku’s function default export while keeping the class brand (`Page.extract`); adapts flat host props into `Page.Props`. `Page.configOf` / `Page.paramBagsOf` + `last-ts/vite` `pageConfig()` inject Waku `getConfig` / `staticPaths` from Literals (apps never write engine config). `Route.fromPage` / `Router.destinationsFromPages` / `Route.fileRootFromPages` / `pagesByIdFromModules` merge page classes into the catalog; `Route.WithParamBags` / `~ParamBags` drives UrlBuilder bag-union args. `Route.fromEffect` / `staticFromEffect` / `mixedFromEffect` lift literal param bags (get stays dynamic by default; staticFromEffect / mixed static set opts into SSG). `fileRouter` Vite plugin emits via `runPromise` (Node FS is async). Docs surface: `docs/last/site` (`pnpm run docs:last-site`) — catalog from `paths.gen` + fileRootFromPages, rest `[...path]` dogfood.
