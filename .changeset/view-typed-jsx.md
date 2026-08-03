---
"last-ts": minor
---

**Views — bag compose + mount:** Open-`R` views are `Unresolved` (not JSX-legal). Compose with `View.succeed({ Child }, ({ Child }) => …)` / `View.gen({ Child }, function* ({ Child }) { … })` so names stay and `R` merges; discharge at the edge with `View.mount(view, layer)` → JSX `Component`. `View.gen` / `succeed` unary forms unchanged. JSX syntax still does not carry `R` by itself.
