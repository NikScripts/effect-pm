---
"hyperlink-ts": patch
---

**NodeStatus — `status` is now a `ref` (`{ get, changes }`); logs are nested `{ live, history }`.** The reserved node resource drops `statusNow` and top-level `logHistory` in favor of the same shapes queue/process use: read node status via `status.get`, subscribe via `status.changes`; tail logs via `logs.live`, backfill via `logs.history`.
