# Store layer query — design handoff (informational)

**Audience:** Store agent exploring read helpers on the EventJournal-backed `Store` stack.

**Status:** **Informational proposal only — not approved for implementation.**

| | |
|---|---|
| **Owner** | Nik (package owner) |
| **Approval** | **All public APIs, names, and behavior changes described here require explicit owner approval before shipping.** Treat every signature, export, and semantic choice in this doc as a draft. |
| **Implementation** | **Do not land public API or changeset entries from this doc without sign-off.** Internal spike / prototype behind `@internal` is fine if it helps evaluation — do not export or document as shipped. |
| **Companion docs** | [`store-backing.md`](../../../legacy/guides/store-backing.md) (journal mapping), [`store-cutover-00-store-core.md`](../../store-cutover-00-store-core.md) (Storage as defaulted service), [`store.md`](../../../legacy/guides/store.md) (current user guide) |

---

## Why this doc exists

A Process/docs agent investigated “read all scopes / whole layer” and found **no public bulk-read API**
today. Per-scope `store.<shape>.read` each walks `EventJournal.entries` independently. This handoff
captures a **proposed direction** — layer query as the primitive, scoped reads as filters — for the
Store agent to refine, challenge, or replace. **The owner has not approved the API surface below.**

---

## Current read surface (shipped today — do not break without approval)

Use this as the baseline the proposal must remain compatible with (delegate internally, same behavior).

| API | Granularity | Notes |
|-----|-------------|-------|
| `yield* AppStore.at(scope)` | One registered scope → typed handle | `src/internal/store/defineStore.ts` |
| `yield* Tag.store` | One scope via tag attachment | `src/Store.ts` |
| `store.<shape>.read(payload?)` | One shape | `src/internal/store/memoryScope.ts` |
| Custom aliases (`events`, `facts`, …) | One shape via contract part 2 | `src/internal/store/contractDef.ts` |
| `Store.withDefault` / `Store.withStorage` | Materialize one scope handle | `src/Store.ts` |
| `Store.Storage` → `bridge.at(scope, contract)` | Low-level one scope | `src/internal/store/bridge.ts` |
| `Store.changes(scope)` | Append stream, **one** scope | `src/internal/store/scopeBridge.ts` |

**Not available today:** multi-scope read, multi-shape read in one call, layer-wide dump, typed union
across registrations. `EventJournal.entries` is used internally only (`memoryScope.ts`).

**Separate stack (out of scope here):** `RuntimeStorage` + legacy facets (`QueueResourceStore.entries`,
etc.) — see [`STORAGE.md`](../STORAGE.md).

---

## Proposal summary

**Idea:** one `layerQuery` journal scan; aggregate/standalone static methods and shape `.read` filter it.
Registrations supply schemas for a typed row union; default `Storage` bridge returns `unknown` payloads.

**This is a design sketch, not a locked spec.**

---

## Goals

1. **One journal scan** for bulk reads (multi-scope, multi-shape, whole layer).
2. **Typed results** when registrations are known (`Store.Service`, standalone `Store.store`).
3. **`unknown` payloads** when only `Store.Storage` / default bridge is in context — still useful for
   debug/dump tooling.
4. **No semantic drift** — refactor existing shape `.read` to delegate internally; public call sites
   unchanged.
5. **Reverse derivation** — build layer query first; aggregate/standalone static methods filter it;
   shape reads filter further.

---

## Non-goals (this iteration)

- Replacing **`RuntimeStorage` facet** reads (`QueueResourceStore.entries`, etc.) — separate substrate.
- Returning **custom contract methods** as journal rows (only append shapes are journal events).
- Push-down domain filters beyond time window + limit (e.g. `runId`) — stay on shape read payloads
  or future per-contract query extensions.

---

## Row model

One canonical journal row (public):

```ts
/** One append row from the layer's EventJournal. */
export interface StoreLayerRow<T = unknown> {
  readonly scopeKey: string;
  readonly shape: string;           // journal `event` / append method name
  readonly payload: T;
  readonly occurredAtMillis: number;
}
```

**Discriminant:** `(scopeKey, shape)` — shape names may repeat across scopes without collision.

### Typed union from registrations

Each `NormalizedStoreRegistration` carries `contract.normalized`:

```ts
{ [shapeKey]: { row: Schema, read: Schema } }
```

Compile-time row union (new types on `Store` / `defineStore`):

```ts
type StoreLayerRowOf<R extends NormalizedStoreRegistration, S extends string> = {
  readonly scopeKey: R["scopeKey"];
  readonly shape: S;
  readonly payload: SchemaDecoded<R["contract"]["normalized"][S]["row"]>;
  readonly occurredAtMillis: number;
};

type StoreLayerRowsOf<Regs> = Union over all (registration × shape) pairs
```

Legacy flat `spec` registrations (no contract): derive append shapes from `APPEND_TAG` entries in `spec`.

---

## Query payload

```ts
export interface StoreLayerQuery {
  /** Omit = see “Default scope filter” below. */
  readonly scopeKeys?: ReadonlyArray<string>;
  /** Omit = all append shapes (within scope filter). Journal `event` names. */
  readonly shapes?: ReadonlyArray<string>;
  readonly limit?: number;
  readonly before?: number;
  readonly after?: number;
  /** Default `"asc"` — matches current shape reads. */
  readonly order?: "asc" | "desc";
}
```

Reuse existing `QueryOpts` semantics via `applyQueryOpts` / `queryOptsFromReadPayload` in
`src/internal/store/helpers.ts`.

### Default scope filter

| Caller | `scopeKeys` omitted |
|--------|---------------------|
| `Store.layerQuery` on **`Storage` only** | All scopes in the journal |
| `AppStore.layerQuery` (aggregate) | All **registered** `scopeKey`s only |
| `StandaloneStore.layerQuery` | Fixed single scope (implicit) |

Passing a `scopeKey` not in an aggregate’s registrations → `StoreScopeNotRegistered`.

---

## Primitive: `layerQuery` engine

**New internal module** (suggested: `src/internal/store/layerQuery.ts`).

### Algorithm

1. `yield* journal.entries` **once**.
2. Filter by `scopeKeys` / `shapes` (journal `primaryKey` / `event`).
3. Decode MessagePack → wire JSON (`decodeJournalPayload`).
4. **Schema decode:** lookup registry `Map<key, Schema>` where `key = `${scopeKey}\0${shape}``:
   - Hit → decode with `Schema.toCodecJson(rowSchema)` (same as append path in `memoryScope.ts`).
   - Miss → `payload: unknown`.
5. Sort by `occurredAtMillis` (`order`).
6. Apply per-scope **`maxRows` retention** (same cap as `memoryScope` today) before global
   `before` / `after` / `limit`.

### Runtime registry

Built when the layer boots (same moment as `buildBundle` in `sqliteLayer.ts`):

```ts
type ShapeRegistry = ReadonlyMap<string, Schema.Schema<unknown>>;
// key: `${scopeKey}\0${shape}`
```

- **`buildScopeBridge`** — registry from `NormalizedStoreRegistration[]`.
- **`buildDefaultScopeBridge`** — empty registry (all payloads `unknown`).

Pass registry into `layerQuery` implementation; bridges call it.

---

## API surface (draft — owner approval required)

> **Naming, exports, and which helpers ship are not final.** The Store agent should propose a
> minimal surface to the owner before adding `exports` subpaths, changesets, or `docs/guides/store.md`
> sections. Convenience helpers (`queryAll`, `queryScopes`) are optional and especially need approval.

### 1. `StorageApi` extension

```ts
export interface StorageApi {
  readonly at: ...;      // existing
  readonly changes: ...; // existing
  readonly layerQuery: (
    query?: StoreLayerQuery,
  ) => Effect.Effect<
    ReadonlyArray<StoreLayerRow<unknown>>,
    StoreJournalDecodeError,
    EventJournal.EventJournal
  >;
}
```

### 2. Public façade

```ts
// src/Store.ts — flat export, not object namespace
export const layerQuery = (
  query?: StoreLayerQuery,
): Effect.Effect<
  ReadonlyArray<StoreLayerRow<unknown>>,
  StoreJournalDecodeError,
  Storage | EventJournal.EventJournal
> => Effect.flatMap(Storage, (bridge) => bridge.layerQuery(query));
```

Optional escape hatch (later): `layerQuery(query, { contract })` to decode rows for one contract’s
scope + shapes when using default bridge only.

### 3. Aggregate `Store.Service` — static, typed

Attached in `attachAggregateLayers` (`src/Store.ts`):

```ts
AppStore.layerQuery(
  query?: StoreLayerQuery,
): Effect.Effect<
  ReadonlyArray<StoreLayerRowsOf<RegsOf<AppStore>>>,
  StoreJournalDecodeError | StoreScopeNotRegistered,
  AppStore | EventJournal.EventJournal
>;
```

Convenience (optional):

```ts
AppStore.queryScopes(...keys: Array<string | StoreScopeTag>)
AppStore.queryAll()  // all registered scopes, all shapes
```

Implementation: default `scopeKeys` to registered keys; validate explicit `scopeKeys ⊆ registrations`;
call shared `layerQuery` with registry from `storeRegsSym`.

### 4. Standalone `Store.store(...)` — static, single-scope typed

```ts
ThermoStore.layerQuery(
  query?: Omit<StoreLayerQuery, "scopeKeys">,
): Effect.Effect<
  ReadonlyArray<StoreLayerRowsOfSingleScope<contract>>,
  StoreJournalDecodeError,
  ThermoStore | EventJournal.EventJournal
>;
// Always implies scopeKeys: [ThermoStore.scopeKey]
```

### 5. Shape `.read` — delegate (internal refactor)

```ts
// Conceptual — in memoryScope.ts / contractDef materialization
store.event.read({ limit: 50 })
// becomes:
layerQuery({
  scopeKeys: [scopeKey],
  shapes: ["event"],
  limit: 50,
  before, after, order,
}).pipe(Effect.map((rows) => rows.map((r) => r.payload)))
```

Custom aliases (`events`, `facts`, `stateHistory`) stay thin wrappers over shape `read`.

---

## Type-level helpers (public)

| Export | Purpose |
|--------|---------|
| `Store.LayerRow<T>` | Alias for `StoreLayerRow<T>` |
| `Store.LayerQuery` | Query payload type |
| `Store.LayerRowsOf<StoreClass>` | Typed union for aggregate or standalone class |

Add `.test-d.ts` assertions: narrowing on `row.scopeKey` + `row.shape` refines `payload`.

---

## Semantics checklist

| Topic | Decision |
|-------|----------|
| Append vs query spec entries | Layer query uses **append** event names only; `QUERY_TAG` / `from` is shape-read internal |
| Retention | Per-scope `maxRows` before global limit |
| Order | Default `asc` (match `memoryScope`) |
| Errors | `StoreJournalDecodeError` on payload decode failure; `StoreScopeNotRegistered` for foreign scope on aggregate |
| `Store.changes` | Unchanged — per-scope append stream |

---

## Suggested implementation order (after owner approval)

1. **Owner sign-off** on minimal public surface (see checklist below).
2. **`layerQuery` engine** + `ShapeRegistry` builder from `NormalizedStoreRegistration[]`.
3. **Wire `StorageApi.layerQuery`** on `buildScopeBridge` and `buildDefaultScopeBridge`.
4. **Public `Store.layerQuery`** (only exports approved by owner).
5. **Refactor `memoryScope` shape `.read`** to delegate — existing tests must stay green; behavior
   change needs explicit approval.
6. **Static `layerQuery` on aggregate / standalone** — only if approved (may defer to phase 2).
7. **Type exports + `.test-d.ts`** for approved types.
8. **Runtime tests:** memory + SQLite; multi-scope; unknown on default bridge; retention.
9. **Docs + changeset** — only after API freeze.

### Owner approval checklist (before public ship)

- [ ] Primitive name: `layerQuery` vs `queryLayer` vs other
- [ ] Row type name: `StoreLayerRow` / `LayerRow` / other
- [ ] Whether `StorageApi` grows a new method vs free function on `Store` only
- [ ] Aggregate static methods vs instance-only access
- [ ] Convenience: `queryAll` / `queryScopes` — ship or omit
- [ ] Foreign `scopeKey` on aggregate: fail vs untyped passthrough
- [ ] Internal refactor of shape `.read` in same PR or follow-up
- [ ] Changeset + `docs/guides/store.md` wording

---

## Examples

```ts
// Entire registered app store, typed
const all = yield* AppStore.layerQuery({ limit: 500 });

// Multi-scope, one shape
const events = yield* AppStore.layerQuery({
  scopeKeys: [Prices.key, Orders.key],
  shapes: ["event"],
  limit: 100,
});

// Standalone
const thermo = yield* ThermoStore.layerQuery({ shapes: ["readings"], limit: 10 });

// Debug — Storage / default bridge only, mostly unknown
const raw = yield* Store.layerQuery({ limit: 200 });
```

---

## Files likely touched

| Area | Paths |
|------|-------|
| Engine | `src/internal/store/layerQuery.ts` (new) |
| Registry | `src/internal/store/registrationNormalize.ts` or builder next to `buildBundle` |
| Bridge | `src/internal/store/bridge.ts`, `scopeBridge.ts`, `memoryScope.ts` |
| Public | `src/Store.ts`, `src/internal/store/defineStore.ts` |
| Tests | `test/store-layer-query.test.ts`, `test/store-layer-query.test-d.ts` |
| Docs | `docs/guides/store.md`, this file |

---

## Verify

```bash
pnpm run typecheck
pnpm exec vitest run test/store.test.ts test/store-default.test.ts \
  test/store-layer-query.test.ts
# Plus any existing store read tests after memoryScope refactor
```

---

## Open questions (for Store agent → owner)

1. **Global vs per-scope limit:** when both `maxRows` retention and `limit` apply, document ordering
   (draft recommends: retention cap per scope first, then time window, then global `limit`).
2. **Aggregate foreign keys:** fail `StoreScopeNotRegistered` vs return untyped rows — draft
   recommends **fail** for typed aggregate API.
3. **Schema export:** runtime `Schema` for the registration union (RPC/logging) vs type-only union.
4. **Phase split:** ship primitive `Store.layerQuery` first, defer aggregate static methods?
5. **Alternative designs:** e.g. journal export stream, registration-scoped iterator only — worth
   comparing before committing.

---

## Key source files (read before implementing)

| File | Relevance |
|------|-----------|
| `src/internal/store/memoryScope.ts` | Today’s per-shape read + append; `rowsForScope`, retention |
| `src/internal/store/scopeBridge.ts` | `buildScopeBridge`, `buildDefaultScopeBridge` |
| `src/internal/store/bridge.ts` | `StorageApi` type |
| `src/internal/store/defineStore.ts` | `StoreBundle`, `storeRegsSym`, `at` |
| `src/internal/store/registrationNormalize.ts` | `NormalizedStoreRegistration` |
| `src/internal/store/contractDef.ts` | `contract.normalized`, shape schemas |
| `src/internal/store/sqliteLayer.ts` | `buildBundle`, layer boot |
| `src/internal/store/helpers.ts` | `applyQueryOpts`, `queryOptsFromReadPayload` |
| `src/Store.ts` | Public `Storage`, `withDefault`, `changes` |
| `docs/guides/store-backing.md` | Journal field mapping |

---

## Related handoffs

- [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) — Storage defaulted service, no `serviceOption`
- [`store-and-logs-design.md`](./store-and-logs-design.md) — two-plane model
- Process agent review: [`process-store-cutover-review.md`](archive/2026-07/agents/process-store-cutover-review.md) — serialization / tap notes (separate from layer query)
