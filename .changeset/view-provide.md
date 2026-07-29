---
"hyperlink-ts": minor
---

Add `View.provide(Tag, impl)` (dual) and `Tag.provide(impl)` so View skins infer props from the Tag without `Tag["Service"]` annotations. Prefer over `Layer.succeed` for View chrome.
