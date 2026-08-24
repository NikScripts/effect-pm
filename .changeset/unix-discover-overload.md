---
"hyperlink-ts": minor
---

`Hyperlink.unix(tag)` now Lookup-discovers and dials (nameless sibling of `Node.unix([serve…])`). Path dial remains `Hyperlink.unix(node)`. Removed `Hyperlink.discoverClient` — use `unix(tag)`; `discoverClients` unchanged.
