---
"hyperlink-ts": minor
---

**Typed `Policy.Policy<{…}>`** — every fragment is a real Layer that stamps its
mode config at runtime (`Policy.config`, `Policy.isPolicy`). `Policy.layer` is
Effect-style `dual`: `.pipe(Policy.layer(other))` or `Policy.layer(a, b, c)` —
merges Layers and expands configs (last write wins). `Policy.make({ … })` is
object-form sugar for the same values. `Policy.provide` unchanged.
