# Store cutover — RunResource (adopt the transform-layer machinery)

Status: **done** on `cursor/store-extend-tier-refactor-a009`. The engine uses the Store transform
layer (`Store.effects` + `Store.catchWriteErrors` + `Store.provideContext`), tier-1 shape appends
(`fact.append` / `state.append` directly — no `recordRun*` writer methods), and tier-2 analytics on
`RunResource.store(tag)`. Facts use PascalCase `_tag` rows (`Started` / `Completed` / `Failed`) with typed
`success` / `error` when the tag declares wire slots. `Resource.builtResource` backs `layer` / `serve` /
`serveRemote`. Queue (`QueueResource`) remains the reference for tier-2 narrow queue lifecycle writes.

Read first: `docs/guides/store.md`, `docs/guides/store-migration.md`, `docs/guides/queue-resource.md`.

## Completed

- **Transform layer** — `Store.catchWriteErrors(Store.effects(…, builtInRunResourceStoreContract(tag)))`;
  `Store.provideContext` discharges `Storage` once at the gate boundary.
- **Direct append** — `makeObservedRun` builds fact rows and calls `fact.append` inline (Process golden pattern).
- **Two-tier store** — `builtInRunResourceStoreContract` (tier 1: `fact` + `state` shapes),
  `makeRunResourceStoreAnalyticsContract` (tier 2: analytics reads). `RunResource.store(tag)` registers tier 2.
- **Typed full-capture** — tag `success` / `error` slots drive persisted `Completed.success` and
  `Failed.error` (presence-driven; untyped tags stringify failures via `extractRunFailure`).
- **Resource bundle** — `buildRunImpl` returns `Resource.builtResource`; `layer` uses `grantLocal`.

## State `reason` strings (unchanged)

State transitions still use kebab `reason` values (`run-resource.run.started`, …) on the **`state`**
shape — separate from fact `_tag` rows. Fact tags are PascalCase only.

## Verify

`pnpm run typecheck` + run-resource / store suites.
