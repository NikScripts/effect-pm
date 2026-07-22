---
"hyperlink-ts": minor
---

**Add shape-first `Store` contract API with EventJournal-backed persistence.** New `@nikscripts/effect-pm/Store` surface:
`Store.contract` / `Store.shape` (part 1 shapes + optional part 2 custom methods), `Store.Service` /
`Store.Tag` aggregates with `at(tag)` lookup, standalone `Store.store`, `Resource.store` tag attachment,
and built-in `QueueResource.store` / `Process.store` facet registrations. Handles are fully typed
(`store.<shape>.append` / `.read`, flat aliases). `layerMemory` uses `EventJournal.layerMemory`;
`layer({ filename })` persists via `SqliteClient` + `SqlEventJournal` (`:memory:` or file).
`Store.changes` streams append events; `Store.retention(maxRows)` trims oldest rows per scope.
See `docs/guides/store-backing.md`. Platform log facets remain future work (see `docs/handoffs/store-and-logs-design.md`).
