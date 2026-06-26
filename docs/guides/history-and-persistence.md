# History & persistence (metrics + logs)

Read back what *was* in a resource's live streams (metrics, logs). The live streams
(`yield* queue.logs`, `queue.metrics`, …) are in-memory and ephemeral; **history** is the
durable record of what flowed through them.

## The model in one paragraph

A tiny, backend-agnostic append-log — **`HistoryStore`** — captures each stream element (keyed by
`${tag.id}/<stream>`), and each resource exposes `*History` **query** methods right next to its live
stream. It's deliberately *not* the `RuntimeStorage` facet system — just `append` + `read`. History
is **opt-in**: provide a `HistoryStore` layer to enable it; without one, capture is skipped and
every `*History` returns `[]`. History lives on the **same Tag** as the live stream, so it crosses
RPC exactly like any other query.

## Enabling it

Provide a `HistoryStore` layer alongside the resource layer:

```ts
import { Layer } from "effect";
import { HistoryStore } from "@nikscripts/effect-pm";
import { QueueResource } from "@nikscripts/effect-pm/QueueContract";

const rosterQueueLayer = QueueResource.layer(RosterQueue, {
  effect,
  captureLogs: true,            // logs must be captured to have log history
}).pipe(Layer.provide(HistoryStore.layerMemory()));   // ← opt into history
```

- `HistoryStore.layerMemory({ capacity })` — in-memory ring (bounded, oldest dropped). Available now.
- SQLite / Postgres backends land later behind the **same** interface — swap the layer, nothing else.
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
const procLayer = ProcessResource.layer(NwslSync, {
  effect,
  captureLogs: true,
}).pipe(Layer.provide(HistoryStore.layerMemory()));

const proc = yield* NwslSync;
yield* proc.logs                      // live captured lines
yield* proc.logHistory({ limit: 100 }) // past captured lines
```

## Runtime-wide (HostLogs)

`HostLogs` captures **every** log in the runtime (including untagged effects and all processes).
Add `HostLogs.persistLayer` to persist them, then read `HostLogs.history`:

```ts
const layer = HostLogs.persistLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(HostLogs.layer, HistoryStore.layerMemory())),
);
// anywhere under it:
yield* HostLogs.stream                  // live, all runtime logs
yield* HostLogs.history({ limit: 200 }) // durable, all runtime logs
```

## For a dashboard

Same Tag, two reads: **`status`/`metrics`/`logs` for live**, **`*History` for backfill**. A typical
panel: paint `logHistory({ limit })` once, then follow the `logs` stream. Both come from
`yield* queue` (or `Resource.client(queue)` remotely) — the dashboard never touches the store.

## What exists / what's coming

| Surface | Live | History | Notes |
|---|---|---|---|
| Queue | `logs`, `metrics` | `logHistory`, `metricsHistory` | **done** (needs `captureLogs` for logs) |
| Process | `logs` | `logHistory` | **done** (needs `captureLogs`) |
| Runtime-wide (`HostLogs`) | `HostLogs.stream` | `HostLogs.history` | **done** — captures *all* runtime logs (incl. untagged + processes); add `HostLogs.persistLayer` |

Backends: `layerMemory` now → SQLite → Postgres (same `HistoryStore` interface) — **next**.

## Custom use

`HistoryStore` is a generic keyed append-log if you want it directly:

```ts
const store = yield* HistoryStore;
yield* store.append("my-stream", encodedJson);
const rows = yield* store.read("my-stream", { limit: 100 });   // ReadonlyArray<unknown>
```
Entries are opaque JSON — encode with your schema before `append`, decode after `read`.
