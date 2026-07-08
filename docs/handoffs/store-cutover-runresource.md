# Store cutover — RunResource (adopt the transform-layer machinery)

Status: **done** on `cursor/run-resource-persistence-upgrade-a009`. The engine tap uses the Store transform
layer (`Store.effects` + `Store.catchWriteErrors`), tier-2 semantic writes, and tier-3 analytics on
`RunResource.store(tag)`. Facts use PascalCase `_tag` rows (`Started` / `Completed` / `Failed`) with typed
`success` / `error` when the tag declares wire slots. Queue (`QueueResource`) remains the reference template.

Read first: `docs/guides/store.md`, `docs/guides/store-migration.md`, `docs/guides/queue-resource.md`.

## What changed in the store API
Same as the process cutover — see `store-cutover-process.md` "What changed": `resolve`/`resolveOrDie` (was
`withStorage`/`withDefault`), the co-located `Store.Storage` service, `StoreWriteError` honest write typing
(reads = `StoreJournalDecodeError`, encode = defect), the `mapEffects`/`catchWriteErrors` transform layer
(one guard for all writes, a custom write transformed exactly once), three-tier stores, and the worker-A
typed-success pattern.

## Already done by the store-machinery merge (no action)
- `BuiltInRunResourceContract.record` **and** `.recordStateChange` aligned to `Effect<void, StoreWriteError>`.
  Run has **two** writes — `record` on the `fact` shape, `recordStateChange` on the `state` shape.
- `Store.withDefault` → `Store.resolveOrDie` wherever the run tap resolved it.

## Adoption steps (completed)
1. **Transform layer** — `runResourceStoreTap.ts` builds `Store.catchWriteErrors(Store.effects(…,
   engineRunResourceStoreContract(tag)))`; `buildRunImpl` pre-builds the tap with captured `Storage`
   (`provideRunResourceStoreEffects`), mirroring `buildQueueImpl`.
2. **Three-tier store** — `builtInRunResourceStoreContract` (tier 1), `engineRunResourceStoreContract`
   (tier 2: `started` / `completed` / `failed`), `makeRunResourceStoreAnalyticsContract` (tier 3:
   `completed`, `failed`, `recent`, `history`, `lastFailure`, `stats`, `failureRate`, `meanDurationMs`,
   `factChanges`, `stateChanges`). `RunResource.store(tag)` registers tier 3.
3. **Typed full-capture** — tag `success` / `error` slots drive persisted `Completed.success` and
   `Failed.error` (presence-driven; untyped tags stringify failures via `extractRunFailure`).

## Slim-down options (if tier 3 is too much)
- Revert `RunResource.store` to tier-1 `builtInRunResourceStoreContract` only (drop analytics reads).
- Keep tier 2 + transform layer only (minimum from the handoff).
- Inline tap build inside `makeRunResourceStoreTap` only (drop `buildRunImpl` pre-build).

## StoreWriteError — don't over-worry it
Write-path only, `@internal` on the contract types, swallowed at every call site (the tap guard / the
transform), never on a run handle / public signature / the wire. See `queue-resource.md`.

## Keep (still valid)
- PascalCase `_tag` rows (`Started` / `Completed` / `Failed`), retiring kebab `type` strings.
- Presence-driven typed `error` on `RunFailed` facts (replacing `cause: string` / `Cause.pretty`).
- Baked-in default store on `RunResource.layer`/`serve`/`Service.layer`; override with
  `Layer.provideMerge(AppStore.layerMemory)`.

## Verify
`pnpm run typecheck` (both projects) + the run-resource + run-resource store suites.
