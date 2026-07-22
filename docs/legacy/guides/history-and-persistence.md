# History & persistence (metrics + logs)

Two opt-in planes share the same `yield* Tag` surface, local or over RPC:

1. **Metrics history** — `HistoryStore` backs `metrics.query` (windowed backfill).
2. **Logs** — the **`Logs`** platform (`Logs.layer` + `Logs.persistLayer(node)` → `LogStore`) plus
   per-resource read via **`Hyperlink.logs(tag)`** (local) or **`NodeStatus.logs`** +
   **`LogEntry.hasKey`** (remote). See [`docs/LOGS.md`](../../LOGS.md) for the SSOT.

> **Removed (Phase 5):** `captureLogs`, built-in `queue.logs` / `proc.logs` on handles, and
> HistoryStore `${tag.key}/logs` forks. Do not follow older snippets that set `captureLogs: true`.

## Metrics history (`HistoryStore`)

A tiny, backend-agnostic append-log — **`HistoryStore`** — captures each metrics window (keyed by
`${tag.key}/metrics`), and the queue exposes `metrics.query` next to `metrics.stream`. It's
deliberately *not* the `RuntimeStorage` facet system — just `append` + `read`. History is **opt-in**:
provide a `HistoryStore` layer to enable it; without one, capture is skipped and `metrics.query`
returns `[]`. History lives on the **same Tag** as the live stream, so it crosses RPC like any other
query.

### Enabling it

```ts
import { Layer } from "effect";
import { HistoryStore } from "hyperlink-ts";
import { QueueResource } from "hyperlink-ts/QueueResource";

const rosterQueueLayer = QueueResource.layer(RosterQueue, {
  effect,
}).pipe(Layer.provide(HistoryStore.layerMemory()));
```

- `HistoryStore.layerMemory({ capacity })` — in-memory ring (bounded, oldest dropped).
- `SQLiteHistoryStore.layer({ filename, capacity? })` (from `hyperlink-ts/storage/sqlite`)
  — durable across restarts; `capacity` is count-based retention per stream.
- No `HistoryStore` layer → metrics history is empty (zero cost, no behavior change).

### Reading metrics history

```ts
const queue = yield* RosterQueue;

yield* queue.metrics.stream;              // live windows
yield* queue.metrics.query({ limit: 200 }); // past windows (decoded queueMetrics[])
```

`metrics.query` options (all optional): `{ limit?: number; since?: DateTime.Utc; until?: DateTime.Utc }`
— newest `limit` entries within the `[since, until]` window.

## Logs platform (`Logs` + `Hyperlink.logs`)

Runtime-wide capture is **node-scoped**, not per-resource:

```ts
import * as Logs from "hyperlink-ts/Logs";
import * as Hyperlink from "hyperlink-ts/Hyperlink";
import { LogStore } from "hyperlink-ts/store/Log";
import * as ProcessStorage from "hyperlink-ts/ProcessStorage";

class Droplet extends Hyperlink.Node<Droplet>("hub/droplet") {}

const logStack = Logs.persistLayer(Droplet).pipe(
  Layer.provideMerge(Layer.mergeAll(Logs.layer, ProcessStorage.layer)),
  // or: LogStore.layerMemory / LogStore.layer({ filename })
);

// provide logStack alongside QueueResource.layer / Process.layer / httpServer
```

Engines stamp **lineage** via `Logs.withScope(tag)` at materialize. Read per-resource:

```ts
import * as LogEntry from "hyperlink-ts/LogEntry";

const { stream, query } = yield* Hyperlink.logs(RosterQueue);

stream.pipe(Stream.filter(LogEntry.hasKey(RosterQueue.key))); // relay is node-wide
const history = yield* query({ limit: 100 });                 // LogStore by lineage
```

Also:

```ts
yield* Logs.byNode(Droplet, { limit: 200 });
yield* Logs.byResource({ queueId: RosterQueue.key });
```

Authoritative key catalog and wiring: [`docs/LOGS.md`](../../LOGS.md).

### Processes

Same logs stack as queues — no `captureLogs` on the process layer:

```ts
const procLayer = Process.layer(NwslSync, { effect }).pipe(
  Layer.provideMerge(logStack),
);

const { stream, query } = yield* Hyperlink.logs(NwslSync);
yield* query({ limit: 100 });
```

### Execution analytics (`Process.store`)

**Toolkit layers only** — `Process.layer` / `serve` / `serveRemote` auto-append terminal runs.
**`Process.make`** does not; use `layer` or manual `store.record`.

Override the default in-memory store when you register the tag on an app **`Store.Service`**:

```ts
import { Layer } from "effect";
import { Process } from "hyperlink-ts";
import * as Store from "hyperlink-ts/Store";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(NwslSync),
) {}

const procLayer = Layer.provideMerge(
  AppStore.layerMemory,
  Process.layer(NwslSync, { effect, polling }),
);

const store = yield* NwslSync.store;
const events = yield* store.events({ limit: 50 });
```

## Durability (the durable queue)

History is the *observability* plane. The *durability* plane is `DurableQueueStore` — a
priority-native store so no enqueued work is lost across a restart (**at-least-once** + dedup key).
Turn it on with `persist` on the layer config + a `DurableQueueStore` backend. The tag's **`payload`**
schema must be set (config object on `QueueResource.Tag`) so items serialize:

```ts
import { SQLiteDurableQueueStore } from "hyperlink-ts/storage/sqlite";

class RosterQueue extends QueueResource.Tag<RosterQueue>()("app/Roster", { payload: RosterItem }) {}

const queueLayer = QueueResource.layer(RosterQueue, {
  effect,
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

Metrics stay on the resource Tag. **Logs do not** — remotes read **node-wide** logs and filter by
**resource key**:

```ts
import * as NodeStatus from "hyperlink-ts/NodeStatus";
import * as LogEntry from "hyperlink-ts/LogEntry";

// Host — logs stack + metrics HistoryStore
Hyperlink.httpServer([QueueResource.serve(RosterQueue, { effect })]).pipe(
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(Logs.layer),
  Layer.provide(Logs.persistLayer(Droplet)),
  Layer.provide(ProcessStorage.layer),
);

// Dashboard — metrics on the queue Tag; logs via NodeStatus + lineage
const queue = yield* RosterQueue;
const metrics = yield* queue.metrics.query({ limit: 200 });
yield* queue.metrics.stream.pipe(Stream.runForEach(chart), Effect.forkScoped);

const recent = yield* NodeStatus.logs.query({ limit: 300 });
render(recent.filter(LogEntry.hasKey(RosterQueue.key)));

yield* NodeStatus.logs.stream.pipe(
  Stream.filter(LogEntry.hasKey(RosterQueue.key)),
  Stream.runForEach(render),
  Effect.forkScoped,
);
```

Example wiring: `src/web/data.ts`, `examples/web-dashboard/queue-server.ts`.

## What exists

| Surface | Live | Durable / backfill | Notes |
|---|---|---|---|
| Queue metrics | `metrics.stream` | `metrics.query` (`HistoryStore`) | Opt-in HistoryStore |
| Queue / process logs | `Hyperlink.logs(tag).stream` (local) | `Hyperlink.logs(tag).query` / `Logs.byResource` | Needs `Logs.layer` + `persistLayer` for durable |
| Remote resource logs | `NodeStatus.logs.stream` + `LogEntry.hasKey` | `NodeStatus.logs.query` + filter | Same node store |
| Runtime-wide | `Logs.stream` | `Logs.byNode` / `Logs.byResource` | [`docs/LOGS.md`](../../LOGS.md) |

Backends: `HistoryStore.layerMemory` / `SQLiteHistoryStore.layer` for metrics; `LogStore` (memory /
SQLite via `ProcessStorage` / `layerProcessStore`) for logs.

## Custom use

`HistoryStore` is a generic keyed append-log if you want it directly:

```ts
const store = yield* HistoryStore;
yield* store.append("my-stream", encodedJson);
const rows = yield* store.read("my-stream", { limit: 100 });   // ReadonlyArray<unknown>
```
Entries are opaque JSON — encode with your schema before `append`, decode after `read`.
