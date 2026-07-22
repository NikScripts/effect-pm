---
"hyperlink-ts": minor
---

**Resource.nodes / andNode (C1)** — one Node set on the Tag handle.

- `Resource.nodes([...])` overwrites; `Resource.andNode(node)` appends one.
- Set size 1 syncs `nodeSym` so `client(Tag)` works; size ≠ 1 clears it.
- `{ node: X }` on the Tag ctor stamps set-of-one (`nodes` + `nodeSym`).
- `distributed` / `distributedOf` are aliases of `nodes` / `nodesOf`.
- Identity Tags still refuse multi-node sets (`IdentityMultiNode`).
