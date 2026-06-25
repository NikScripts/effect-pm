---
"@nikscripts/effect-pm": minor
---

**Breaking — storage facet read/write API and stack cleanup.**

- Remove the `ProcessStoreBuilder` entry module. Author facets with
  `ProcessStore.Service`, `ProcessStore.record`, and `ProcessStore.read`
  (see `docs/STORAGE.md`).
- Facet classes expose **static emitters only** for writes. **No static read
  methods** on facet classes (`executions`, `load`, `facts`, etc.).
- Reads use `Effect.serviceOption(ProcessStoreX)` and `Option.match` with
  explicit `onNone` / `onSome: (store) => store.<read>(...)`. There is no
  `ProcessStore.withFacet` helper and no stub `missing` read API when the
  layer is absent.
- Add `ProcessStorage` (`@nikscripts/effect-pm/ProcessStorage`) to compose all
  built-in facet layers (memory and `layerProcessStore` / SQLite).
- Remove NDJSON/file process store (`ProcessStore.file`, `src/storage/file.ts`,
  `examples/forms/process-store/process-store-events-file-layer.ts`,
  `test/process-store.test.ts`).
- Remove legacy monolith composite (`src/internal/store/composite.ts`).
- Consolidate storage documentation into `docs/STORAGE.md` (removed scattered
  storage guide copies).
