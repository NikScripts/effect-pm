---
"last-ts": minor
---

`group.fromEffect` / `groupsFromEffect` always defer; item types stay on the catalog for UrlBuilder (including path-arg arity); bake `R` unions onto `Api` and `RouterBuilder.layer`. Materialize with `resolveApi` / layer (sync helpers only when `R = never`).
