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

3. **✅ DONE — `value`.** Plain property kept live by a background stream (impl = `SubscriptionRef.changes`),
   surfaced via the `value` brand as plain `A`; reuses the stream wire. `bindValueToProp` (shared by
   `localLayer` + `buildClientService`) subscribes, blocks for the initial (30s timeout → **die**, loud),
   forks an updater that mutates the property in place. `yield* Tag` stays a cheap context read. Test:
   `test/resource-value.test.ts` (plain+live local; plain+resolved-at-acquire remote). v1 = **one stream
   per value field** (single merged stream + optional `initial` are follow-ups; timeout is a fixed 30s).

3b. **value shape + delta channel + provider normalization.** New `MethodKind`/marker for `value`;
   `buildRpcGroup` emits a reserved `resolve` RPC folding value leaves; `serverLayer` implements it
   (`Effect.all` over normalized providers); `forwardClient`/materialization run `resolve` once and set
   plain props; `ServiceOf` maps `value` → plain `A`; local layer resolves values at build. Flat first.
3. **nesting** (the biggest — scoped, not started). **Approach: flatten-at-construction /
   nest-at-materialization**, to leave the delicate flat type machinery untouched:
   - `Spec` gains nested groups: `Record<string, AnyMethod | AnyLocalMethod | Spec>`.
   - **Tag construction** flattens the nested spec to a **flat path-keyed spec** (`"connections.size"`)
     stored in `specSym`; `buildRpcGroup` / `serverLayer` / `forwardClient` run on the **flat** spec
     unchanged (path keys are method names with dots — `wireTag(groupId, "connections.size")`).
   - **Impl** is provided nested → flatten it the same way at `localLayer` / `serverEntry` / client.
   - **Materialization output**: `nestService(flatService)` splits path keys back into the nested object.
   - **Types**: `ServiceOf` / `ImplOf` recurse over the *nested* spec (group → nested object, leaf → its
     shape); leaf-vs-group told apart by the `methodTypeId` / local / constant / value brands.
   - Risk lives entirely in the **type-level tree recursion** feeding `RpcUnionOf`/`ServiceOf`.
   - **✅ Type foundation PROVEN** (isolated probe, compiled clean incl. a `@ts-expect-error` that a group
     is not a leaf key, nested paths fold, leaf types preserved). The working `FlatSpecOf`:
     ```ts
     type FlatSpecOf<Sp, Prefix extends string = ""> = UnionToIntersection<{
       [K in keyof Sp & string]: Sp[K] extends AnyMethod | AnyLocalMethod
         ? { readonly [P in `${Prefix}${K}`]: Sp[K] }
         : FlatSpecOf<Sp[K], `${Prefix}${K}.`>;
     }[keyof Sp & string]>;
     ```
     `ServiceOf`/`ImplOf` recurse directly over the nested spec (group → nested object, leaf → shape).
   - **Remaining (the integration, ~15–20 coupled edits):** widen `Spec` to nested; `specSym` stores
     `FlatSpecOf<S>` (a runtime `flattenSpec`); `buildRpcGroup`/`serverLayer`/`forwardClient` take the flat
     spec (`RpcGroupOf<FlatSpecOf<S>>`); `ServiceOf`/`ImplOf` recurse; runtime `flattenImpl` (localLayer /
     serverEntry / client) + `nestService` (materialization output). All coupled through `Spec`, so it's
     one atomic change — a focused pass.
4. **✅ DONE — hard rename.** Migrate all consumers + tests `query→effect` / `mutate→effectFn`; retire `query`/
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

## Follow-up (after the redesign lands, user-requested 2026-07-02)
Re-examine every existing resource + process (`QueueContract`, `ScheduledProcess`, `ApiMetrics`,
`Telemetry`, `HostStatus`, `HostLogs`, …) for fields that should become `constant` / `value` (live) /
nested groups now that those shapes exist — e.g. a queue's `size`/`pending` reading better as live `value`s
than `effect` pulls, host/telemetry status as `value`s, related fields grouped by nesting. A polish pass,
not a rewrite; do it before the big release.

## Nesting integration — CONFIRMED cascade (attempted 2026-07-02, reverted to keep main green)
Both type properties are proven (`FlatSpecOf` compiles; `FlatSpecOf<flat>` ≈ flat, so `specSym` retype is
backward-compatible). Opening the integration confirmed the exact ~20-site cascade — **mechanical, no
surprises**, but atomic (all coupled through `Spec`), so it needs a session with runway, not a tail-end:
1. **`ServiceOf` / `ImplOf`** — add the recurse branch: after local/constant/value, `S[K] extends AnyMethod
   ? ServiceMethod<S[K]> : S[K] extends Spec ? ServiceOf<S[K], Self> : never` (fixes the
   `Exclude<S[K], AnyLocalMethod>` constraint errors once `Spec` is widened).
2. **`specSym` retype → `FlatSpecOf<S>`** across **every** tag-interface declaration (~10 sites:
   `makeTag`, `localLayer`, `serverLayer`, `serverEntry`, `clientLayer`, `httpServer` internals, peers, …)
   + **`groupSym` → `RpcGroupOf<FlatSpecOf<S>>`**. This makes every `Object.entries(tag[specSym])` site see
   flat leaves again (fixes the `AnyMethod | Spec` iterate errors + `buildRpcGroup` `m.success` errors).
3. **Tag construction** runs `flattenSpec(nestedSpec)` into `specSym`; **materializations** run
   `flattenImpl(nestedImpl, nestedSpec)` then build the flat service then `nestService(...)`.
4. **`nestService`** needs `noUncheckedIndexedAccess`-safe indexing (`parts[i]!` or a guarded local).
5. One example (`examples/resource-atoms`) iterates a spec directly — update to `isSpecLeaf`.
The working `flattenSpec`/`flattenImpl`/`nestService`/`isSpecLeaf`/`FlatSpecOf` are drafted in this doc's
git history (reverted commit's diff) — reinstate them as the starting point.

## Nesting — the REAL blocker (2nd attempt 2026-07-02, reverted green)
Drove the full integration. It **compiles for concrete specs** (the probes) but hits **TS type-system
limits under a generic `S`** — the free-type-parameter deferral the flat code warns about, now biting:
- **`FlatSpecOf<S>` does not satisfy the `Spec` constraint** wherever it flows into `RpcGroupOf<…>` /
  `RpcUnionOf<…>` / tag interfaces under a *generic* `S` (it reduces for concrete `S`, not generic). ~30
  of the 42 errors are this one root cause.
- **`TS2589 "excessively deep"`** at one factory site (`HostTagFactory<S>` region) — `FlatSpecOf` recursion
  exceeds TS's depth in that context.

**So `specSym: FlatSpecOf<S>` is the wrong move.** The pivot: **keep the wire types OPAQUE.**
- `specSym: Record<string, AnyMethod | AnyLocalMethod>` (a flat spec, **not** `FlatSpecOf<S>`), `groupSym:
  RpcGroup.RpcGroup<any>` — decoupled from `S`, so no `FlatSpecOf<S>`-in-constraint and no deep instantiation.
- Precision lives **only** in `ServiceOf<S>` / `ImplOf<S>` (the consumer-facing nested types) — which
  already recurse fine.
- The wire (buildRpcGroup / serverLayer / forwardClient) runs on the opaque flat spec at runtime via
  `flattenSpec`/`flattenImpl`/`nestService`; one documented boundary cast per construction (consistent with
  the existing `as unknown as RpcGroupOf<S>` casts). `FlatSpecOf` the *type* is then unnecessary — only the
  runtime `flattenSpec` is.
This is a real architectural decision (opaque wire vs precise flat type) — make it deliberately. Runtime
helpers + `ServiceOf`/`ImplOf` recursion are correct as drafted; only the wire *typing* changes.

## Nesting — FULL diagnosis after the opaque attempt (2026-07-02, reverted green)
The opaque-wire pivot got **`src/Resource.ts` to compile CLEAN** with nesting (widen `Spec`; recurse
`ServiceOf`/`ImplOf`/`WireServiceOf`/`PeerServiceOf`/`ServeImplOf`; `specSym: FlatSpec`,
`groupSym: RpcGroup<any>`; `buildRpcGroup`/`forwardClient` take `FlatSpec`; runtime `flattenSpec` /
`flattenImpl` (walks flat path keys) / `nestService` in both materializations). Then:
- **`specSym: FlatSpec` broke `S`-inference** (functions take an inline `{ [specSym]: FlatSpec, … }` tag, so
  `S` was unrecoverable → `serve` saw `ServeImplOf<Spec, …>`). **Fix that worked:** a phantom
  `declare const specTypeSym` + `readonly [specTypeSym]?: S` on `ResourceTag` **and every inline tag type**
  (perl-insert between `specSym` and `groupSym`). Dropped **134 → 83** consumer errors.
- **The 83 that remain are structural, not mechanical:**
  1. **Generic consumer specs don't reduce.** `QueueContract`/`ScheduledProcess`/`CustomQueueContract` are
     generic over the item schema `F`; the recursive `ServiceOf`/`RpcUnionOf` **don't evaluate under a free
     `F`**, so service members become `unknown` (`test/queue-contract.test` "Type 'unknown' must have
     `[Symbol.iterator]`"). This is the free-type-parameter deferral, now in the *generic resources*.
  2. **`RpcGroup<any>` leaks `any` into consumers' `R`** — the ~24 `*-remote-http` errors
     (`Effect<…, any>` not assignable to `Effect<…, never>`). The opaque `any` propagates through
     `HandlerContextOf`.
  3. **Toolkit introspection** (`tag[specSym].add.payload…` in `QueueContract`/`CustomQueueContract`) needs
     `isSpecLeaf` narrowing (a few sites).

**Conclusion / decision needed:** nesting fundamentally requires widening `Spec`, which stresses the
toolkit's *generic* resources' recursive types (1) and forces an opaque group that leaks `any` (2). These
are real TS-limit problems, not edits. Options: **(A) descope nesting** — ship the 4 shipped increments as
"the redesign" (nesting parked); **(B) a dedicated effort** solving generic-spec reduction (e.g. a
non-recursive `ServiceOf` via a distributive helper, or precise-but-bounded group typing to kill the `any`
leak); **(C) restrict nesting to non-generic (consumer-defined) resources** only. This is the user's call.

## Nesting — the SOLUTION (identified 2026-07-02; dedicated effort chosen)
Both blockers (generic-`F` → `unknown`; `any`-leak) have **one root cause**: my recursive rewrite branches
on `S[K] extends AnyMethod` / `S[K] extends Spec`, which **drag the `F`-parameterized schemas into the
conditional → TS defers** (the exact gotcha the flat `ServiceOf` comment documents). The old flat code
avoided it by branching **only on the `LocalMethod` symbol brand** (`F`-independent) + `Exclude<…,
AnyLocalMethod>`.

**Fix: detect leaf-vs-group by the `[methodTypeId]` BRAND (a symbol → `F`-independent, always reduces),
never by `extends AnyMethod`/`extends Spec`.** Apply to every recursive type (`ServiceOf` / `ImplOf` /
`WireServiceOf` / `PeerServiceOf` / `ServeImplOf` / `RpcUnionOf`):
```ts
// leaf method (ANY method incl. generic-F) — brand check reduces under free F:
S[K] extends { readonly [methodTypeId]: unknown }
  ? ServiceMethod<Exclude<S[K], AnyLocalMethod>>   // Exclude is F-independent too (checks localMethodTypeId)
  // else it's a group:
  : ServiceOf<Extract<S[K], Spec>>
// (constant/value brand checks come first, as today; LocalMethod check first of all)
```
`RpcUnionOf` likewise: `S[K] extends { [methodTypeId]: unknown } ? RpcOf<K, S[K]> : never` — this makes
`HandlerContextOf<generic-F>` reduce, which kills the `RpcGroup<any>` `R`-leak too (same root cause).

**Dedicated-effort plan (fresh session, full budget):** reinstate the opaque integration (all edits
documented in the two attempt-notes above — foundation, recurse the 5 types, `specSym: FlatSpec` +
`specTypeSym` phantom on ResourceTag **and** every inline tag type, `groupSym: RpcGroup<any>`,
`buildRpcGroup`/`forwardClient` take `FlatSpec`, runtime flatten/nest in both materializations) **but with
the brand-check form above from the start**. Then typecheck-iterate the consumers; the generic queue/process
specs should now reduce. Validate with a nested-spec round-trip test (local + remote).

## Nesting — SOLUTION revised: NO brand, use a narrow structural check (validated 2026-07-02)
The `[methodTypeId]` brand was unnecessary — what matters is checking a **narrow F-independent property**,
not the whole `AnyMethod` (which drags the F-parameterized schemas → TS defers). **Probe-validated:**
`M<Su> extends AnyMethod` does NOT reduce under a generic `Su`; `M<Su> extends { readonly kind: string }`
DOES. So distinguish leaf-vs-group by the method's own **`kind`** field — no symbol brand, no type pollution:
```ts
S[K] extends { readonly kind: MethodKind }          // a leaf method (incl. generic-F) — reduces
  ? ServiceMethod<Exclude<S[K], AnyLocalMethod>>     // Exclude checks localMethodTypeId only → F-independent
  : ServiceOf<Extract<S[K], Spec>>                   // else a nested group
```
Apply in every recursive type (`ServiceOf`/`ImplOf`/`WireServiceOf`/`PeerServiceOf`/`ServeImplOf`) **and**
`RpcUnionOf` (`S[K] extends { readonly kind: MethodKind } ? RpcOf<K, S[K]> : never`) — the latter makes
`HandlerContextOf<generic-F>` reduce, killing the `any`-leak too (same root cause).

**Bonus — this may also drop the opaque wire + the `specTypeSym` phantom.** Those were only needed because
the recursive types didn't reduce, forcing `RpcGroup<any>` (leaks `any`) and losing `S` from `specSym`.
With the structural `kind` check making everything reduce under generic `F`, **retry the *first*
(non-opaque) approach**: `specSym: FlatSpecOf<S>` precise (no phantom), `groupSym: RpcGroupOf<FlatSpecOf<S>>`
precise (no `any`) — if `FlatSpecOf` itself uses the `kind` check so it reduces + satisfies `Spec`
generically. Try that path first in the dedicated effort; fall back to opaque only if `FlatSpecOf<S>`
still won't satisfy the `Spec` constraint generically.
