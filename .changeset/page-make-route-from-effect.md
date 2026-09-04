---
"last-ts": minor
---

**Corrections:** `View.make` (not `View.Service`). Deleted unapproved `Page.asDefault`, Page introspection helpers (`modeOf` / `optionsOf` / `extract` / `paramBagsOf` / `configOf`), Route `fromEffect` / `staticFromEffect` / `mixedFromEffect` / `fromPage` / `*FromPages` merges, and any `getConfig` / `pageConfig` bridge. Dogfood uses plain Waku pages + HttpApi-shaped `Router.make` / `Route.get`. See `docs/handoffs/last-ts-api-corrections.md`.
