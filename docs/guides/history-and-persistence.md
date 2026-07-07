# History & persistence (metrics + logs)

Read back what *was* in a resource's live streams (metrics, logs). The live streams
(`yield* queue.logs`, `queue.metrics`, …) are in-memory and ephemeral; **history** is the
durable record of what flowed through them.

## The model in one paragraph

A tiny, backend-agnostic append-log — **`HistoryStore`** — captures each stream element (keyed by
`${tag.key}/<stream>`), and each resource exposes `*History` **query** methods right next to its live
stream. It's deliberately *not* the `RuntimeStorage` facet system — just `append` + `read`. History
is **opt-in**: provide a `HistoryStore` layer to enable it; without one, capture is skipped and
every `*History` returns `[]`. History lives on the **same Tag** as the live stream, so it crosses
RPC exactly like any other query.

## Enabling it

Provide a `HistoryStore` layer alongside the resource layer:

```ts
import { Layer } from "effect";
import { HistoryStore } from "@nikscripts/effect-pm";
import { QueueResource } from "@nikscripts/effect-pm/QueueResource";

const rosterQueueLayer = QueueResource.layer(RosterQueue, {
  effect,
  captureLogs: true,            // logs must be captured to have log history
}).pipe(Layer.provide(HistoryStore.layerMemory()));   // ← opt into history
```

- `HistoryStore.layerMemory({ capacity })` — in-memory ring (bounded, oldest dropped).
- `SQLiteHistoryStore.layer({ filename, capacity? })` (from `@nikscripts/effect-pm/storage/sqlite`)
  — durable across restarts; `capacity` is count-based retention per stream. Same interface, swap
  the layer:
  ```ts
  import { SQLiteHistoryStore } from "@nikscripts/effect-pm/storage/sqlite";
  // …Layer.provide(SQLiteHistoryStore.layer({ filename: "history.db", capacity: 10_000 }))
  ```
- Postgres lands later behind the same interface.
- No `HistoryStore` layer → history is empty (zero cost, no behavior change).

## Reading history

The `*History` methods are plain queries on the resource Tag — same `yield* Tag` surface, local or
remote:

```ts
const queue = yield* RosterQueue;

// live (ephemeral)
yield* queue.logs       // Stream
yield* queue.metrics    // Stream

// history (durable, opt-in)
yield* queue.logHistory({ limit: 200 })          // past log lines (decoded queueLogEntry[])
yield* queue.metricsHistory({ since, until })    // past metric windows (queueMetrics[])
```

`*History` options (all optional): `{ limit?: number; since?: DateTime.Utc; until?: DateTime.Utc }`
— newest `limit` entries within the `[since, until]` window.

## Processes

Same shape as the queue — set `captureLogs` on the process layer, provide a `HistoryStore`:

```ts
const procLayer = Process.layer(NwslSync, {
  effect,
  captureLogs: true,
}).pipe(Layer.provide(HistoryStore.layerMemory()));

const proc = yield* NwslSync;
yield* proc.logs.live                    // live captured lines
yield* proc.logs.history({ limit: 100 }) // past captured lines
```

### Execution analytics (`Process.store`)

On **`Process.layer`**, finished runs auto-append to **`Process.store(tag)`** when the app registers
the tag on a `Store.Service` and provides **`StoreScopeBridgeTag`**. Query via `yield* Tag.store`.

```ts
import { Layer } from "effect";
import { Process } from "@nikscripts/effect-pm";
import * as Store from "@nikscripts/effect-pm/Store";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(NwslSync),
) {}

const procLayer = Process.layer(NwslSync, { effect, polling }).pipe(
  Layer.provide(AppStore.layerMemory),
);

const store = yield* NwslSync.store;
const events = yield* store.events({ limit: 50 });
```

## Runtime-wide (HostLogs)

`HostLogs` captures **every** log in the runtime (including untagged effects and all processes) — live
via `HostLogs.stream`, and **durably** via `HostLogs.persistLayer(host)`, queryable **by host** or **by
resource**.

```ts
const HostLive = myHost.pipe(
  Effect.provide(HostLogs.layer),                    // live capture + relay (the `stream`)
  // provideMerge, not provide: persistLayer installs a logger and provides no service, so a bare
  // provide would be pruned as unused.
  Layer.provideMerge(HostLogs.persistLayer("wnba")), // durable, bucketed by this host
  Effect.provide(ProcessStorage.layer),              // backs LogStore (swap for sqlite/redis)
);
```

`persistLayer(host)` installs a batched capture logger: it builds a structured entry, stamps it with
the `host` annotation while preserving each line's `processId` / `queueId`, and writes batches (Effect
`Stream.groupedWithin`) into `LogStore` — backed by `RuntimeStorage` (memory / sqlite / redis via
`ProcessStorage`). Because the logger is installed at layer-build, it captures every line from the start
(no relay-subscription race).

Then read the stored logs two ways — both return `[]` (not an error) when nothing matches, newest
first:

```ts
yield* HostLogs.stream                                     // live, all runtime logs
yield* HostLogs.byHost("wnba", { limit: 200 })             // durable — everything this host logged
yield* HostLogs.byResource({ queueId: "wnba/BoxScoreQueue" }) // durable — one resource, across hosts
```

`byHost` filters the host bucket; `byResource` filters the `processId` / `queueId` annotation (so it
spans hosts). Both take `{ limit?, sort?, from?, to? }`. A host's served `HostStatus.logHistory`
(what the dashboard reads) is backed by the same store.

## Durability (the durable queue)

History is the *observability* plane. The *durability* plane is `DurableQueueStore` — a
priority-native store so no enqueued work is lost across a restart (**at-least-once** + dedup key).
Turn it on with `persist` + a backend layer (+ `itemSchema`, since the payload must serialize):

```ts
import { SQLiteDurableQueueStore } from "@nikscripts/effect-pm/storage/sqlite";

const queueLayer = QueueResource.layer(RosterQueue, {
  effect,
  itemSchema: RosterItem,           // required for persist
  persist: { maxAttempts: 3 },      // or `true` for defaults
}).pipe(Layer.provide(SQLiteDurableQueueStore.layer({ filename: "queue.db" })));
```

When on, the store is the **source of truth**: enqueue persists, a feeder leases work into the
workers, success/failure update the store (retry → requeue, `maxAttempts` → dead-letter), and a
restart **recovers in-flight work**. `size`/`sizes`/`isEmpty`/`status` and shutdown-drain reflect
the store. Off by default (in-memory only) — and the in-memory path is unchanged.

**Control verbs** (`release` / `deadLetter` / `drop`) operate on the durable **backlog** — select by
`entryId` or `key` (item-reference selectors don't survive serialization; in-flight/leased work is
left to the workers). So a dashboard's "drop / dead-letter this item" actions work on a persisted
queue, not just an in-memory one.

## For a dashboard (query-then-tail, over RPC)

Same Tag, two reads: **`status`/`metrics`/`logs` for live**, **`*History` for backfill**. The
dashboard never touches the store — it talks to the served resource through `Resource.client`, and
the host owns persistence. This is the proven path (`test/queue-remote-http.test.ts`).

**Host (Droplet/Mini)** — serve the resource with capture + a history backend:

```ts
Resource.httpServer([QueueResource.serve(RosterQueue, { effect, captureLogs: true })])
  .pipe(Layer.provide(HistoryStore.layerMemory())); // or SQLiteHistoryStore.layer({ filename })
```

**Dashboard (browser/Next.js)** — a remote client; same `yield* Tag` surface:

```ts
const queue = yield* RosterQueue; // resolved from Resource.client(RosterQueue)

// 1) backfill once
const recent = yield* queue.logHistory({ limit: 200 });
render(recent);

// 2) then tail live (no gap, no store access)
yield* queue.logs.pipe(Stream.runForEach(render), Effect.forkScoped);

// live KPIs: poll statusNow, or follow the status/metrics streams
const status = yield* queue.statusNow;             // { sizes, inFlight, completed, phase }
yield* queue.metrics.pipe(Stream.runForEach(chart), Effect.forkScoped);
```

`logHistory` / `metricsHistory` are plain `query` verbs and cross RPC like `statusNow`; `logs` /
`metrics` / `status` are streams over the same transport. Runtime-wide logs use `HostLogs.byHost` /
`HostLogs.byResource` + `HostLogs.stream` the same way.

## What exists / what's coming

| Surface | Live | History | Notes |
|---|---|---|---|
| Queue | `logs`, `metrics` | `logHistory`, `metricsHistory` | **done** (needs `captureLogs` for logs) |
| Process | `logs` | `logHistory` | **done** (needs `captureLogs`) |
| Runtime-wide (`HostLogs`) | `HostLogs.stream` | `HostLogs.byHost` / `HostLogs.byResource` | **done** — captures *all* runtime logs (incl. untagged + processes); add `HostLogs.persistLayer(host)` for durable, host/resource-queryable storage |

Backends: `layerMemory` (in-process) and `SQLiteHistoryStore.layer` (durable) ship today; Postgres
later (same `HistoryStore` interface).

## Custom use

`HistoryStore` is a generic keyed append-log if you want it directly:

```ts
const store = yield* HistoryStore;
yield* store.append("my-stream", encodedJson);
const rows = yield* store.read("my-stream", { limit: 100 });   // ReadonlyArray<unknown>
```
Entries are opaque JSON — encode with your schema before `append`, decode after `read`.
