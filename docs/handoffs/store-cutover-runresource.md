# Store cutover — RunResource

Prereq: `store-cutover-00-store-core.md` (**the store is a defaulted service; resolve it as a declared
dependency; NEVER `serviceOption`**).

## ✅ Done (run-resource branch)

- Declared dependency: `yield* StoreScopeBridgeTag` once at tap build; **Store bridge only** — no `RunResourceStore` facet writes.
- Cast-free contract in `runResourceStoreSpec.ts` (mirrors queue).
- Handle cast removed from tap.
- `ProcessStore.catchErrorAndLog` → `catchErrorAndLog` from `internal/store/helpers`.
- Public `Store.layerDefaultMemory`; **`RunResource.layer` / `serve` / `Service.layer` merge it automatically**; override with `Layer.provideMerge(AppStore.layerMemory)`.
- Layer `RIn` includes `StoreScopeBridgeTag` on `layer` / `serve` / `Service.layer` / `make`.

## 🔴 Was wrong — fixed in `internal/runResourceStoreTap.ts`

~~1. **`serviceOption` on the new store bridge.**~~  
~~2. **Cast on the handle.**~~

## Keep

- The fact/state event shapes as the store's tagged-union rows (`record`/`events` / `stateHistory`),
  aligned with queue/process — **`_tag` in PascalCase** (`RunStarted`, `RunCompleted`, `RunFailed`),
  retiring kebab `type` strings (`run-resource.run.*`). Handle API unchanged.
- **`error` on `RunFailed` facts** — same presence-driven rule as store-core §5 (typed when tag stamps
  `error`; `String` fallback when not). Replace today's `cause: string` (`Cause.pretty`) on the store row.

## Note

The `bridge.at` 2-arg signature update was already applied during the Store-tightening merge — no action there.

## Verify
`pnpm typecheck` (both) + the run-resource + run-resource store suites.
