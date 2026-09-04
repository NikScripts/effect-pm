---
"hyperlink-ts": patch
---

Fix Node HTTP/IPC serve: call `RpcGroup.toLayer` with the group as `this` (unbound extract dropped `toHandlers` and broke Lookup bind-or-dial).
