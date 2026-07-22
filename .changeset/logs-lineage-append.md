---
"hyperlink-ts": patch
---

**Logs.withScope appends lineage (nested scopes combine).**

`withLogScope` now reads `CurrentLogAnnotations`, parses the lineage JSON array, and appends `tag.key` instead of replacing with a singleton. Nested scopes build a path; re-entering the same leaf key is idempotent. Still does not auto-inject a node root.
