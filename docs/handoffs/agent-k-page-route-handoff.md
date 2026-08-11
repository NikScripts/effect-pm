# Agent K — page / Document

**Branch:** `cursor/agent-k-page-route-6d0e`  
**Spine:** [`last-ts-spine.md`](./last-ts-spine.md)  
**SSOT:** [`last-ts-api-corrections.md`](./last-ts-api-corrections.md) ·
[`page-document-lock.md`](./page-document-lock.md) ·
[`page-layout-lock.md`](./page-layout-lock.md) ·
[`page-mint-lock.md`](./page-mint-lock.md) ·
[`file-router-lock.md`](./file-router-lock.md) ·
[`last-provider-lock.md`](./last-provider-lock.md) ·
[`router-httpapi-lock.md`](./router-httpapi-lock.md)

## Done this branch

- Host façades (`last-ts/config`, `last-ts/server`); no app `waku` imports
- **Document Eng’d** — `Document.make` / `provide` / `transform` / `Page.document`; incomplete provide ⇒ type error
- **Layout Eng’d** — `RootLayout` / `Layout.make` / `provide` / `Outlet`
- **Page mint Eng’d** — `Page.make` / `Page.static` + `Route.static` (path from file only)
- **`Server.fromPage(path, mint)`** — bake mode + Waku flat → soft-nav props
- **File-router lock** — path-only table; `(group)` strip; CI check on dogfood gens
- **Last.provider lock** — one Layer bake
- **Spine acceptance demo** — [`examples/last/spine`](../../examples/last/spine/) (package bar)
- Last site + Hyperlink `docs/site` host cutover exist on branch but are **provisional** until the demo bar is the teaching SSOT

## Sequence (owner)

1. Prove / polish **spine demo**
2. Align Last site to the demo
3. Then Hyperlink

## Parked (not this arc)

- View.make redesign
- Multi-group layout inheritance beyond per-group `Layout.provide`
- Catalog-level layout annotation (rejected)
- React write hooks / `<Title>` (rejected for v1)
