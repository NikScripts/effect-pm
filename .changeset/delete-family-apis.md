---
"hyperlink-ts": major
---

Remove the unused shared-Spec family path: `tagFor`, `serveInstances`, `clientInstances`, `instance`, `TagFactory`, `NodeTagFactory`, `HyperlinkInstance`, `DuplicateInstance`, `InstanceRoutingError`. Callers migrate to solo `Hyperlink.Service` (wire key = `.key`). A kind-keyed family factory may return later as a new API (W3), not a revival of these names.
