---
"hyperlink-ts": minor
---

Remove deprecated UI observe doors: `hyperlink-ts/ui/Bundle` (`Bundle.observe` / `Bundle.node`), `use*Bundle` hooks, and `View.compose().data` / `ui.data`. Use `Observe.use(tag, *View.pack)` and `NodeView.use(ref)` instead.
