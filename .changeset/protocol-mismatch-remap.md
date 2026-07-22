---
"hyperlink-ts": minor
---

**`ProtocolMismatch` on wrong-transport RPC:** `Resource.client` remaps Effect's http "empty HTTP response" / incomplete-response `RpcClientDefect` (classic http client → WebSocket server) to a tagged `ProtocolMismatch` with remediation. Blessed `Node.connect` path still designs the mismatch out; this makes the escape-hatch failure catchable by `_tag`.
