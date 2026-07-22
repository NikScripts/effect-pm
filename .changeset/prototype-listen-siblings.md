---
"hyperlink-ts": minor
---

**`Prototype.listen` matches protocol listen siblings:** dispatch to `unix` / `http` / `ws` / `nPipe` (`Prototype(..., { ipc: "nPipe" })`); Lookup stays pipe-only (`Lookup.layer` / `layerOptions`), not baked in — same story as those listens.
