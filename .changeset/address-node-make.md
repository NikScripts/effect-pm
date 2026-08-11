---
"hyperlink-ts": minor
---

Add `hyperlink-ts/Address` factories (`http` / `ws` / `unix` / `unixFromKey`) and
HttpApi-shaped `Node.make(key, Address | Address[], opts?)` (addresses optional).
Prefer a public `class X extends Node.make(…)` then
`class Private extends X.pipe(Address.unix({ A, B }), …)` for private dials —
never a second `make` with the same key. Address lists accumulate (unlabeled ≠
primary; primary set is `NodePolicy.primaryAddress`). Same concrete dial twice →
`Address.DialOverlap`.
