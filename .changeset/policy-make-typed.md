---
"hyperlink-ts": minor
---

**`Policy.Policy<{…}>` typing** — every fragment (`sticky`, `streamGap(…)`,
`verifyOff`, …) is already a branded `Layer.Layer<never>` carrying its modes.
`Policy.layer(…)` merges Layers and expands the config type (last write wins).
`Policy.make({ … })` is object-form sugar for the same `Policy.Policy` values.
`Policy.provide` unchanged.
