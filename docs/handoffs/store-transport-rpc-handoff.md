# Store Transport RPC — handoff

## Branch

```
rewrite/store-transport
```

Branch is stable, pushed, typecheck clean, 358/358 tests passing.

## What this agent must build

A generic `StoreTransportRpc` module that lets dashboard / remote consumers
query every storage facet over Effect RPC — the same pattern as
`ControlTransportRpc` and `LogTransportRpc` in this repo.

**Read these before writing a line of code:**

- `docs/recipes/store-transport-rpc.md` — the locked design. Every ingredient
  in that doc is authoritative. Do not deviate without owner sign-off.
- `docs/AGENTS.md` — repo rules, verification commands, vendor repo policy.
- `docs/STORAGE.md` — facet layout, wire types, RuntimeStorage contract.
- `AGENTS.md` (root) — git commit policy, Effect platform policy.

---

## What is already built (do not re-implement)

Everything in `src/internal/store/service.ts` and `src/ProcessStore.ts` is done:

| Feature | Where |
|---------|-------|
| `ProcessStore.payload().success().resolve()` chain | `service.ts` |
| `ProcessStoreMethod` / `ProcessStoreForMethod` sealed types | `service.ts` |
| `_processTag` stamped on every facet class | `service.ts` |
| `Facet.schemas` / `Facet.forSchemas` (payload+success per method) | `service.ts` |
| `ProcessStore.registry([...facets])` — runtime lookup + type map | `service.ts` |
| `Facet.Query` sub-tag, `Facet.layerQuery`, `Facet.layerRemote(client)` | `service.ts` |
| `RunResourceStore` migrated to new DX (pilot facet) | `src/store/runResource.ts` |
| `processTag` added to all remaining facets | `src/store/*.ts` |

`layerQuery` requirement is `RuntimeStorage` (not the full facet). `layerRemote`
returns `Layer<Facet.Query, never, never>` and routes through a
`ProcessStoreQueryClient` (generic interface in `service.ts`).

---

## What remains — two pieces

### 1. `StoreRouter` (`src/StoreRouter.ts` or inline in transport)

Per the recipe (Step 4):

- `Context.Service` — provide via registry
- Two dispatch methods: `query(facet, method, payload)` and
  `queryFor(facet, id, method, payload)`
- Full round-trip: decode payload with `Schema.decodeUnknown` → call resolver
  with spine from `RuntimeStorage` → encode result with `Schema.encodeUnknown`
- Discriminated error taxonomy — **not** a single `StoreRpcError`:

| Error | When |
|-------|------|
| `UnknownFacet` | `_processTag` not in registry |
| `UnknownMethod` | method name not in facet's schema map |
| `PayloadDecodeError` | `Schema.decodeUnknown` fails on input |
| `ResultEncodeError` | `Schema.encodeUnknown` fails on output |
| `StorageError` | resolver returns `RuntimeStorageOperationalError` |

Transport handler delegates entirely:
```ts
Effect.flatMap(StoreRouter, r => r.query(facet, method, payload))
```

### 2. `StoreTransportRpc` module (`src/StoreTransportRpc.ts`)

Mirrors `ControlTransportRpc.ts` / `LogTransportRpc.ts` exactly in shape.

- `Store.Query` RPC operation — `{ payload: QueryRequestSchema, success: ..., error: StoreRpcErrorSchema }`
- `Store.QueryFor` RPC operation — separate operation, takes `id` + payload
- `StoreTransportRpcLive` — handler layer built from registry + StoreRouter
- `StoreTransportRpc` namespace — `{ rpc, live, clientLayer, serverLayer }`
- `ProcessStorage.layerRemote(client)` — merges all six `Facet.layerRemote`
  calls into one for dashboard bootstrap

---

## Key design decisions (locked in recipe)

- **`Store.Query` and `Store.QueryFor` are two separate RPC operations** — for-methods
  get their own procedure, not folded into `Store.Query`.
- **Payload decoding happens in the router**, not in the resolver. Resolvers
  receive already-decoded types.
- **`registry.lookup`** keys by `_processTag` then method name.
  **`registry.forLookup`** same shape for for-methods.
- **`ProcessStoreQueryClient` interface** (already in `service.ts`) is what
  `layerRemote` consumes — decouple from `StoreTransportRpc` specifically.

---

## RPC imports — critical

Use Effect v4 RPC from the installed `effect` package:

```ts
import { Rpc, RpcGroup } from "effect/unstable/rpc";
```

Do **not** use the standalone `@effect/rpc` npm package — it targets Effect 3
and will fail at runtime. Inspect `repos/effect/packages/effect/src/unstable/`
for idiomatic API patterns before writing RPC code.

---

## Existing transport to mirror

Read `src/ControlTransportRpc.ts` and `src/LogTransportRpc.ts` before writing
`StoreTransportRpc.ts`. Match their:
- namespace shape (`{ rpc, live, clientLayer, serverLayer }`)
- handler layer construction pattern
- error schema approach

---

## Facets in scope for registry

All six built-in facets — `RunResourceStore`, `QueueResourceStore`, `LogStore`,
`ProcessLifecycleStore`, `ProcessGroupStore`, `ProcessExecutionStore`. Wire them
all into the registry even though only `RunResourceStore` has schema-typed query
methods so far. The others still use the legacy `fn`-based query section and
will not appear in `registry.lookup` until migrated.

---

## Verification

```sh
pnpm run typecheck   # tsgo — must be clean
pnpm test            # 358 tests, must all pass
pnpm run lint
pnpm run build
```

Commit and push after every meaningful slice on this branch.
