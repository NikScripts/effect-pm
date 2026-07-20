---
"@nikscripts/effect-pm": minor
---

**Node module extract** — transport / catalog / connect APIs move to `@nikscripts/effect-pm/Node` (`import * as Node from "…/Node"`).

- **New:** `Node.Tag`, `Node.Prototype`, `Node.Lookup`, `Node.listen`, `Node.connect` / `connectHttp` / `connectSocket` / `connectIpc`, `Node.httpServer` / `wsServer` / `ipcServer`, `Node.clientsFor`, catalog types (`AnyNode`, `ProtocolKind`, `ListenNode`, …). Optional sugar: `Node.listenLocal`, `Resource.clientLocal`.
- **Removed (no shims):** `Resource.Node` / `Resource.Node.Prototype`, `Resource.listen` / `connect*` / `*Server` / `clientsFor`, `Lookup.LookupNode`. Call sites use `Node.*`.
- **Stays on Resource:** `Tag` / `serve` / `layer` / `client`, `lookupClient`, `identity`, `nodes` / `andNode` / `distributed`, peers / Spec builders.
- **Stays on Lookup:** `Identity`, `Directory`, `layer`, `client`, `bootstrapDefaultLocal`.
