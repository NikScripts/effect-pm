# QueueResource

A **queue** is a managed three-level priority worker pool (`high`, `normal`, `low`). You provide an
**`effect`** that processes one item; the runtime handles concurrency, dedup, retry, pause/resume,
optional schema validation, observability, and (opt-in) durability. It's a location-transparent
`Resource` — the same `yield* Tag` drives it local or over RPC.

It is also the **golden `Store` example**: its lifecycle event log is a full three-tier `Store`
contract (lean base → engine write-extension → consumer analytics read-extension). If you are wiring
`Store` into a resource of your own, copy this. See [`store.md`](./store.md) for the machinery and
[`store-migration.md`](./store-migration.md) for the before/after.

## Define

```ts
import { Effect, Schema } from "effect";
import { QueueResource } from "@nikscripts/effect-pm/QueueResource";

const Job = Schema.Struct({ id: Schema.String });
class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/RosterQueue", { payload: Job }) {}
```

- **`QueueResource.layer(Tag, config)`** — local layer (auto-starts workers).
- **`QueueResource.serve(Tag, config)`** / **`serveRemote`** — host it over RPC.
- **`QueueResource.make(config)`** — scoped engine handle, for tests / low-level composition.
- **`Resource.client(Tag)`** — remote handle (dashboard).

### Typed outcome slots (`success` / `error`)

The config-object form of the tag declares the worker's **outcome wire schemas** — these type the
worker's return, the lifecycle event log, and (in turn) the store analytics:

```ts
class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/RosterQueue", {
  payload: Job,
  error: RosterError,       // → Failed.cause is Cause<RosterError>, not Cause<unknown>
  success: RosterResult,    // → worker MUST return Effect<RosterResult, …>; Completed.success is RosterResult
}) {}
```

## Config

| Field | Purpose |
|---|---|
| `effect: (item, ctx) => Effect<A, E, R>` | Process one item (required). `A` is the tag's `success` schema type, or **`void`** when no `success` is declared (see Full-capture). |
| `payload` (on **Tag** config object) | Item schema SSOT — validates enqueue, wire, store, and durability. Not repeated on `layer()` config. |
| `concurrency` | Max items processing at once (default 5). |
| `rateLimit` | Effect `RateLimiter` options applied before the concurrency gate. |
| `attempts` | Auto re-enqueue failed items up to N. |
| `onFailure: (entry, cause) => Effect<disposition>` | Per-error disposition (`retry`/`deadLetter`/`drop`/`default`). |
| `key: (item) => string` | Dedup key (skips items already in flight). |
| `captureLogs` | Capture engine + worker logs into the `logs` stream (`true` or `{ level }`). |
| `autoStart` / `paused` / `shutdownMode` | Worker pool startup + shutdown behavior. |
| `refill` | Self-feed from a source — see below. |

## Handle surface (`yield* Tag`)

- **Enqueue:** `add` / `prioritize` / `defer` (item or batch), `enqueue`, `release` / `releaseEncoded`,
  `deadLetter` / `drop`.
- **State:** `size` / `sizes` / `isEmpty` / `completed`.
- **Lifecycle:** `start` / `pause` / `resume` / `shutdown` / `clear`.
- **Observe:** `status` / `statusNow`, `metrics`, `logs`, `events` (live streams) and
  `logHistory` / `metricsHistory` (durable backfill).

## Self-refill

```ts
QueueResource.layer(RosterQueue, {
  effect,
  refill: { onStart: true, onDrained: true, load: (queue) => loadFromDb(queue) },
});
```

`load` receives the handle and runs best-effort. It may require services the worker `effect` **doesn't**;
those are folded into the layer's requirement `R` (the **union** of worker + refill services).

## Durability

Durability is **presence-driven** — provide a `DurableQueueStore` layer and declare **`payload`** on the
tag — the queue's *work* becomes durable:

```ts
import { SQLiteDurableQueueStore } from "@nikscripts/effect-pm/storage/sqlite";

class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/RosterQueue", { payload: Job }) {}

QueueResource.layer(RosterQueue, { effect })
  .pipe(Layer.provide(SQLiteDurableQueueStore.layer({ filename: "queue.db" })));
```

The store is then the source of truth: enqueue persists, a feeder leases work into the workers, and a
restart recovers in-flight work (at-least-once + dedup). This is distinct from the **event-log store**
below (the observability plane).

---

# The queue `Store` — the golden three-tier example

Every queue records its **lifecycle events** into a `Store`. The contract is built in three tiers, each
for a different audience. The observability store is **baked in** (in-memory default), so it works with
zero configuration; register `QueueResource.store(tag)` on an app `Store.Service` to get durable,
queryable analytics.

## Full-capture — the merged single-outcome event (be precise here)

The worker's outcome is recorded **exactly once** (single source of truth), no duplication:

- `Completed { entry, success, elapsed }` — the run succeeded.
- `Failed { entry, cause, elapsed }` — the run failed, carrying a **typed `Cause<E>`** (from the tag's
  `error` wire slot).

There is **no separate `Exit` event**: `Completed` vs `Failed` already encodes success-vs-failure, and a
consumer can reconstruct `Exit<A, E>` from the two if needed. The engine captures the worker's real
result at the source (`exit.value` / `exit.cause`) and threads it straight in — analytics read the typed
value off `Completed` / `Failed` with no separate Exit handling.

**Typed success.** When the tag declares a `success` schema, the worker `effect` is **required** to return
`Effect<A, E, R>` (`A` = the schema's type), and `Completed.success` carries that typed `A` — threaded through
the whole stack: worker return → `success: exit.value` → `completed(entry, success, elapsed)` write → the
`slowest` / analytics reads. With **no** `success` schema the worker stays `Effect<void, E, R>` (fire-and-forget)
and `Completed.success` is `void`. Typed **error** capture (`Failed.cause: Cause<E>`) is live the same way —
declare `error` on the tag.

One type-system caveat: the **RPC / consumer-facing `events` stream** types `Completed.success` as `unknown`
(the runtime value is the real `A`) — `ResourceTag` is spec-invariant and Effect can't reduce a union's `.Type`
through a generic field. The typed `A` lands everywhere else: the worker return, the engine event,
`store.completed`, and the `QueueResource.store` analytics (`slowest` / `lastFailure` / …).

## Tier 1 — lean base (`record` / `events`)

One `event` shape over the shared `queueEvent(payloadSchema, { success, error })` schema — the *same*
union the live `.events` stream carries (one event model for wire + persistence). Two custom methods:

- `record(event)` — append a fully-formed lifecycle event.
- `events({ limit? })` — read them back (decoded).

No event model of its own, no object construction against a generic schema.

## Tier 2 — engine write-extension (narrow typed writes)

The engine never builds a `QueueEvent` object and calls generic `record`. It extends the base with
**narrow, semantic writes**, each taking only its own fields and funnelling to the shared `event.append`:

| Write | Signature |
|-------|-----------|
| `enqueued` | `(entries, priority, batchId?)` |
| `started` | `(entry)` |
| `completed` | `(entry, success, elapsed)` |
| `failed` | `(entry, cause, elapsed)` — typed `Cause<E>` |
| `retryScheduled` | `(entry, cause, nextAttempt)` |
| `retryExhausted` | `(entry, cause)` |

`engineQueueStoreContract(tag)` is the **lean base `Store.extend`-ed** with these writes — never a
`Store.contract` rebuild. Because `extend` is fed the `base` alongside its methods builder, each write keeps
its exact signature (the concrete-preservation guarantee), so `Store.effects` materializes
`completed: (entry, success, elapsed) => Effect<void, StoreWriteError, Storage>`, never a widened
`Record<string, unknown>`:

```ts
// Inside engineQueueStoreContract, conceptually:
const engineContract = Store.extend(
  ({ event }) => ({
    enqueued: (entries: ReadonlyArray<Entry>, priority: Priority, batchId?: string) =>
      event.append({ _tag: "Enqueued", entries, priority, ...(batchId ? { batchId } : {}) }),
    started: (entry: Entry) => event.append({ _tag: "Started", entry }),
    completed: (entry: Entry, success: Success, elapsed: Duration.Duration) =>
      event.append({ _tag: "Completed", entry, success, elapsed }),
    failed: (entry: Entry, cause: Cause.Cause<E>, elapsed: Duration.Duration) =>
      event.append({ _tag: "Failed", entry, cause, elapsed }),
    // retryScheduled / retryExhausted …
  }),
  base, // the Tier-1 lean base (event shape → record / events)
);
```

The engine builds its recorder over that contract with the transform layer — this is the pattern to copy:

```ts
// Inside QueueResource.layer, conceptually:
const storeEffects = Store.catchWriteErrors(
  Store.effects(tag.key, engineQueueStoreContract(tag)),
);
// storeEffects.completed(entry, success, elapsed) : Effect<void, never, Storage>
```

`Store.effects` builds the pure recorder (every write carries `Storage` + `StoreWriteError`);
`Store.catchWriteErrors` logs + swallows a journal/IO write hiccup so a store failure **never breaks
the queue** — an encode/wiring **defect** still propagates. Queue-level facts without a narrow write
(`Start` / `Drained` / `Cleared` / …) ride the base `record`.

## Tier 3 — consumer analytics read-extension

`QueueResource.store(queue)` is the registration app code puts on a `Store.Service`. It is the lean
base **plus** advanced analytics reads — pure derivations over the persisted event log. Internally it is
the same lean base `Store.extend`-ed with the analytics reads, so the concrete read signatures are
preserved exactly like Tier 2 (base = `Store.contract`, every tier = `Store.extend`):

```ts
class Jobs extends QueueResource.Tag<Jobs>()("@app/Jobs", jobSchema) {}

class JobsStore extends Store.Service<JobsStore>("@app/JobsStore")(
  QueueResource.store(Jobs),
) {}

const program = Effect.gen(function* () {
  const store = yield* JobsStore.at(Jobs);
  const rate = yield* store.failureRate();
  const worst = yield* store.slowest(5);
});
```

`QueueResource.store(queue, additions)` adds app-specific shapes on top of base + analytics (each
addition gets its own `.append` / `.read`):

```ts
QueueResource.store(Jobs, {
  campaignAudit: Schema.Struct({ campaignId: Schema.String, note: Schema.String }),
});
// → yield* store.campaignAudit.append({ campaignId, note })  alongside all analytics reads
```

### The analytics reads

Given `const store = yield* JobsStore.at(Jobs)`:

| Read | Result | Example |
|------|--------|---------|
| `failures()` | `ReadonlyArray<Failed>` | `const fs = yield* store.failures()` |
| `deadLettered()` | `ReadonlyArray<Entry>` (from `RetryExhausted`) | `const dl = yield* store.deadLettered()` |
| `inFlight()` | `ReadonlyArray<Entry>` (`Started` with no terminal) | `const live = yield* store.inFlight()` |
| `history(entryId)` | `ReadonlyArray<Event>` (all events for one entry) | `const h = yield* store.history("j2")` |
| `lastFailure()` | `Option<Failed>` | `const last = yield* store.lastFailure()` |
| `slowest(n)` | `ReadonlyArray<Completed>` by `elapsed` desc | `const worst = yield* store.slowest(3)` |
| `recent(n)` | last `n` `Event`s | `const tail = yield* store.recent(20)` |
| `since(when)` | events whose entry was enqueued at/after `when: DateTime` | `const day = yield* store.since(cutoff)` |
| `stats()` | `{ enqueued, started, completed, failed, retried, deadLettered }` | `const s = yield* store.stats()` |
| `failureRate()` | `number` — `failed / (completed + failed)`, `0` if none | `const r = yield* store.failureRate()` |
| `latency()` | `{ mean, p50, p95, p99, max }` (over `Completed.elapsed`) | `const l = yield* store.latency()` |
| `changes()` | live `Stream<Event, StoreJournalDecodeError, Storage>` | `store.changes().pipe(Stream.take(2))` |

`Failed` / `Completed` / `Entry` / `Event` are the decoded members of the queue event union for this
tag — `Failed.cause` is the typed `Cause<E>`, and `Completed.success` is the tag's typed `success` schema (or `void` if none) (see Full-capture).

Real usage of every read is exercised in `test/queue-store-analytics.test.ts`.

### Durable analytics

`JobsStore.layerMemory` keeps the analytics in-process; `JobsStore.layer({ filename })` persists the
event log to SQLite so analytics survive restarts. Same tag → an app store layer overrides the queue's
baked-in in-memory default.

## The impl side — one `Resource.provideContext`

The three-tier contracts are only half the golden model. The queue's resource **impl** uses the
mirror-image primitive. `buildQueueImpl` constructs every worker method **unwrapped** — each still carrying
the worker requirement `R | RR` — then discharges it in a single call:

```ts
const context = yield* Effect.context<R | RR>();
return Resource.provideContext(impl, tag[Resource.specSym], context);
```

`Resource.provideContext` is the Resource counterpart to `Store.catchWriteErrors` — a one-liner over
`Resource.mapEffects` that `Effect.provideContext`s every Effect method uniformly (`R` → `Exclude<R, Ctx>`),
a no-op on the ones carrying no `R` (`start` / `pause` / `resume` / `shutdown`), and leaving `Stream` /
`Subscribable` members (`status` / `size` / `isEmpty` / `events`) untouched. It's **subtractive**: whatever
the context doesn't cover survives as a residual requirement (caught at the `ImplOf` assignment), never
falsely claimed `never`. One call — no per-method `Effect.provideContext(...)` wrapping.

## See also

- [`store.md`](./store.md) — the `Store` machinery (`contract` / `effects` / `mapEffects` / `catchWriteErrors`)
- [`store-migration.md`](./store-migration.md) — old tap/bridge → this three-tier pattern
- [`store-backing.md`](./store-backing.md) — EventJournal + `StoreWriteError` semantics
- [toolkit-by-example.md](./toolkit-by-example.md) — full queue patterns (local, remote, instances, UI)
- [history-and-persistence.md](./history-and-persistence.md) — history + the durable work queue
- [resource-configure.md](./resource-configure.md) — per-env `.configure` overrides
</content>
