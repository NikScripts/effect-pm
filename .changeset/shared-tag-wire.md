---
"hyperlink-ts": minor
---

Shared-Spec tags: `Hyperlink.Service(wireKey, spec)` returns a factory; mint with `Factory<Self>()(instanceKey)`. One RpcGroup (prefix = wire key); `serve` / `client` route by header `key`. Errors: `DuplicateSharedInstance`, `SharedRoutingError`. No `*Family*` APIs. ApiMetrics unchanged.
