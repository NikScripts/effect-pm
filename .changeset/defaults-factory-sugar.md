---
"hyperlink-ts": minor
---

Tag factories accept optional `{ defaults }` (Hyperlink / WorkPool / Gate / Daemon) — typed sugar for `.pipe(Hyperlink.defaults(…))`. Toolkit Tags apply the bag after named-handle remap so `WorkPool` / `Gate` keys stay on `Service`.
