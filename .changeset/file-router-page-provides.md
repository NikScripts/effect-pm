---
"hyperlink-ts": minor
---

**Dashboard Layers:** rename `skins` → `provides`; replace `DashboardLayer.forCompose({ skins, views })` with pipe — `Layer.mergeAll(DashboardLayer.layer, appViews).pipe(DashboardLayer.provide(platform.provides))`.

**Page marks:** add `hyperlink-ts/ui/Page` — `Page.static` / `.dynamic` / `.build` / `.layout` (path-keyed stamps for the file router; `Page.Tag` later).

**File router:** `Route.fileRoot` / `Route.fileSystem` / `Router.fileSystem` over a typed path table; Vite plugin `hyperlink-ts/vite` (`fileRouter`) + `hyp file-router emit|check` for invisible `paths.gen.ts` codegen/watch.
