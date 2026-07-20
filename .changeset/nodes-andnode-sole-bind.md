---
"@nikscripts/effect-pm": patch
---

**`nodes([X])` / `andNode(X)` sole-bind typing** — a size-1 addressed tuple (or `andNode` from an empty set) narrows like `{ node: X }`, so `Resource.client(Tag)` is fully wired. Append onto a populated set does not claim a fresh sole bind.
