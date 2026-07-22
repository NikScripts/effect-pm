---
"hyperlink-ts": patch
---

**Node module split (Phase A tree-shake):** `listen`, `unix`, `httpServer`/`wsServer`, and `ipcServer` live in separate internal modules so a `Node.listen` import no longer retains the ipc/`unix` graph. `Node.Tag` stays on light `nodeCore`. Public API unchanged.
