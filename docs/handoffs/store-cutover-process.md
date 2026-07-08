# Store cutover — Process (adopt the transform-layer machinery)

Status: the process store cutover **landed** on `cursor/process-store-cutover-a3ad` against the *earlier*
store API (a tap + `StoreScopeBridgeTag` + a hand-rolled `catchCause` around each write). The store
machinery has since evolved — the transform layer, three-tier stores, honest write typing, and typed
full-capture are all merged to integration. **This is the adoption handoff**: what changed and exactly how
to bring the process store onto the new machinery. The queue (`QueueResource`) is the worked reference.

Read first: `docs/guides/store.md` (the model), `docs/guides/store-migration.md` (tap → new, before/after),
`docs/guides/queue-resource.md` (the three-tier + analytics + typed-success reference).

## What changed in the store API
- `Store.withStorage` / `Store.withDefault` → **`Store.resolve` / `Store.resolveOrDie`** (aliases removed).
- The scope bridge is the co-located **`Store.Storage`** service, resolved by `resolveOrDie`.
- **Honest write typing:** `append` and any contract write method (`record`/…) now carry **`StoreWriteError`**
  in the error channel; reads carry `StoreJournalDecodeError`; an encode mismatch is a **defect** (`orDie`).
- **The transform layer:** `Store.mapEffects(effects, transform)` applies a transform to *every* store
  method; **`Store.catchWriteErrors`** = `mapEffects` + `catchTag(StoreWriteError)` — one guard for all
  writes (logs + swallows a journal/IO hiccup, leaves reads/defects untouched). It replaces a hand-rolled
  `catchCause` around each write. A custom write is transformed **exactly once** (the effects object
  delegates to the raw handle; the internal append is not re-wrapped).
- **Three-tier stores:** lean base (`record`/`events`) + engine write-extension (narrow typed writes) +
  consumer read-extension (analytics reads on the app-registered store).
- **Typed full-capture:** the tag's `success`/`error` schema slots drive the outcome. A declared `success`
  schema makes the worker return `Effect<A, …>` and `Completed.success: A` (the queue's worker-A pattern).

## Already done by the store-machinery merge (no action)
- `BuiltInProcessContract.record` **aligned to `Effect<void, StoreWriteError>`** (cast-free).
- `Store.withDefault` → `Store.resolveOrDie` in `processStoreTap.ts` + `process-store-default-override.test.ts`.

## Adoption steps (remaining)
1. **Convert the recorder to the transform layer.** `processStoreTap.ts` currently does
   `store.record(event).pipe(Effect.catchCause(→ logWarning))` in the forked drain. Replace the resolve +
   hand-rolled guard with the transform:
   ```ts
   const store = pipe(Store.effects(scopeKey, engineProcessContract(tag)), Store.catchWriteErrors);
   // drain loop: yield* store.record(event)   // already guarded — drop the per-write catchCause
   ```
   Provide `Storage` once at the boundary (baked-in default or app layer). Template: `buildQueueImpl` in
   `QueueResource.ts`.
2. **(Recommended) Three-tier.** Split the process contract into a lean base + an engine write-extension
   (narrow semantic writes — `recordCompleted`/`recordFailed`/`recordInterrupted` funneling to
   `event.append`), and expose a consumer read-extension (`Process.store(tag)`, analogous to
   `QueueResource.store`) with analytics reads over the event log.
3. **(Optional) Typed full-capture.** If a process's `success` should carry a real value, adopt the worker-A
   pattern (schema slot → return type). Today `RunCompleted.success` is populated when the tag stamps
   `success`; the queue shows the fully-typed version.

## StoreWriteError — don't over-worry it
Write-path only, `@internal` on the contract types, swallowed at every call site (the tap guard / the
transform). It never reaches a process handle, a public signature, or the wire (reads carry
`StoreJournalDecodeError`, not this). See `queue-resource.md`.

## Keep (still valid)
- PascalCase `_tag` rows (`RunStarted`/`RunCompleted`/`RunFailed`); presence-driven typed `error`.
- Baked-in default store: `Process.layer`/`serve`/`serveRemote` merge `layerDefaultMemory`; override at the
  app root with `Layer.provideMerge(AppStore.layerMemory)` or `AppStore.layer({ filename })`.

## Verify
`pnpm run typecheck` (both projects) + `pnpm exec vitest run` the process store + toolkit suites.
