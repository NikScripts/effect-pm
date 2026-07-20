---
"@nikscripts/effect-pm": minor
---

**D3** — directory-backed peers + bare `Resource.distributed`.

- Bare `.pipe(Resource.distributed)` ≡ `nodes([])` (discoverable empty membership; identity-shaped pipe).
- Fixed fleets use `Resource.nodes([…])` — `distributed([…])` list form removed (call sites migrated).
- `peersLayer` with a stamped empty Node set reads Lookup `Directory.nodesServing(tag.key)` at build; dials peers by entry kind (ipc `path` / url).
- Undeclared tags stay empty static peers; Directory absent → soft empty peer map.
- IpcSocket peers in a fixed set dial via `path` when no url is set.
