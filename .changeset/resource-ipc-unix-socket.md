---
"@nikscripts/effect-pm": minor
---

**IPC / Unix-domain RPC** — first-class same-machine transport.

- New `ProtocolKind` `"ipc"` (WebSocket stays `"socket"`).
- `Resource.Node("key", { path })` infers `kind: "ipc"`.
- `Resource.ipcServer(serves, { path })` — Effect socket RPC over a filesystem path (auto-unlink stale sock by default).
- `Resource.connect` / `connectIpc` / `protocolIpc` / `ipcClient` for clients.

No catalog/`ROut` or discovery yet — those are the next bake-session locks.
