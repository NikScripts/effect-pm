---
"hyperlink-ts": minor
---

**Dashboard Layers:** remove `DashboardLayer` and platform `web|tui/DashboardViews` subpaths. One `ui/DashboardViews` (contributions); platform TSX + ready `layer` live on `web|tui/Dashboard` (`componentsLayer` / `layer`). Compose — `Layer.mergeAll(DashboardViews.layer, appViews).pipe(Layer.provideMerge(componentsLayer), Layer.provideMerge(View.base))`.

**Page marks:** add `hyperlink-ts/ui/Page` — `Page.static` / `.dynamic` / `.build` / `.layout` (path-keyed stamps for the file router; `Page.Tag` later).

**File router:** `Route.fileRoot` / `Route.fileSystem` / `Router.fileSystem` over a typed path table; Vite plugin `hyperlink-ts/vite` (`fileRouter`) + `hyp file-router emit|check` for invisible `paths.gen.ts` codegen/watch.
