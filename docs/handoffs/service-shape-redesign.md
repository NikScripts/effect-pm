# Design + build: service-shape redesign (shape-named, values, nesting)

**Locked with the user (2026-07-01). Building in green increments — the core spec/wire machinery, so
each step keeps all tests passing.**

## Vision
Name spec builders for **what they resolve to in the service shape**, not the RPC verb; remove the
"everything must be a yieldable Effect" limitation (allow **plain values**); make the spec a **tree**
(shapes nest to any depth); everything carries **error channels**.

## Taxonomy — slice 1

| builder | resolves to | error surfaces | today |
|---|---|---|---|
| `value(A, E?)` | `A` (plain) | at `yield* Tag` (materialize) | — new |
| `effect(A, E?)` | `Effect<A, E>` | per use | rename of `query` |
| `effectFn(In, A, E?)` | `(In) => Effect<A, E>` | per call | rename of `mutate` |
| `stream(A, E?)` | `Stream<A, E>` | per element | unchanged |
| `local` | anything | as-is | unchanged |

**Providers** (impl side, sync fns allowed *here*, never in the shape): `value`/`effect` both accept
`A` (const) · `Effect<A>` · `() => A` · `() => Effect<A>`; normalized to `Effect<A>` internally. One
provider feeds many shapes (e.g. one `getCurrentConnections: Effect<number>` backs both a `value`
`connections` and an `effect` `getConnections`) — only the pull *timing* differs (value = once at
materialize; effect = per call).

**Nesting**: interior nodes are plain grouping objects, leaves are shape builders (told apart by the
`methodTypeId` brand). `value` leaves fold into the batched resolve at any depth; `effect`/`effectFn`/
`stream` become **path-named** procedures (`metrics.reset`).

**Errors**: `value` is **all-or-nothing** — `yield* Tag` is `Effect<Service, E₁|E₂|…, R>` (union of every
value leaf's `E`, tree-wide); if it succeeds every `p.value` is plain. `effect`/`stream` errors are
per-use on their leaf. (This is deliberate — per-field `Exit` would kill the plain-value ergonomic.)

## Wire mechanics
- `value` leaves → **one reserved `resolve` procedure** per group, returning a (possibly nested) struct of
  all value leaves, each computed server-side at materialize; the client runs it once on `yield* Tag`.
- `effect`/`effectFn`/`stream` → the existing per-procedure machinery, keyed by **path** for nested.
- `local` → no wire.

## Increments (each green + committed)
1. **✅ DONE — shape-named builders.** `Resource.effect` / `Resource.effectFn` added (alias `query`/
   `mutate`, full overloads); `stream` already shape-named. Additive, nothing breaks. New vocabulary in
   place.
2. **value shape + batched `resolve` + provider normalization.** New `MethodKind`/marker for `value`;
   `buildRpcGroup` emits a reserved `resolve` RPC folding value leaves; `serverLayer` implements it
   (`Effect.all` over normalized providers); `forwardClient`/materialization run `resolve` once and set
   plain props; `ServiceOf` maps `value` → plain `A`; local layer resolves values at build. Flat first.
3. **nesting.** Recurse the spec-walk in `buildRpcGroup` / `serverLayer` / `forwardClient` /
   `ServiceOf` / the `resolve` struct; path-based procedure names. Guard leaf-vs-group by the brand.
4. **hard rename.** Migrate all consumers + tests `query→effect` / `mutate→effectFn`; retire `query`/
   `mutate` (and internal `MethodKind` strings if worth it). The RPC names are then gone.

## Later slices (parked)
`ref`/`subscriptionRef` (value ⊕ changes) · `deferred` (likely folded into `effect`) · push family
(`sink`/`queue`/`pubsub`, gated on client-streaming transport — verify) · true sub-resources.

## Gate (every increment)
`typecheck` (both projects) · `effect-language-service diagnostics` (0) · `eslint` · `build` · `test`;
no `as`/`!` casts (structural); explicit `export interface` for public types; changeset on the increment
that changes public API.
