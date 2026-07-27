# Store cutover — Gate (adopt the transform-layer machinery)

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

Status: **done** on `cursor/store-extend-tier-refactor-a009`. The engine uses the Store transform
layer (`Store.effects` + `Store.catchWriteErrors` + `Store.provideContext`), tier-1 shape appends
(`fact.append` / `state.append` directly — no `recordRun*` writer methods), and tier-2 analytics on
`Gate.store(tag)`. Facts use PascalCase `_tag` rows (`Started` / `Completed` / `Failed`) with typed
`success` / `error` when the tag declares wire slots. `Hyperlink.builtHyperlink` backs `layer` / `serve` /
`serveRemote`. Queue (`WorkPool`) remains the reference for tier-2 narrow queue lifecycle writes.

Read first: `docs/guides/store.md`, `docs/guides/store-migration.md`, `docs/guides/queue-resource.md`.

## Completed

- **Transform layer** — `Store.catchWriteErrors(Store.effects(…, builtInGateStoreContract(tag)))`;
  `Store.provideContext` discharges `Storage` once at the gate boundary.
- **Direct append** — `makeObservedRun` builds fact rows and calls `fact.append` inline (Daemon golden pattern).
- **Two-tier store** — `builtInGateStoreContract` (tier 1: `fact` + `state` shapes),
  `makeGateStoreAnalyticsContract` (tier 2: analytics reads). `Gate.store(tag)` registers tier 2.
- **Typed full-capture** — tag `success` / `error` slots drive persisted `Completed.success` and
  `Failed.error` (presence-driven; untyped tags stringify failures via `extractRunFailure`).
- **Resource bundle** — `buildRunImpl` returns `Hyperlink.builtHyperlink`; `layer` uses `grantLocal`.

## State `reason` strings

State-transition `reason` values are PascalCase discriminants — same rule as fact `_tag`
(`Started`, `Waiting`, `WaitInterrupted`, …). Never kebab or dotted prefixes.

## Verify

`pnpm run typecheck` + gate / store suites.
