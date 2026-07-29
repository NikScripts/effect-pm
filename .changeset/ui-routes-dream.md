---
"hyperlink-ts": minor
---

**UI Routes (HttpApi-shaped):** Public `hyperlink-ts/ui/Route` + `ui/Routes` — declare path templates with optional params schemas, nest via path-bearing `Routes.group`, compose with `Routes.make().add()`, reflect Hyperlink Groups with `Routes.fromGroup` (same builders), plus `match` / `urlBuilder` / `reflect`. Navigator cutover deferred.
