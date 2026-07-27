---
"hyperlink-ts": minor
---

View chrome contributions are Layers on `View`: `View.kind` / `View.tag` (append) and `View.only` (per-kind allowlist), composed with `Layer.mergeAll` (last `only` wins). `View.react` still requires Layer `R = never`. Removed `bindKind` / `bindTag` / `requireView` and tag-pin match via `Hyperlink.components`.
