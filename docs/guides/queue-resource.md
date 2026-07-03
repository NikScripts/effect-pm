# QueueResource

A **queue** is a managed three-level priority worker pool (`high`, `normal`, `low`). You provide an
**`effect`** that processes one item; the runtime handles concurrency, dedup, retry, pause/resume,
optional schema validation, observability, and (opt-in) durability. It's a location-transparent
`Resource` — the same `yield* Tag` drives it local or over RPC.

## Define

```ts
import { Effect, Schema } from "effect";
import { QueueResource } from "@nikscripts/effect-pm/QueueResource";

const Job = Schema.Struct({ id: Schema.String });
class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/RosterQueue", Job) {}
```

- **`QueueResource.layer(Tag, config)`** — local layer (auto-starts workers).
- **`QueueResource.serveHttp(Tag, config)`** / **`server`** — host it over RPC.
- **`QueueResource.make(config)`** — scoped engine handle, for tests / low-level composition.
- **`Resource.client(Tag)`** — remote handle (dashboard).

## Config

| Field | Purpose |
|---|---|
| `effect: (item, ctx) => Effect<void, E, R>` | Process one item (required). |
| `itemSchema` | Validate enqueue + enable encoded handoff / `persist`. |
| `concurrency` | Max items processing at once (default 5). |
| `rateLimit` | Effect `RateLimiter` options applied before the concurrency gate. |
| `attempts` | Auto re-enqueue failed items up to N. |
| `onFailure: (entry, cause) => Effect<disposition>` | Per-error disposition (`retry`/`deadLetter`/`drop`/`default`). The one control callback. |
| `key: (item) => string` | Dedup key (skips items already in flight). |
| `captureLogs` | Capture engine + worker logs into the `logs` stream (`true` or `{ level }`). |
| `autoStart` / `paused` / `shutdownMode` | Worker pool startup + shutdown behavior. |
| `refill` | Self-feed from a source — see below. |
| `persist` | Durability — see below. |

## Handle surface (`yield* Tag`)

- **Enqueue:** `add` / `prioritize` / `defer` (item or batch), `enqueue` (re-inject full entries),
  `release` / `releaseEncoded` (export pending for handoff), `deadLetter` / `drop` (by selector).
- **State:** `size` / `sizes` / `isEmpty` / `completed`.
- **Lifecycle:** `start` / `pause` / `resume` / `shutdown` / `clear`.
- **Observe:** `status` / `statusNow`, `metrics`, `logs`, `events` (live streams) and
  `logHistory` / `metricsHistory` (durable backfill — see
  [history-and-persistence.md](./history-and-persistence.md)).

## Self-refill

Load work from a source on start and/or whenever the queue drains (a self-feeding queue):

```ts
QueueResource.layer(RosterQueue, {
  effect,
  refill: { onStart: true, onDrained: true, load: (queue) => loadFromDb(queue) },
});
```

`load` receives the handle and runs best-effort. It may require services the worker `effect` **doesn't**
— e.g. a repository or DB the workers never touch. Those are folded into the layer's requirement `R` (the
**union** of the worker's and the refill's services), so provide them all; the refill isn't constrained to
the worker's dependencies. `onStart` is forked; `onDrained` re-polls after each drain (idles when `load`
enqueues nothing). (Regression: `test/queue-refill-deps.test.ts`.)

## Durability (`persist`)

```ts
import { SQLiteDurableQueueStore } from "@nikscripts/effect-pm/storage/sqlite";

QueueResource.layer(RosterQueue, { effect, itemSchema: Job, persist: { maxAttempts: 3 } })
  .pipe(Layer.provide(SQLiteDurableQueueStore.layer({ filename: "queue.db" })));
```

When on (requires `itemSchema`), the store is the source of truth: enqueue persists, a feeder leases
work into the workers, and a restart recovers in-flight work (at-least-once + dedup). Off by default.

## See also

- [toolkit-by-example.md](./toolkit-by-example.md) — full patterns (local, remote, instances, UI)
- [history-and-persistence.md](./history-and-persistence.md) — history + the durable queue
- [resource-configure.md](./resource-configure.md) — per-env `.configure` overrides
