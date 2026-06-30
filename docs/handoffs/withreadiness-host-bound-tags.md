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

## ✅ SHIPPED (2026-06-29) — #1, #2, #3 all resolved

- **#3 (root cause)** fixed by **erasing `[groupSym]` to `RpcGroup.RpcGroup<any>`** on `ResourceTag`
  (the exact "relax `[groupSym]`" option above; it already matched `ServeEntry.tag`'s field). With the
  one invariant member gone, `HostBoundTag` *is* assignable to `ResourceTag<any, any>`. The
  `Context.ServiceClass` constructor-variance worry turned out to be downstream of this too —
  `typeof HostBoundClass` assigns now as well. The precise group is still built at runtime; only the
  field type widened (sole reader is `serveAllHttp`'s merge, which just needs `.merge`).
- **The `withReadiness` band-aid is gone** — both overloads are back to plain `ResourceTag<any, any>`,
  no `| HostBoundTag`. No `| HostBoundTag` band-aids remain in the codebase (`client`'s `HostBoundTag`
  overload stays — it's semantic discrimination for transport resolution, not an accept-it band-aid).
- **#1, #2** are subsumed: data-last `.pipe` **and** data-first `withReadiness(tag, fn)` both accept a
  host-bound tag (regression tests for both in `test/resource-readiness.test.ts`). wow's `TODO(#29)`
  one-liner works on whichever form they prefer once this lands (next beta).

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
