---
"hyperlink-ts": minor
---

**`Policy.make`** — typed policy bundle. `Policy.make({ StreamGap: "stall", Verify:
"reject", … })` returns `Policy.Policy<{ … }>` which **is** a `Layer.Layer<never>`
(no wrapper). Compose with fragment Layers via `Policy.provide` / `Policy.layer`
(last write wins) — same pipe as `Policy.sticky` / `Policy.streamGap(…)`.
