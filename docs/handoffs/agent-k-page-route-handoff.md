# Agent K — corrections pass

**Branch:** `cursor/agent-k-page-route-6d0e`  
**SSOT:** [`last-ts-api-corrections.md`](./last-ts-api-corrections.md) ·
[`router-httpapi-lock.md`](./router-httpapi-lock.md)

### Before you Eng

1. (Re)read `docs/standards/` (including `no-waku-getconfig`).
2. List actions; wait for owner confirmation. This handoff is not a go.

## Done this branch

- Deleted `pageConfig`, all `getConfig` on dogfood pages
- Deleted `Page.asDefault` + Page introspection helpers
- Deleted Route `fromEffect*` / `fromPage` / `*FromPages` catalog merges
- Renamed `View.Service` → `View.make`
- Dogfood: plain Waku pages + `Router.make` / `Route.get`
- Documented bans in standards + corrections lock

## Still open (owner)

- Page title / document product API (beyond `Page.Document` lean)
- Combined single-provider teaching (don’t invent)
- File-router full design/standards pass
- Layout provide-swap lean (design only)
