---
"hyperlink-ts": minor
---

Set-and-forget cutover: `Node.shutdown` (drain → Advice clear → Directory unregister → listen exit), `Node.launch` (races shutdown latch), and directory `peersLayer` hot-rebind on `Directory.changes` dial moves.
