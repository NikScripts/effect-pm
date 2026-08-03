---
"last-ts": minor
"hyperlink-ts": minor
---

**View annotations:** Prototype-managed metadata on minted Tags lives under `.annotations` (Effect/ZIO-style bag, any keys) — not flattened onto the class. The type helper is `View.AnnotationsOf` (renamed from `StaticsOf`). `Views.bind` / `only` read `view.annotations.size`. Migrate `Tag.size` / `Tag.spec` / `Tag.statics.*` → `Tag.annotations.*`.
