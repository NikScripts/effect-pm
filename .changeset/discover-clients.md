---
"@nikscripts/effect-pm": minor
---

**`Resource.discoverClients`** — multi-tag sugar over `discoverClient`: one Lookup bootstrap, then `Layer.mergeAll` of each `lookupClient`.

```ts
Resource.discoverClients([Jobs, Emails], { lookupPath })
Resource.discoverClients(Jobs, Emails) // Lookup defaults; options on array form
```
