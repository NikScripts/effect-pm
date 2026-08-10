# Agent K — page / Document

**Branch:** `cursor/agent-k-page-route-6d0e`  
**SSOT:** [`last-ts-api-corrections.md`](./last-ts-api-corrections.md) ·
[`router-httpapi-lock.md`](./router-httpapi-lock.md) ·
[`page-document-lock.md`](./page-document-lock.md)

### Before you Eng

1. (Re)read `docs/standards/` (incl. `no-waku-app-imports`).
2. List actions; wait for owner confirmation. This handoff is not a go.

## Done this branch

- Deleted `pageConfig` / dogfood `getConfig` / `asDefault` / Route bake merges
- `View.make` rename; host façades (`last-ts/config`, `last-ts/server`); dogfood `createPages`
- ESLint: apps never import `waku`; Cursor rules slimmed
- **Document design lock written** — [`page-document-lock.md`](./page-document-lock.md) (not Eng’d)

## Still open (owner)

- **Eng** Document / `Page.document` / `Layout.Root` from the lock (needs go)
- Single combined provider teaching
- File-router full design/standards pass
- Layout provide-swap (see also Document `Layout.Root`)
- Legacy `docs/site` cutover off Waku fs-router
