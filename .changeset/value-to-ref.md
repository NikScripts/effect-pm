---
"@nikscripts/effect-pm": minor
---

**Replace `value` fields with `ref` (a `Subscribable`).** A `value` was a plain property kept "live" by a
background fiber mutating the service object in place — which Effect never does (a plain member is fixed at
construction; changing state is a `Ref` read through an effect). With `constant` already covering the
fixed-at-build case, `value` was a non-idiomatic hack between the two.

- **Dropped `value`.** Field kinds are now `constant` / `ref` / `effect` / `stream` / `local` / `fleet`.
- **New `Resource.ref(schema)`** → materializes as **`Subscribable<A>`** (`{ get: Effect<A>; changes:
  Stream<A> }`), uniform local and remote: `yield* svc.x.get` for the current value, `svc.x.changes` to
  observe. The impl owns a `SubscriptionRef`, provided via **`Resource.subscribable(ref)`** (or
  **`Resource.mapSubscribable(source, f)`** to derive one — e.g. a queue's `size` from its `status`).
- **Removed `Resource.changes` / `Resource.ref` accessors** — `ref` fields expose `.changes` natively.
- **Deleted the mirror machinery** (`bindValueToProp`, the 30s block-for-initial and its deadlock class).

**Migration:** `Resource.value(S)` → `Resource.ref(S)`; the impl gives a `Subscribable` (`subscribable(ref)`
or `mapSubscribable`) instead of a raw `Stream`; reads become `yield* svc.x.get` (was `svc.x`) and
`svc.x.changes` (was `Resource.changes(svc, s => s.x)`). Queue `size`/`status`/`isEmpty` are now `ref`s.
