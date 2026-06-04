# 20 — ProcessStore split, telemetry without storage, unified Protocol

**Status:** architecture decision record (Jun 2026). Owner sign-off required before
implementation slices.

**Related:** [17-facet-telemetry-factory.md](./17-facet-telemetry-factory.md),
[19-transport-boundaries.md](./19-transport-boundaries.md),
[06-runtime-hooks-config.md](./06-runtime-hooks-config.md),
[STORAGE.md](../STORAGE.md).

---

## Problem

`ProcessStore.Service` bundles concerns that have different dependency graphs:

| Concern | Today | Depends on |
| --- | --- | --- |
| Telemetry emit tree | Required facet section | `RuntimeStorage` (via spine in `make`) |
| Durable queries | Required facet section | `RuntimeStorage` |
| Registry / remote reads | `ProcessStore.registry`, `layerRemote` | Transport + storage |
| Live projections | Not first-class; implied by “read same service” | Unclear |
| Mutable config / operational state | Planned inside facets (06, 13) | Storage, not telemetry |

**Symptoms:**

- Telemetry cannot run without a store layer (facet `make` requires spine).
- Live reads (projections) and durable reads (archive) compete for one service shape.
- Transport code duplicated `RpcServer.Protocol` as `StoreTransportProtocol`.
- “Store” in the name suggests persistence, but the factory owns emit + network too.

---

## Decision 1 — Split the facet stack

Replace the monolithic facet class with **composable modules** per domain
(`QueueResource`, `ProcessExecution`, …):

```text
Telemetry.*          emit API (schemas + wire ids)     — no storage in R
Archive.*Store       durable persist + query/for       — RuntimeStorage in R
Projection.*         live derived reads + optional watch — hub subscriber in R
```

Public domain export shape (example):

```ts
export namespace QueueResource {
  export { QueueTelemetry } from "./queueTelemetry"
  export { QueueResourceStore } from "./queueArchive"   // name TBD
  export { QueueProjection } from "./queueProjection"   // optional layer
}
```

**Delete the rule:** “every facet must declare telemetry + query in one
`ProcessStore.Service` class.”

### Rename direction

| Today | Honest role |
| --- | --- |
| `ProcessStore` | Shrinks to **archive builder** + registry, or split into `Archive` + `ArchiveRegistry` |
| `ProcessStorage` | **`ProcessArchive`** (or `RuntimeArchive`) — merges **archive layers only** |
| `*Store` facet classes | **Archive facets** — persist sink + reads; may omit telemetry entirely (`LogStore`) |
| `ProcessStore.telemetry(...)` | Top-level **`Telemetry`** factory (plan 17), not a ProcessStore section |

---

## Decision 2 — Telemetry works without a store

### Model: hub + sinks (fan-out)

Telemetry emit is **not** `spine.create`. It is:

1. Validate payload against event schema (runtime).
2. Build **domain event** value + wire metadata.
3. Fan-out to zero or more **sinks** registered on a `TelemetryHub` (or per-domain hub).

```ts
yield* QueueTelemetry.Entry.Enqueued({ ... })
// R = TelemetryHub only (always)
// sinks (optional layers):
//   ArchiveSink(QueueResourceStore)  → RuntimeStorage.create
//   ProjectionSink(QueueProjection)  → update in-memory index
//   BroadcastSink(telemetryTransport)  → push to subscribers
//   MetricsSink(...)                 → future
```

**No store layer:** omit `ArchiveSink` — emit + projection + broadcast still work.

**Store layer only:** provide `ArchiveSink` — no projection required.

Static emit path (kernel):

```ts
ProcessExecutionTelemetry.Execution.Completed  // Effect<void, E, TelemetryHub>
```

not `yield* ProcessExecutionStore` merged emit+read instance.

### Persist sink is optional, not built-in

Plan 17’s “store leg” becomes an explicit sink implementation:

```ts
Telemetry.event("Enqueued", schema).pipe(
  Telemetry.sink(archivePersistLeg(encodeRow)),
)
```

Archive facet owns **encode row + predicates**; telemetry owns **when** emit fires.

---

## Decision 3 — Live projections (read/write split)

### The mistake to avoid

One `Context.Service` that both **emits** and **answers live queries** forces:

- circular layers (read API needs write side initialized),
- ambiguous source of truth (projection vs archive),
- coupling tests (cannot test emit without storage).

### Correct split

| Path | API home | Source of truth |
| --- | --- | --- |
| Write | `Telemetry.*` | Hub (event occurred) |
| Live read | `Projection.*` | In-memory derived state |
| Durable read | `Archive.*Store` | `RuntimeStorage` |
| Live stream to UI | `telemetryTransport` | Hub broadcast sink |

Example queue depth:

```ts
// kernel write
yield* QueueTelemetry.Entry.Enqueued(...)

// dashboard “now”
yield* QueueProjection.depth(queueId)

// dashboard history
yield* QueueResourceStore.entries({ queueId })
```

### Dependency order (layers)

Bottom → top:

```text
1. RuntimeStorage                    (optional)
2. Archive.*Store.layerRuntimeStorage (optional, needs 1)
3. Projection.*.layer                 (optional, in-memory)
4. TelemetryHub.layer                 (registers sinks from 2–3 + transport)
5. telemetryTransport.serverLayer     (optional broadcast sink)
6. storeTransport.serverLayer         (archive registry only)
7. Domain kernel                      (yield* Telemetry.* only)
```

**Bootstrap edge case:** projection cold start may **hydrate once** from archive
(`Archive.entries` scan at layer init). That dependency is **layer construction
order**, not emit-time:

```text
Projection.layer.pipe(
  Layer.provide(Archive.layer),
  Layer.provide(RuntimeStorage.layer),
)
```

Emit path never calls `Projection.read` or `Archive.read`.

### Read + write “same domain” without same service

Share **schemas and wire ids** (single definition on telemetry tree); **do not**
share one service tag for emit and live read.

---

## Decision 4 — Non-telemetry persistence (unbundle from facets)

These belong on **Archive** modules, not telemetry:

| Data | Module | Notes |
| --- | --- | --- |
| Durable log rows | `LogStore` | Capture/relay writes archive; no telemetry tree required |
| Execution / lifecycle / queue facts | `*Store` archive facets | Queries over append-only rows |
| Mutable runtime config | `*ConfigStore` or archive facet section | plan 06 — CRUD-ish, not emit |
| Rate-limit counters | operational archive facet | plan 13 — may use `transaction` |
| Schedule identity | archive or scoped service | plan 07 |

Rule: **if it is primarily queried as rows, it is archive — not telemetry.**

Telemetry may *produce* rows (via persist sink), but archive APIs do not require
telemetry to exist.

---

## Decision 5 — One `RpcServer.Protocol` everywhere

### Principle

- **Do not** define `StoreTransportProtocol`, `ControlTransportProtocol`, etc.
- **Do** use Effect’s `RpcServer.Protocol` / `RpcClient.Protocol` and official
  layers: `layerProtocolWebsocket`, `layerProtocolHttp`, `layerNdjson`, …
- Domain transports own **message schemas + dispatch loops** (store-transport
  *shape*), not custom protocol tags.

Delete `layerProtocolFromRpc` bridges — they exist only because we forked Protocol.

### One Protocol service, multiple dispatchers

`Protocol.run` accepts **one handler**. Options:

| Topology | When |
| --- | --- |
| **A. Demux handler** — one WS connection, route `FromClient` by domain prefix / envelope tag | Single dashboard socket |
| **B. Path-scoped servers** — `/ws/store`, `/ws/control`, each `run` in scoped fiber, same `Protocol` layer per mount | Simpler routing; official HTTP/WS routers |

Both use the same `RpcServer.Protocol` type and official adapter layers.

Recommended v1: **B** (path-scoped) — minimal multiplexer code, aligns with
`layerProtocolWebsocketRouter`.

Each domain server loop is a fork of `makeNoSerialization` pattern (store already
does this) but takes `RpcServer.Protocol` directly.

### Client side

One `RpcClient.Protocol` layer per connection; domain clients (`storeTransport`,
`controlTransport`, …) share serialization + socket, differ in encode/decode +
dispatch tags.

---

## Migration phases (suggested)

1. **Introduce `TelemetryHub` + optional sinks** — emit works with hub only; persist
   sink wraps existing spine create.
2. **Extract archive facets** — query/for without required telemetry section;
   `LogStore` as template for telemetry-free archive.
3. **Add `Projection` module** — one pilot (`QueueProjection.depth`).
4. **Unify Protocol** — remove `StoreTransportProtocol`; store server uses
   `RpcServer.Protocol`.
5. **Shrink `ProcessStore`** — registry + archive builder only; update plan 17
   slices to target new modules.
6. **Rename files** — camelCase modules per [19](./19-transport-boundaries.md).

---

## Open questions

1. **Hub scope** — one global `TelemetryHub` vs per-group/per-process hub tags?
2. **Projection consistency** — strong (apply before ack persist) vs eventual
   (broadcast before SQLite commit)?
3. **Registry** — stay on archive builder or move to `storeTransport` only?
4. **Breaking rename** — `ProcessStore` → `Archive` in same release as plan 17 wire
   break, or two releases?

---

## Acceptance checks

- [ ] `yield* QueueTelemetry.*` runs with **only** `TelemetryHub.layer` provided.
- [ ] Archive queries run with **only** `RuntimeStorage` + archive layer — no hub.
- [ ] Projection live read runs without archive when hydrated in-memory; optional
  archive bootstrap documented.
- [ ] No custom `*TransportProtocol` tags; servers use `RpcServer.Protocol`.
- [ ] Official `layerProtocolWebsocket` + `layerNdjson` compose all transports.
- [ ] Facet module docs list Telemetry / Archive / Projection separately.
