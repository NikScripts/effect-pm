---
"hyperlink-ts": minor
---

**`Policy.make` / `Policy.merge`** — typed policy bundles. `Policy.make({ StreamGap:
"stall", Verify: "reject", … })` returns `Policy.Policy<{ … }>` which **is** a
`Layer.Layer<never>` (no wrapper). Pipe `Policy.merge({ … })` to swap or add modes
(config types merge; last write wins). Fragment values (`Policy.sticky`, …) and
`Policy.layer` / `Policy.provide` unchanged.
