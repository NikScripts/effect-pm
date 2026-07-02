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
2. **✅ DONE — `constant`.** Plain value resolved once at acquire, identical local↔remote — reuses the
   query wire (impl = `Effect<A>`); `ServiceOf` maps it to plain `A`; `localLayer` + `buildClientService`
   resolve it once at build. Test: `test/resource-constant.test.ts` (local + remote round-trip). v1 is
   non-failing (`E = never`) — fallible/`initial`/batched-resolve are follow-ups.

3. **value shape + delta channel + provider normalization.** New `MethodKind`/marker for `value`;
   `buildRpcGroup` emits a reserved `resolve` RPC folding value leaves; `serverLayer` implements it
   (`Effect.all` over normalized providers); `forwardClient`/materialization run `resolve` once and set
   plain props; `ServiceOf` maps `value` → plain `A`; local layer resolves values at build. Flat first.
3. **nesting.** Recurse the spec-walk in `buildRpcGroup` / `serverLayer` / `forwardClient` /
   `ServiceOf` / the `resolve` struct; path-based procedure names. Guard leaf-vs-group by the brand.
4. **hard rename.** Migrate all consumers + tests `query→effect` / `mutate→effectFn`; retire `query`/
   `mutate` (and internal `MethodKind` strings if worth it). The RPC names are then gone.

## FINAL locked decisions (2026-07-02) — governed by the *no silent divergence* law

**The law:** a field behaves **identically** local↔remote, or its divergence is **loud** (a type/dependency
error, like `local`). Silent same-looking-but-different is banned.

**Taxonomy (all nestable to any depth, all Schema-serializable):**
- **`constant(S, { initial? })`** — plain `p.x: A`, resolved **once at acquire** (batched), never changes.
- **`value(S, { initial? })`** — plain `p.x: A`, kept live by **one** background delta-stream (below); each
  `yield* Tag` reads the current cell (cheap, no request). Provider = a `SubscriptionRef<A>` (or seeded
  stream) so it has a current value.
- **`effect` / `effectFn`** — pull, `Effect<A>` / `(In) => Effect<A>`, one request per call.
- **`stream`** — explicit push `Stream<A>` (consumer subscribes; establishing it is effectful, surfaced as
  `Stream`).
- **`local`** — off-wire, loud (capability error remotely).

**The value channel (deltas, one stream):** every `value` leaf (nested included) is merged into **one**
per-resource stream of `{ path, value }` **deltas** (each leaf's `SubscriptionRef.changes`, path-tagged —
merge, not `combineLatest`). Client keeps a cell per path, patches on each delta. **No snapshot message.**
Initial state = the first delta per leaf (SubscriptionRef emits current on subscribe).

**Initial / acquire:** **block acquire** until every value-path has its first delta (authoritative — no
placeholder), with a **timeout** so a never-emitting source fails acquisition *loudly*. Optional
**contract-level `initial`** opts a leaf out of the block (starts at the placeholder, goes live) — the
contract default is shared so it stays transparent. `constant`/`value` errors surface **at acquire**.

**`yield* Tag` stays cheap** — reads cells, never a request (the divergence-free, footgun-free result).
Remote cells are eventually-consistent (latency = physics, not silent divergence).

## Later slices (parked)
`ref`/`subscriptionRef` (value ⊕ changes) · `deferred` (likely folded into `effect`) · push family
(`sink`/`queue`/`pubsub`, gated on client-streaming transport — verify) · true sub-resources.

## Gate (every increment)
`typecheck` (both projects) · `effect-language-service diagnostics` (0) · `eslint` · `build` · `test`;
no `as`/`!` casts (structural); explicit `export interface` for public types; changeset on the increment
that changes public API.
