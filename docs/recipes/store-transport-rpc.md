# Recipe: Store Transport RPC

## Goal

Rewrite `ProcessStore.Service` builder to carry schema-annotated query methods,
add `_processTag` as a reliable discriminant, derive a type-safe `StoreRegistry`
type map, and wire a single generic `Store.Query` RPC endpoint backed by a
registry-driven router.

## Non-goals

- Changing the telemetry / emit sections
- Changing `RuntimeStorage` or the spine
- Dashboard React components (downstream concern)

## Mise en place

- Builder lives in `src/internal/store/service.ts`; public API in `src/ProcessStore.ts`
- `ProcessStoreFacetAnySection` union dispatched via `_tag` string
- `ProcessStoreQuerySection` currently: `{ _tag, fn: (s: Spine) => QueryApi }`
- `ProcessStoreForSection` currently: `{ _tag, fn: (id, s: Spine) => IdentifierApi }`
- `ProcessStoreFacetClass` carries `layer`, `layerRuntimeStorage`, emit statics, `for()`
- Effect RPC: `Rpc.make(name, { payload, success, error })` — naming convention to match
- `effect/unstable/rpc` is the import path for this version

---

## Locked ingredients

- `_processTag` — second positional arg `(id, processTag, ...sections)`, `const Tag extends string`, stamped as `static readonly _processTag: Tag` on the class
- Chain API: `ProcessStore.payload(S).success(S).resolve(fn)` — Effect RPC naming
- `ProcessStore.for` resolver signature: `(id: string, s: Spine) => (payload) => Effect`
- `ProcessStore.registry([...facets])` — array input, derives type map from `_processTag` + schemas

---

## Step 1: `_processTag` on the builder
