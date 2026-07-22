---
"hyperlink-ts": minor
---

Rename **`Resource.clientLocal` → `Resource.discoverClient`** (no shim). Same sugar: `lookupClient` + `Lookup.layerOptions`. Name avoids Effect “local” confusion.
