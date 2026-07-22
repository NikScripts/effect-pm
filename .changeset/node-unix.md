---
"hyperlink-ts": minor
---

**`Node.unix`** — same call shapes as `Node.listen`, with Unix-domain IPC + default Lookup built in. **`Node.listen` does not bake protocol/Lookup** (nameless still mints ipc but Lookup stays in `R`). Non-IPC Nodes fail `UnixListenRequiresIpc`. `listenLocal` → `unix(node, serves)`.
