---
"hyperlink-ts": minor
---

**Lookup placement advice (M5)** — coordinators publish prefer; `lookupClient` honors it.

- New `Lookup.Advice` RPCs: `advise` / `clear` / `preferred` (last-write-wins, in-memory).
- Helpers: `Lookup.advise` / `clearAdvice` / `preferred`.
- `Lookup.client` / `layer` / `layerOptions` provide `Identity | Directory | Advice` (`Lookup.Services`).
- `Resource.lookupClient`: when N>1 directory rows, a live preferred `nodeKey` wins before D4 `{ pick }`; stale prefer falls through.
- Form updated: `examples/forms/resource/node-identity-coordinator.ts` advises Worker B.
