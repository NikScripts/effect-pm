---
"hyperlink-ts": major
---

Demote shared-Spec family APIs to `@internal` until the kind-keyed factory (W3): `tagFor`, `serveInstances`, `clientInstances`, `instance`, `TagFactory`, `NodeTagFactory`, `HyperlinkInstance`, `DuplicateInstance`, `InstanceRoutingError`. Removed from the root barrel; prefer solo `Hyperlink.Tag` (wire key = `.key`). Still importable from `hyperlink-ts/Hyperlink` for package tests.
