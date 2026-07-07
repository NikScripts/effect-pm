---
"@nikscripts/effect-pm": minor
---

**Promote `Store.Storage` and `Store.layerDefaultMemory` to the public API.**

Third-party and custom toolkit engines can declare `Store.Storage` as a dependency and resolve
handles via `Store.withDefault` / `Store.withStorage`. `Store.StorageApi` is public for typing
custom bridges. Replaces the retired internal `StoreScopeBridgeTag` name.
