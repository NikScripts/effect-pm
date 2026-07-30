---
"hyperlink-ts": minor
---

Composable client cutover Policy (`hyperlink-ts/Policy`).

- Layer fragments: `Policy.sticky` / `unsticky`, `streamGap`, `coldAmbiguous`, `pick`
- Helpers: `Policy.provide(...)`, `Policy.layer(...)` (no stacked `Layer.provide`s)
- Defaults on for `lookupClient`: warm dual-serve sticky, stream gap `"stall"`, cold `"fail"`
- Live streams / `ref.changes` stay one outer Stream across dial swaps
- Not stamped on Node / Prototype / Lookup — compose at the dial edge
