# Store migration — old tap/bridge → the new machinery

If your resource records lifecycle events into a `Store` with a hand-rolled recorder — resolving the
handle eagerly, building generic event objects, and wrapping each write to swallow failures — this is
the guide to move it onto `Store.effects` + `Store.catchWriteErrors` + a three-tier contract. The
**queue is the worked golden example**; process/run resources copy the same shape.

> Reference: [`store.md`](./store.md) (machinery) and [`queue-resource.md`](./queue-resource.md) (the
> finished three-tier example).

## What changed

| Old (tap / bridge) | New (machinery) |
|---|---|
| Eagerly `resolveOrDie` the handle, hold it, `yield*` its methods | `Store.effects(scope, contract)` — a **pure** object whose every method carries `Storage`; no eager resolve, no memo cell |
| Build a generic `Event` object, call generic `record(event)` | **Narrow typed writes** on an engine write-extension contract (`completed(entry, success, elapsed)`, …), each funnelling to the shared append |
| Hand-rolled `swallowWriteErrors` (write-path metadata) / per-call `guardWrite` / `.pipe(catchErrorAndLog)` | `Store.catchWriteErrors` — one transform over the whole effects object |
| Custom cast-to-`never` on `append` (a lie) | `append` honestly `Effect<void, StoreWriteError>`; the category rides on the error |
| Analytics computed ad hoc by the consumer | A **read-extension** contract the consumer registers (`Resource.store(tag)`) with the derivations built in |

Removed entirely: `withStorage` / `withDefault` (→ `resolve` / `resolveOrDie`), the `swallowWriteErrors`
write-path metadata, and any manual `guardWrite`.

## Before

A typical hand-rolled recorder: resolve the store, wrap each generic write to swallow failures.

```ts
// OLD — eager resolve + generic record + per-call guard
const recordCompleted = (entry: Entry, elapsed: Duration.Duration) =>
  Effect.flatMap(Storage, (bridge) =>
    bridge.at(tag.key, contract).pipe(
      Effect.flatMap((handle) =>
        handle.record({ _tag: "Completed", entry, elapsed }),  // generic object
      ),
      // hand-rolled swallow: catch the write failure, log, succeed as void
      Effect.catchTag("StoreWriteError", (e) =>
        Effect.logWarning("store write failed", e),
      ),
    ),
  );
```

Every write site repeats the resolve + guard, and building the event object by hand against a generic
schema is exactly what forced casts.

## After

### 1. Split the contract into tiers

Build the lean base **once** with `Store.contract`, then stack each tier on top with `Store.extend` — never
rebuild the base with `Store.contract` to add a tier.

```ts
// TIER 1 — lean base: one event shape + record/events aliases
const base = Store.contract(
  { event: Store.shape(myEventSchema, Schema.Struct({ limit: Schema.optional(Schema.Number) })) },
  ({ event }) => ({
    record: event.append,
    events: event.read,
  }),
);

// TIER 2 — engine write-extension: Store.extend the base with narrow typed writes,
// each funnelling to the shared event.append
const engineContract = Store.extend(
  ({ event }) => ({
    started: (entry: Entry) => event.append({ _tag: "Started", entry }),
    completed: (entry: Entry, success: Success, elapsed: Duration.Duration) =>
      event.append({ _tag: "Completed", entry, success, elapsed }),
    failed: (entry: Entry, cause: Cause.Cause<E>, elapsed: Duration.Duration) =>
      event.append({ _tag: "Failed", entry, cause, elapsed }),
  }),
  base,
);
```

`Store.extend(methodsFn, base)` is **type-preserving**: fed the `base` alongside its methods builder, it
infers each write's exact signature and merges it as `base.custom & …`, so the concrete write-method types
survive onto the materialized effects object — a widened `Record<string, unknown>` never appears — and the
base's own `record` / `events` come through unchanged. That's why the tiers stack with `Store.extend`.

### 2. Build the recorder once with the transform layer

```ts
// NEW — pure recorder; requirement rides on each method; one guard for all writes
const store = Store.catchWriteErrors(Store.effects(tag.key, engineContract));

// store.completed(entry, success, elapsed) : Effect<void, never, Storage>
// store.failed(entry, cause, elapsed)      : Effect<void, never, Storage>
```

The engine calls `store.completed(entry, success, elapsed)` at the outcome site. No per-call resolve,
no per-call guard — `Store.effects` makes `Storage` ride each method's requirement, and
`Store.catchWriteErrors` swallows a journal/IO write hiccup across the whole object (logs at warning,
succeeds as `void`). An encode/serialization mismatch or wiring die is a **defect** and still
propagates.

Provide `Storage` once at the **layer boundary** — merge {@link Store.layerDefaultMemory} on the resource
layer (or an app `Store.Service` override via `Layer.provideMerge`). The engine `yield*`s store effects
directly; do **not** wrap each write in `Effect.provide` with a captured context.

### 3. Give consumers a read-extension

Same tier discipline — `Store.extend` the same lean `base` with analytics reads (pure derivations over
`event.read`), never a `Store.contract` rebuild:

```ts
// TIER 3 — analytics reads over the same event log, registered by app code
export const myResourceStore = (tag: MyTag) =>
  facetRegistration(tag, Store.extend(
    ({ event }) => ({
      failures: () => Effect.map(event.read(), (evs) => evs.filter((e) => e._tag === "Failed")),
      // …derivations…
    }),
    base,
  ));
```

App code registers it on a `Store.Service` and reads the analytics:

```ts
class MyStore extends Store.Service<MyStore>("@app/MyStore")(myResourceStore(MyTag)) {}
const s = yield* MyStore.at(MyTag);
const fs = yield* s.failures();
```

### 4. Discharge the impl requirement with `Resource.provideContext`

The recorder is only the store half. The resource **impl** gets the mirror-image treatment. Build every
worker method **unwrapped** — each still carrying the worker requirement `R` — then discharge it in **one**
call, the Resource counterpart to `Store.catchWriteErrors`:

```ts
const context = yield* Effect.context<R>();
return Resource.provideContext(impl, MyTag[Resource.specSym], context);
```

`Resource.provideContext` walks the impl per its spec and `Effect.provideContext`s each Effect method, so
`R` → `Exclude<R, Ctx>` uniformly — a no-op on methods that carry no `R` (`pause` / `resume` / `shutdown`),
and `Stream` / `Subscribable` members pass through untouched. It's **subtractive**: a method needing more
than the context provides keeps a residual requirement (caught at the `ImplOf` assignment) instead of a
false `never`. No per-method `Effect.provideContext(...)` wrapping. Template: `buildQueueImpl` in
`QueueResource.ts`.

## Full-capture note (outcome events)

Record the worker outcome **once**: a `Completed` **or** a `Failed` event, no redundant `Exit`.
`Failed` carries a typed `Cause<E>` (from the tag's `error` slot). If your worker is `Effect<void, …>`,
`Completed.success` is `void` today — see the honest note in [`queue-resource.md`](./queue-resource.md#full-capture--the-merged-single-outcome-event-be-precise-here).

## Related

- [`store.md`](./store.md) — `Store.effects` / `mapEffects` / `catchWriteErrors`
- [`queue-resource.md`](./queue-resource.md) — the finished three-tier reference
- [`store-backing.md`](./store-backing.md) — `StoreWriteError` semantics
</content>
