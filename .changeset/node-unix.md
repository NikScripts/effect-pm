---
"@nikscripts/effect-pm": minor
---

**`Node.unix`** — same call shapes as `Node.listen` (Tag+impl, node+serves, nameless serve list), but Unix-domain IPC only with default Lookup bootstrapped. Non-IPC Nodes fail `UnixListenRequiresIpc`. `listenLocal` is now a thin alias of `unix(node, serves)`.
