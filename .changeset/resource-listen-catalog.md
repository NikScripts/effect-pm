---
"@nikscripts/effect-pm": minor
---

**Node catalog + `listen` (C2–C4)** — typed `ROut`, prove at listen, keep `*Server`.

- `Resource.Node<Self, ROut>()` — optional catalog type param (`import type` for handles).
- `Resource.listen(node, [serve…])` — requires full `ROut` (C3), then `ipcServer` / `wsServer` / `httpServer`.
- `Resource.clientsFor(node, …tags)` — client layers for the catalog with one bundled `connect`.
- Http/WebSocket bind still caller-provided (`NodeHttpServer.layer`); ipc uses `node.path`.
