---
"hyperlink-ts": minor
---

Remove the public `Xor` runtime-record predicate from the `Query` DSL.

`RuntimeRecordPredicate` now supports comparisons plus `And` / `Or` composition only, keeping future storage adapters aligned with common database predicate primitives.
