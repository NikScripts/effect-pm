---
"@nikscripts/effect-pm": minor
---

**ProtocolKind tags** — clearer transport names on Nodes.

- `"http"` → `"Http"`
- `"socket"` → `"WebSocket"`
- `"ipc"` → `"IpcSocket"`

Inference from `url` / `path` unchanged. Multi-protocol Nodes (multiple endpoints per Node) not in this change.
