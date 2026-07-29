---
"hyperlink-ts": minor
---

**Observe door:** Soft-deprecate `use*Bundle` and `View.compose(…).data` / `ui.data` in favor of `Bundle.observe` / `Bundle.node`. `Bundle.observe` calls the builders directly (canonical); aliases remain. One public stack for library Dashboard and apps; View Prototype `use` is not the observe path.
