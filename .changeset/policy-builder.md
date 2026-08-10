---
"hyperlink-ts": minor
---

Add `PolicyBuilder` — HttpApi-shaped constructable kernel for policy families
(`class X extends PolicyBuilder.make(id).key(…).keyEncoded(…)` → `make` / `layer` /
`provide` / `succeed`). Eng’d `Policy` exposes `Policy.Family` and keeps the flat
`Policy.make` / fragment API. Foundation for `NodePolicy` and the `Policy` →
`LookupPolicy` rename.
