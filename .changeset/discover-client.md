---
"@nikscripts/effect-pm": minor
---

Rename **`Resource.clientLocal` → `Resource.discoverClient`** (no shim). Same sugar: `lookupClient` + `Lookup.bootstrapDefaultLocal`. Name avoids Effect “local” confusion.
