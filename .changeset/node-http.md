---
"hyperlink-ts": minor
---

**Phase B — `Node.http`:** local Http listen with the same overload shapes as `Node.unix` (Tag+impl / node+serves / nameless). Binds loopback (`127.0.0.1`, including ephemeral `port: 0`), boots Lookup by default, and stamps `ListenNode` with the minted url. Neutral `Node.listen` rejects Http (`ListenUseProtocol` → use `http`). Non-Http nodes fail with `HttpListenRequiresHttp`. `httpServer` remains the custom-bind escape hatch.
