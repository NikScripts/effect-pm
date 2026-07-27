---
"hyperlink-ts": minor
---

View chrome contributions are Layers on `View`: `View.kind` / `View.tag` (append) and `View.only` (per-kind allowlist), composed with `Layer.mergeAll` (last `only` wins). `View.react` still requires Layer `R = never`. Removed `bindKind` / `bindTag` / `requireView` and tag-pin match via `Hyperlink.components`.

Dashboard Views packaging: shared `hyperlink-ts/ui/*View` handles + `ui/DashboardViews` merge; platform skins at `hyperlink-ts/web/DashboardViews` and `hyperlink-ts/tui/DashboardViews` (and per-family `WorkPoolView` kept). Existing Dashboards mount the composite layer and route card/detail through `View.Card` / `View.Detail` (parent keeps nav/logs/edit). Default `forKind` `base` registries are fallback-only.
