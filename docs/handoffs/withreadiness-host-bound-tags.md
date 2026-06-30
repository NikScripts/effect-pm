# Report: `withReadiness` + host-bound tags — fix is partial and not on main

Found while wiring a custom `Database` resource (host-bound `Resource.Tag`) whose readiness should feed
the host `/health`. Three related issues, in priority order.

## 1. The data-last fix isn't on `main` (only `cursor/host-health-dogfood`)

`src/Resource.ts` on `cursor/host-health-dogfood` fixes the **data-last** (`.pipe`) overload to name
`HostBoundTag`, with a regression test (`test/resource-readiness.test.ts` — "a host-bound tag can
extend readiness via .pipe"). **`main` does not have it** (no regression test there; both overloads
still `T extends ResourceTag<any, any>`). So any consumer on `main` / the published beta (e.g.
wow-sports on vendored beta.13) cannot attach readiness to a host-bound `Resource.Tag` at all:

```ts
class Database extends Resource.Tag<Database>()(
  "app/Database",
  { status: Resource.query(DbStatus) },
  { host: H },
).pipe(Resource.withReadiness(databaseReadiness)) {}
// ❌ (pre-fix) TS2684: the 'this' context of 'HostBoundTag<…>' is not assignable to
//    method's 'this' of type 'ResourceTag<any, any>'.
```

→ **Merge the fix to `main`** (and cut a release). Since every real resource tag is host-bound
(queues/processes/apimetrics all take `{ host }`), this blocks the entire user-facing readiness story
for custom resources on the published version.

## 2. The **data-first** overload still rejects host-bound tags (even with the fix)

The branch fixed only the data-last overload. The data-first one is unchanged:

```ts
// src/Resource.ts (cursor/host-health-dogfood)
<T extends ResourceTag<any, any> | HostBoundTag<any, any, any>>(   // data-last — fixed
  readiness: ReadinessOf<…>): (tag: T) => T;
<T extends ResourceTag<any, any>>(                                  // data-first — NOT fixed
  tag: T, readiness: ReadinessOf<…>): T;
```

So `Resource.withReadiness(hostBoundTag, fn)` still fails:

```ts
Resource.withReadiness(Database, databaseReadiness);
// ❌ TS2345: Argument of type 'HostBoundTag<…>' is not assignable to parameter of type
//    'ResourceTag<any, any>'.
```

This is easy to miss because the regression test only exercises `.pipe`. → **Name `HostBoundTag` in
the data-first overload too**, and add a data-first case to the regression test. (It matters: `.pipe`
in a class `extends` position has its own quirks, so the data-first form
`class X extends Resource.withReadiness(tag, fn) {}` is a natural alternative — it's what I reached for
when `.pipe` failed.)

## 3. Root cause: `HostBoundTag` isn't assignable to `ResourceTag<any, any>` → per-helper band-aids

`HostBoundTag<Self, S, HSelf> extends ResourceTag<Self, S>`, yet it's **not** assignable to
`ResourceTag<any, any>` — the branch comment pins it on the invariant `[groupSym]: RpcGroup<any>` map
(plus `Context.ServiceClass` constructor invariance). So the current remedy is to name
`| HostBoundTag<any, any, any>` in _each_ helper's constraint. `clientLayer` already carries a separate
`HostBoundTag` overload; `withReadiness` is getting one; **every other helper typed
`(tag: ResourceTag<any, any>)` has the same latent hole** and will need the same patch as someone hits
it. That's whack-a-mole.

→ Worth a root-cause pass so host-bound tags are _structurally_ a `ResourceTag<any, any>`: e.g. make
the offending field covariant / `out`, relax `[groupSym]` to a bivariant or `unknown`-keyed shape, or
have `Resource.Tag(…, { host })` return an intersection that stays assignable. Then helpers don't each
need a hand-rolled overload, and new helpers don't silently exclude host-bound tags.

## ✅ SHIPPED (2026-06-29) — #1, #2 resolved; #3 evaluated, union kept

- **#1, #2** resolved: both `withReadiness` overloads accept `ResourceTag<any, any> |
  HostBoundTag<any, any, any>`, so a host-bound tag works via the data-last
  `tag.pipe(Resource.withReadiness(...))` form (wow's `TODO(#29)` path) — regression test in
  `test/resource-readiness.test.ts`. **Group types stay fully precise (`RpcGroupOf<S>`); no cast.**
- **#3 (root cause) — evaluated three structural fixes, kept the explicit union:**
  - *Erase `[groupSym]` to `RpcGroup<any>`* (makes `HostBoundTag` assignable) — **rejected**: it
    discards the precision `RpcClient.make` is built to preserve (the un-Effect move); a real downgrade
    even though the `any` is sealed to one field.
  - *Type-alias `HostBoundTag = ResourceTag<Self,S> & {…}`* — **rejected**: assignable, but the
    intersection expands inline through generics and leaks `hostSym` (TS4020) even though `hostSym` is
    already exported.
  - *Host as a 3rd type param of `ResourceTag`* — viable but a worse trade: needs a conditional
    `[hostSym]` field, widening every helper constraint to `<any,any,any>` (same footgun, reshaped),
    fragile `client` `never`-vs-host discrimination, a public signature change, and perf risk.
  - **Kept:** the explicit union on the ~2 helpers that take a tag. It's not a band-aid — it's the
    honest "accepts either tag variant" input (`client` already uses the same shape), fully precise,
    no cast, lowest risk. The only cost is naming both arms on those helpers.
- **Caveat:** the data-**first** *class* form `Resource.withReadiness(SomeHostBoundClass, fn)` does
  **not** typecheck (a `typeof Class` constructor isn't assignable to the union — a `Context.ServiceClass`
  variance quirk, independent of `[groupSym]`). The supported host-bound path is the data-last `.pipe`
  form, which is what the contracts and wow use. Data-first works for host-bound tag *values* (contracts).

## Consumer status

wow-sports shipped the served `Database` card without readiness (a plain host-bound tag — works) and
left `TODO(#29)` to add `.pipe(Resource.withReadiness(databaseReadiness))` once #1 lands on main. So
this is the one seam between "DB card on the dashboard" (done) and "DB drop → host `/health` 503"
(pending this).

## Evidence

- `src/Resource.ts` (branch) withReadiness overloads — only data-last names `HostBoundTag`.
- `test/resource-readiness.test.ts` regression — `.pipe` only.
- `src/Resource.ts` `clientLayer` — the precedent per-helper `HostBoundTag` overload.
- `HostBoundTag` def: `extends ResourceTag<Self, S>` + `readonly [hostSym]`; the invariant is `[groupSym]`.
