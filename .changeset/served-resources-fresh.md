---
"@nikscripts/effect-pm": patch
---

**Multi-`ipcServer` in one process** — each server uses `Layer.fresh` for `ServedResources`, `NodeSocketServer`, socket RPC protocol, and serialization so Lookup + Worker (address-less listen) no longer share MemoMap bindings (fixes cross-process dial ping timeouts).
