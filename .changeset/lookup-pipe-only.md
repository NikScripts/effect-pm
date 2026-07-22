---
"hyperlink-ts": minor
---

**Lookup is pipe-only on listen:** `Node.unix` / `http` / `ws` / `nPipe` no longer accept `lookupPath`, `unlinkLookup`, or `bootstrapLookup`. Compose with `.pipe(Layer.provide(Lookup.layerOptions({ path, unlink })))` (or `Lookup.layer` / `Lookup.client`) when claim / advertise needs a directory.
