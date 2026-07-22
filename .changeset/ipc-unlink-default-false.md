---
"@nikscripts/effect-pm": minor
---

**IPC path hygiene default matches Lookup** — `Node.ipcServer` / unix IPC listen no longer unlink the sock by default.

Default is now `unlink: false` (same as `Lookup.layerOptions` and named-pipe listen) so a second process cannot unlink-steal a live peer's socket. Pass `unlink: true` when you intentionally want stale-sock recovery before bind and on scope close.
