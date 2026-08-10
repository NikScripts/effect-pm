---
"hyperlink-ts": minor
---

Add `PolicyBuilder` — shared kernel for typed policy families (`define` / `key` /
`keyEncoded` → `make` / `layer` / `provide` / `succeed`). Refactor Eng’d `Policy` onto it
(public `Policy` API unchanged; brand via PolicyBuilder). Foundation for `NodePolicy` and
the `Policy` → `LookupPolicy` rename.
