# Logs platform

One module (`Logs`) for runtime-wide capture, live relay, and durable history. Per-resource export uses `Resource.logs` / `Resource.withLogExport`.

## Keys (read this first)

Logs use **two different key spaces**. Do not mix them.

| Key | What it identifies | Format | Example |
|-----|-------------------|--------|---------|
| **Node log key** | The OS process / runtime host (durable bucket) | **`Resource.Node` `.key`** — same string as `Resource.selfNode` | `wnba/scores`, `wnba/live`, `test/edge` |
| **Resource key** | A queue, process, or custom tag | **`Resource.Tag` `.key`** (lineage / `byResource`) | `wnba/BoxScoreQueue`, `wnba/LiveScorePoller` |
| **RPC `groupId`** | Wire prefix for multi-host routing | Tag's `groupId` when set | **Not** a log node bucket |

### Node log key rules

1. **Must equal** the `Resource.Node` key for that process: `WnbaNode.key` → `"wnba/scores"`.
2. **Same value** in `Logs.persistLayer(node)` and `Logs.byNode(node)` (or pass the `Node` class — see below).
3. **Stamped** on every persisted line as `annotations.node` (`LogAnnotationKeys.node`).
4. **Stored** in `LogStore` as `groupId` for that bucket.
5. Use **slash-separated** paths (`domain/role`), not cute placeholders (`my-node`, `node-a`, bare `wnba`).

```ts
import * as Resource from "@nikscripts/effect-pm/Resource";
import * as Logs from "@nikscripts/effect-pm/Logs";

class BillingNode extends Resource.Node<BillingNode>("billing/scores") {}

// ✅ correct — node.key everywhere
const node = BillingNode.key; // "billing/scores"

Logs.persistLayer(node).pipe(
  Layer.provideMerge(Layer.mergeAll(Logs.layer, LogStore.layerMemory)),
);

const rows = yield* Logs.byNode(node, { limit: 200 });

// ✅ also accepts the Node class directly
Logs.persistLayer(BillingNode);
yield* Logs.byNode(BillingNode);
```

```ts
// ❌ wrong — invented string, drifts from Resource.Node
Logs.persistLayer("my-node");
Logs.persistLayer("wnba"); // WnbaNode.key is "wnba/scores", not "wnba"
```

### Resource keys (per-resource logs)

Resource identity uses **`tag.key`** (may contain `/`, sometimes `@`-prefixed for metrics tags).

```ts
class Poller extends Process.Tag<Poller>()("wnba/LiveScorePoller", { node: LiveNode }) {}

// Live bus — filter by resource
Logs.stream.pipe(Stream.filter(LogEntry.hasKey(Poller.key)));

// Durable — legacy annotation filters (prefer lineage after cutover)
yield* Logs.byResource({ processId: Poller.key });

// Platform export (preferred for new code)
const { stream, query } = yield* Resource.logs(Poller);
```

## Architecture

```
BillingNode process
  Logs.layer              → LogRelay + one merged capture Logger
  Logs.persistLayer(key)  → relay subscriber → LogStore (no second logger)
  Logs.withScope(tag)     → lineage annotation at resource materialize
  Resource.logs(tag)      → { stream, query } when export piped on tag
```

- **Capture:** exactly one merged capture logger per node (`Logs.layer`).
- **Bus:** one `LogRelay` (PubSub + bounded tail).
- **Stream:** unfiltered; filter with `Stream.filter` + `LogEntry.hasKey` / `atRoot` / `atLeaf`.
- **Store:** `LogStore` on the Store bridge (`Store.contract`), not `ProcessStore`.

## Node runtime

### Live only

```ts
Effect.provide(program, Logs.layer);

const tail = yield* Logs.snapshot;
const live = yield* Logs.stream;
```

### Live + durable

`persistLayer` must be **wrapped** around the layers that provide `LogRelay` and `LogStore`:

```ts
import { LogStore } from "@nikscripts/effect-pm/store/Log";

const node = BillingNode.key;

const logStack = Logs.persistLayer(node).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Logs.layer,
      LogStore.layer({ filename: ".effect-pm/logs.sqlite" }), // or layerMemory
    ),
  ),
);

Effect.provide(program, logStack);
```

### Query durable history

```ts
// Everything this node captured
yield* Logs.byNode(BillingNode, { limit: 500, sort: "desc" });

// One resource across nodes (annotation / lineage filter)
yield* Logs.byResource({ processId: "wnba/LiveScorePoller" }, { limit: 100 });

// Lineage filter (store query)
yield* LogStore.load({ lineageContains: Poller.key, limit: 100, sort: "desc" });
```

## Per-resource export

```ts
class MailQueue extends QueueResource.Tag<MailQueue>()("app/Mail", spec).pipe(
  Resource.withLogExport,
) {}

const { stream, query } = yield* Resource.logs(MailQueue);
// or: yield* MailQueue.logs

stream.pipe(Stream.filter(LogEntry.hasKey(MailQueue.key)));
const history = yield* query({ limit: 50 });
```

## LogEntry predicates

```ts
import * as LogEntry from "@nikscripts/effect-pm/LogEntry";

LogEntry.lineage(entry);              // string[] from JSON annotation
LogEntry.hasKey("wnba/LiveScorePoller")(entry);
LogEntry.atRoot("wnba/live")(entry);  // lineage[0]
LogEntry.atLeaf(Poller.key)(entry);   // last segment
```

Lineage JSON lives at `LogAnnotationKeys.lineage` (`@nikscripts/effect-pm/lineage`). Legacy `processId` / `queueId` annotations are still read for old rows.

## Multi-node fixture (resource-web)

| Node class | Node log key (`node.key`) | Resources on it |
|------------|---------------------------|-----------------|
| `WnbaNode` | `wnba/scores` | `BoxScoreQueue`, `ScoresDb`, `ScoresApi` |
| `LiveNode` | `wnba/live` | `LiveScorePoller` |
| `StatsNode` | `wnba/stats` | `PlayByPlayQueue` |

Each `httpServer` stack calls `Logs.persistLayer(<that Node>)` with the matching key.

## Migration

| Old | New |
|-----|-----|
| `NodeLogs.*` | `Logs.*` (shim remains one release) |
| `ProcessStore` log facet | `LogStore` + `Store.contract` |
| `captureLogs` on engines | `Logs.layer` + `Resource.logs` (legacy paths still present) |
| `HostLogs` (docs) | `Logs` |

## Verification

```bash
pnpm typecheck
pnpm test test/logs-relay.test.ts test/log-pipeline.test.ts test/host-logs-history.test.ts
```
