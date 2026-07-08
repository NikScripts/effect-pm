# Store cutover — RunResource (adopt the transform-layer machinery)

Status: the run-resource store cutover **landed** on `cursor/run-resource-persistence-upgrade-a009` against
the *earlier* store API (a tap + `StoreScopeBridgeTag` + a `recordWrite`/`catchErrorAndLog` guard). The
store machinery has since evolved — the transform layer, three-tier stores, honest write typing, and typed
full-capture are all merged to integration. **This is the adoption handoff.** The queue (`QueueResource`)
is the worked reference.

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

## Adoption steps (remaining)
1. **Convert the recorder to the transform layer.** `runResourceStoreTap.ts` routes every write through a
   `recordWrite` helper (`catchErrorAndLog`). Replace with the transform:
   ```ts
   const store = pipe(Store.effects(scopeKey, engineRunContract(tag)), Store.catchWriteErrors);
   // yield* store.record(fact)   /   yield* store.recordStateChange(change)   // both guarded by the transform
   ```
   `catchWriteErrors` guards **both** write shapes uniformly (each carries `StoreWriteError`) — no need for
   a per-write helper. Provide `Storage` once at the boundary. Template: `buildQueueImpl` in `QueueResource.ts`.
2. **(Recommended) Three-tier — stack with `Store.extend`, not a `Store.contract` rebuild.** Build the lean
   base once with `Store.contract`, then `Store.extend(methodsFn, base)` it into an engine write-extension
   (narrow writes over `fact`/`state`) and, again over the same base, a consumer read-extension
   (`RunResource.store(tag)` with analytics over facts + state history), mirroring `QueueResource.store`.
   `Store.extend` is type-preserving (fed the `base`, each write/read keeps its concrete signature onto
   `Store.effects`) — do **not** rebuild the base with `Store.contract` per tier. Template: `queueStoreSpec.ts`.
3. **Discharge the impl requirement with `Resource.provideContext`, not per-method provides.** Build the run
   impl **unwrapped** (each method still carrying the worker `R`), then discharge it in one call:
   `Resource.provideContext(impl, tag[Resource.specSym], context)` (from `yield* Effect.context<R>()`). It's
   the Resource mirror of `Store.catchWriteErrors` — a subtractive one-liner over `Resource.mapEffects`
   (`R` → `Exclude<R, Ctx>`, a no-op where there's no `R`, Stream / Subscribable members untouched) — no
   per-method `Effect.provideContext(...)` wrapping. Template: `buildQueueImpl` in `QueueResource.ts`.
4. **(Optional) Typed full-capture** — adopt the tag's `success`/`error` schema slots (worker-A pattern) if a
   run should carry a typed result.

## StoreWriteError — don't over-worry it
Write-path only, `@internal` on the contract types, swallowed at every call site (the tap guard / the
transform), never on a run handle / public signature / the wire. See `queue-resource.md`.

## Keep (still valid)
- PascalCase `_tag` rows (`RunStarted`/`RunCompleted`/`RunFailed`), retiring kebab `type` strings.
- Presence-driven typed `error` on `RunFailed` facts (replacing `cause: string` / `Cause.pretty`).
- Baked-in default store on `RunResource.layer`/`serve`/`Service.layer`; override with
  `Layer.provideMerge(AppStore.layerMemory)`.

## Verify
`pnpm run typecheck` (both projects) + the run-resource + run-resource store suites.
