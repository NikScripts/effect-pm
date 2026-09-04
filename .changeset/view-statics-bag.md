---
"last-ts": minor
"hyperlink-ts": minor
---

**View annotations:** Prototype-managed metadata on minted Tags lives under `.annotations` (Effect/ZIO-style bag, any keys) — not flattened onto the class. Getter: `View.annotations(tag)` (same role as `Group.members`); type helper `View.AnnotationsOf` (was `StaticsOf`). `Views.bind` / `only` use `View.annotations(view).size`. Migrate `Tag.size` / `Tag.spec` / `Tag.statics.*` → `View.annotations(Tag).*`.
