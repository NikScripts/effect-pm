# Agent K — page / Document

**Branch:** `cursor/agent-k-page-route-6d0e`  
**SSOT:** [`last-ts-api-corrections.md`](./last-ts-api-corrections.md) ·
[`page-document-lock.md`](./page-document-lock.md) ·
[`router-httpapi-lock.md`](./router-httpapi-lock.md)

## Done this branch

- Host façades (`last-ts/config`, `last-ts/server`); dogfood `createPages`; no app `waku` imports
- **Document Eng’d** — `Document.make` / `provide` / `transform` / `Page.document` / `Layout.Root`+`Outlet`
- Dogfood `_root` + `SiteDocument` shared cell; tests `test/document-chrome.test.ts`

## Still open (owner)

- Single combined provider teaching
- File-router full design/standards pass
- Layout provide-swap (beyond Root Reference)
- Legacy `docs/site` cutover off Waku fs-router
- Stronger type-level incomplete-`provide` errors
