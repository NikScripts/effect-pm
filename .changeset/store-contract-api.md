---
"@nikscripts/effect-pm": minor
---

**Add shape-first `Store` contract API.** New `@nikscripts/effect-pm/Store` surface: `Store.contract` /
`Store.shape` (part 1 shapes + optional part 2 custom methods), `Store.Service` / `Store.Tag` aggregates
with `at(tag)` lookup, standalone `Store.store`, `Resource.store` tag attachment, and built-in
`QueueResource.store` / `Process.store` facet registrations. Handles are fully typed (`store.<shape>.append` /
`.read`, flat aliases). Memory-backed `layerMemory` / `layer` included; durable SQLite adapter and
platform log facets remain future work (see `docs/handoffs/store-and-logs-design.md`).
