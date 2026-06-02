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

## Step 4: Router shape

- `StoreRouter` is a `Context.Service`, layer built from `ProcessStoreRegistry`
- Two dispatch methods: `query` and `queryFor` — full decode → resolve → encode round-trip
- Transport handler delegates entirely: `Effect.flatMap(StoreRouter, r => r.query(...))`
- Rich discriminated error taxonomy (not a single `StoreRpcError`) so protocol-agnostic transports can map errors correctly:
  - `UnknownFacet`, `UnknownMethod`, `PayloadDecodeError`, `ResultEncodeError`, `StorageError`
- `Store.Query` and `Store.QueryFor` are two separate RPC operations

## Step 3: Schema exposure on class + registry type inference

- `Facet.schemas` stamped by builder — base query schemas `{ [method]: { payload, success } }`
- `Facet.forSchemas` stamped separately — identifier-bound schemas `{ [method]: { payload, success } }`
- Success schemas may be shared/reused between `schemas` and `forSchemas` where methods overlap
- `ProcessStore.registry` returns both runtime lookup and type map
- `for` methods get a **separate RPC procedure** (`Store.QueryFor`) — takes `id` + payload, not folded into `Store.Query`
- Registry exposes both maps: `registry.lookup` (base) and `registry.forLookup` (identifier-bound)

## Step 2: `ProcessStore.payload().success().resolve()` chain

- `ProcessStoreMethod<P, S>` — sealed tagged object `{ _tag, payload, success, resolve }`
- `ProcessStoreQuerySection` stores `Record<string, ProcessStoreMethod<any, any>>` not `(s) => QueryApi`
- Spine binding happens at layer construction (`bindMethods`)
- Payload decoding happens in the **router**, not the resolver — resolver receives decoded types
- `ProcessStoreMethod` is `@internal`

## Step 1: `_processTag` on the builder
