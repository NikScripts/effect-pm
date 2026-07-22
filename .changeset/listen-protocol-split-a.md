---
"hyperlink-ts": minor
---

**Phase A protocol split:** `Node.unix` owns all IpcSocket listen (mint/claim/bind). Neutral `Node.listen` no longer binds ipc — IpcSocket / nameless / address-less fail with `ListenUseProtocol` (use `unix`). Http/WebSocket `listen(node, serves)` still dispatch until `Node.http` / `Node.ws`. `Prototype.listen` → `unix`. Lookup is composed via pipe (see `lookup-pipe-only`).
