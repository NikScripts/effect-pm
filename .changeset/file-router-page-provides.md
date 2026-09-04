---
"hyperlink-ts": minor
---

**Dashboard Layers:** remove `DashboardLayer` and platform `web|tui/DashboardViews` subpaths. One `ui/DashboardViews` (contributions); platform `import * as Dashboard from "hyperlink-ts/web|tui/Dashboard"` exposes `componentsLayer` / `layer` (Effect naming). Compose — `Layer.mergeAll(DashboardViews.layer, appViews).pipe(Layer.provideMerge(Dashboard.componentsLayer), Layer.provideMerge(View.base))`.

**Page marks:** add `hyperlink-ts/ui/Page` — `Page.static` / `.dynamic` / `.build` / `.layout` (path-keyed stamps for the file router; `Page.Service` later).

**File router:** `Route.fileRoot` / `Route.fileSystem` / `Router.fileSystem` over a typed path table; Vite plugin `hyperlink-ts/vite` (`fileRouter`) + `hyp file-router emit|check` for invisible `paths.gen.ts` codegen/watch.
