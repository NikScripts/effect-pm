---
"hyperlink-ts": minor
---

Ship a Group-aware Ink `Dashboard` on `hyperlink-ts/tui` that reuses the web data layer and path model. `Tui.open` now takes `{ tree, path }` (same Group the CLI was built from + member-key focus) so bare CLI paths match `<Dashboard group />` navigation.
