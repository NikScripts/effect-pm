---
"hyperlink-ts": minor
---

View chrome contributions are Layers on `View`: `View.kind` / `View.tag` (append) and `View.only` (per-kind allowlist), composed with `Layer.mergeAll` (last `only` wins). `View.react` still requires Layer `R = never`. Removed `bindKind` / `bindTag` / `requireView` and tag-pin match via `Hyperlink.components`.

WorkPool packaging: shared `hyperlink-ts/ui/WorkPoolView` handles + contribution Layer (no TSX); platform skins at `hyperlink-ts/web/WorkPoolView` and `hyperlink-ts/tui/WorkPoolView` (`Layer.succeed` + ready `layer` for `View.react`).

Existing web/TUI Dashboards mount that layer and route WorkPool queue card/detail through `View.Card` / `View.Detail` (parent keeps nav/logs/edit). WorkPool removed from default `forKind` `base` registries.
