---
"@nikscripts/effect-pm": minor
---

**Phase C — `Node.ws`:** local WebSocket listen with the same overload shapes as `Node.unix` / `Node.http` (Tag+impl / node+serves / nameless). Binds loopback (`ws://127.0.0.1`, including ephemeral `port: 0`), boots Lookup by default, and stamps `ListenNode` with the minted url. Neutral `Node.listen` no longer binds any transport — Ipc/Http/WebSocket all fail with `ListenUseProtocol`. Non-WebSocket nodes fail with `WsListenRequiresWs`. `wsServer` remains the custom-bind escape hatch.
