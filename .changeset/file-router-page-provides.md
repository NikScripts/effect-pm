---
"hyperlink-ts": minor
---

**Dashboard Layers:** drop `DashboardLayer.forCompose` / `.provide` / `skins` / `provides`. Platform TSX is `componentsLayer`; compose with ordinary Effect — `Layer.mergeAll(DashboardLayer.layer, appViews).pipe(Layer.provideMerge(platform.componentsLayer), Layer.provideMerge(View.base))`.

**Page marks:** add `hyperlink-ts/ui/Page` — `Page.static` / `.dynamic` / `.build` / `.layout` (path-keyed stamps for the file router; `Page.Tag` later).

**File router:** `Route.fileRoot` / `Route.fileSystem` / `Router.fileSystem` over a typed path table; Vite plugin `hyperlink-ts/vite` (`fileRouter`) + `hyp file-router emit|check` for invisible `paths.gen.ts` codegen/watch.
