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

```ts
// TIER 1 — lean base: one event shape + record/events aliases
const base = Store.contract(
  { event: Store.shape(myEventSchema, Schema.Struct({ limit: Schema.optional(Schema.Number) })) },
  ({ event }) => ({
    record: event.append,
    events: event.read,
  }),
);

// TIER 2 — engine write-extension: narrow typed writes, all funnel to event.append
const engineContract = Store.contract(
  { event: Store.shape(myEventSchema) },
  ({ event }) => ({
    record: event.append,
    events: event.read,
    started: (entry: Entry) => event.append({ _tag: "Started", entry }),
    completed: (entry: Entry, success: Success, elapsed: Duration.Duration) =>
      event.append({ _tag: "Completed", entry, success, elapsed }),
    failed: (entry: Entry, cause: Cause.Cause<E>, elapsed: Duration.Duration) =>
      event.append({ _tag: "Failed", entry, cause, elapsed }),
  }),
);
```

Build the write-extension with `Store.contract` (not `Store.extend`) so the concrete write-method types
survive onto the materialized effects object.

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

```ts
// TIER 3 — analytics reads over the same event log, registered by app code
export const myResourceStore = (tag: MyTag) =>
  facetRegistration(tag, Store.contract(
    { event: Store.shape(myEventSchema, readPayload) },
    ({ event }) => ({
      record: event.append,
      events: event.read,
      failures: () => Effect.map(event.read(), (evs) => evs.filter((e) => e._tag === "Failed")),
      // …derivations…
    }),
  ));
```

App code registers it on a `Store.Service` and reads the analytics:

```ts
class MyStore extends Store.Service<MyStore>("@app/MyStore")(myResourceStore(MyTag)) {}
const s = yield* MyStore.at(MyTag);
const fs = yield* s.failures();
```

## Full-capture note (outcome events)

Record the worker outcome **once**: a `Completed` **or** a `Failed` event, no redundant `Exit`.
`Failed` carries a typed `Cause<E>` (from the tag's `error` slot). If your worker is `Effect<void, …>`,
`Completed.success` is `void` today — see the honest note in [`queue-resource.md`](./queue-resource.md#full-capture--the-merged-single-outcome-event-be-precise-here).

## Related

- [`store.md`](./store.md) — `Store.effects` / `mapEffects` / `catchWriteErrors`
- [`queue-resource.md`](./queue-resource.md) — the finished three-tier reference
- [`store-backing.md`](./store-backing.md) — `StoreWriteError` semantics
</content>
