---
"last-ts": minor
"hyperlink-ts": minor
---

**View statics bag:** Prototype-managed metadata on minted Tags lives under a single `.statics` field (any keys) instead of being flattened onto the class. App class statics stay free. `Views.bind` / `only` read `view.statics.size`. Migrate `Tag.size` / `Tag.spec` → `Tag.statics.size` / `Tag.statics.spec`.
