# Store cutover — RunResource

Prereq: `store-cutover-00-store-core.md` (**the store is a defaulted service; resolve it as a declared
dependency; NEVER `serviceOption`**).

## ✅ Done (run-resource branch)

- Declared dependency: `yield* StoreScopeBridgeTag` once at tap build; **Store bridge only** — no `RunResourceStore` facet writes.
- Cast-free contract in `runResourceStoreSpec.ts` (mirrors queue).
- Handle cast removed from tap.
- `ProcessStore.catchErrorAndLog` → `catchErrorAndLog` from `internal/store/helpers`.
- Public `Store.layerDefaultMemory`; tests/examples use `Layer.provideMerge` at app root.
- Layer `RIn` includes `StoreScopeBridgeTag` on `layer` / `serve` / `Service.layer` / `make`.

## 🔴 Was wrong — fixed in `internal/runResourceStoreTap.ts`

~~1. **`serviceOption` on the new store bridge.**~~  
~~2. **Cast on the handle.**~~

## Keep

- The fact/state event shapes (`run-resource.fact.*` / state changes) as the store's tagged-union `event`
  row (`record`/`events`), aligned with queue/process.

## Note

The `bridge.at` 2-arg signature update was already applied during the Store-tightening merge — no action there.

## Verify
`pnpm typecheck` (both) + the run-resource + run-resource store suites.
