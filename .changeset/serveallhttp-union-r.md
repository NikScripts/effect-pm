---
"hyperlink-ts": minor
---

**`serveAllHttp` unions each entry's requirement `R`** instead of pinning all entries to one. A host that serves queues/processes (worker `R`) next to `ApiMetrics.serverEntry` (`Scope`) and plain resources (`never`) no longer needs `as ServeEntry<never>` per entry — the result requirement is the union of the entries' requirements (like `Layer.mergeAll`). Bare `{ tag, impl }` literals (whose `R` is unconstrained) contribute nothing rather than poisoning the union.
