# Logs platform

One module (`Logs`) for runtime-wide capture, live relay, and durable history. Per-resource export uses `Resource.logs` / `Resource.withLogExport`.

**Start here:** every identifier below is labeled by **key kind** and mapped to a **package import path**, **source file**, and **example file** (short path under `examples/` or `test/`).

## Module paths

| Module | Package import | Source |
|--------|----------------|--------|
| Logs platform | `@nikscripts/effect-pm/Logs` | `src/Logs.ts` |
| Node shim (deprecated) | `@nikscripts/effect-pm/NodeLogs` | `src/NodeLogs.ts` |
| Log annotations | `@nikscripts/effect-pm/LogContext` | `src/LogContext.ts` |
| Log entry + predicates | `@nikscripts/effect-pm/LogEntry` | `src/LogEntry.ts` |
| Resource foundation | `@nikscripts/effect-pm/Resource` | `src/Resource.ts` |
| Log storage facet | `@nikscripts/effect-pm/store/Log` | `src/store/log.ts` |
| Process tags | `@nikscripts/effect-pm/Process` | `src/Process.ts` |
| Queue tags | `@nikscripts/effect-pm/QueueResource` | `src/QueueResource.ts` |

| Example | Short path | Role |
|---------|------------|------|
| WNBA hub fixture | `resource-web/hub.ts` | Node + resource tag definitions |
| WNBA servers | `resource-web/server.ts` | `persistLayer` wiring per node |
| Test key constants | `test/fixtures/logKeys.ts` | Canonical keys for unit tests |

## Key kinds (vocabulary)

| Key kind | Identifies | Declared on | Stored / queried as |
|----------|------------|-------------|---------------------|
| **Node log key** | One OS process / runtime host (durable bucket) | `Resource.Node` constructor arg → `.key` | `LogStore` `groupId`; `annotations.node` |
| **Resource key** | One queue, process, or custom tag | `Resource.Tag` / `Process.Tag` / `QueueResource.Tag` constructor arg → `.key` | `annotations.processId` / `queueId`; lineage JSON |
| **Annotation key** | Name of a field on `LogEntry.annotations` | `LogAnnotationKeys.*` | Not a bucket — metadata field name |
| **Store bucket key** | SQLite / journal partition for logs | Same value as **node log key** | `LogStore.record(groupId, …)` / `LogQuery.groupId` |
| **Lineage segment key** | One hop in resource ancestry | Each element in lineage JSON array | `LogEntry.hasKey` / `atRoot` / `atLeaf` |
| **RPC `groupId`** | Wire routing prefix for multi-host RPC | Tag `groupId` when set | **Not** a log key — do not pass to `persistLayer` |
| **Group catalog key** | Dashboard / CLI grouping | `Group.Tag` constructor arg | **Not** a log key — e.g. `hub/Wnba` |

## Key catalog

### Node log keys

| Symbol | Key kind | Key value | Package import | Source | Example |
|--------|----------|-----------|----------------|--------|---------|
| `WnbaNode.key` | node log key | `wnba/scores` | `@nikscripts/effect-pm/Resource` | `src/Resource.ts` | `resource-web/hub.ts` |
| `LiveNode.key` | node log key | `wnba/live` | `@nikscripts/effect-pm/Resource` | `src/Resource.ts` | `resource-web/hub.ts` |
| `StatsNode.key` | node log key | `wnba/stats` | `@nikscripts/effect-pm/Resource` | `src/Resource.ts` | `resource-web/hub.ts` |
| `Resource.selfNode(tag)` | node log key (runtime) | same as host `Node.key` | `@nikscripts/effect-pm/Resource` | `src/Resource.ts` | `resource-web/server.ts` |
| `Logs.NodeLogKey` | node log key (type) | `string` constrained to `Node.key` | `@nikscripts/effect-pm/Logs` | `src/Logs.ts` | — |
| `Logs.nodeLogKey(node)` | node log key (resolver) | `node.key` | `@nikscripts/effect-pm/Logs` | `src/Logs.ts` | — |
| `testBillingNodeKey` | node log key (test) | `billing/scores` | — (test fixture) | `test/fixtures/logKeys.ts` | `test/host-logs-history.test.ts` |
| `testRelayNodeKey` | node log key (test) | `test/relay` | — (test fixture) | `test/fixtures/logKeys.ts` | `test/logs-relay.test.ts` |

### Resource keys (resource-web)

| Symbol | Key kind | Key value | Package import | Source | Example |
|--------|----------|-----------|----------------|--------|---------|
| `BoxScoreQueue.key` | resource key | `wnba/BoxScoreQueue` | `@nikscripts/effect-pm/QueueResource` | `src/QueueResource.ts` | `resource-web/hub.ts` |
| `LiveScorePoller.key` | resource key | `wnba/LiveScorePoller` | `@nikscripts/effect-pm/Process` | `src/Process.ts` | `resource-web/hub.ts` |
| `PlayByPlayQueue.key` | resource key | `wnba/PlayByPlayQueue` | `@nikscripts/effect-pm/QueueResource` | `src/QueueResource.ts` | `resource-web/hub.ts` |
| `ScoresDb.key` | resource key | `wnba/ScoresDb` | `@nikscripts/effect-pm/Resource` | `src/Resource.ts` | `resource-web/hub.ts` |
| `ScoresApi.key` | resource key | `@wnba/ScoresApi` | `@nikscripts/effect-pm/ApiMetrics` | `src/ApiMetrics.ts` | `resource-web/hub.ts` |
| `WorkerPool.key` | resource key | `wnba/WorkerPool` | `@nikscripts/effect-pm/Resource` | `src/Resource.ts` | `resource-web/hub.ts` |
| `testSyncProcessKey` | resource key (test) | `billing/SyncWorker` | — (test fixture) | `test/fixtures/logKeys.ts` | `test/log-pipeline.test.ts` |
| `Logs.ResourceLogKey` | resource key (type) | `string` constrained to `Tag.key` | `@nikscripts/effect-pm/Logs` | `src/Logs.ts` | — |

### Annotation keys (`LogAnnotationKeys`)

| Symbol | Key kind | Field name (value) | Holds | Package import | Source |
|--------|----------|-------------------|-------|----------------|--------|
| `LogAnnotationKeys.node` | annotation key | `"node"` | **node log key** value | `@nikscripts/effect-pm/LogContext` | `src/LogContext.ts` |
| `LogAnnotationKeys.processId` | annotation key | `"processId"` | **resource key** (process) | `@nikscripts/effect-pm/LogContext` | `src/LogContext.ts` |
| `LogAnnotationKeys.queueId` | annotation key | `"queueId"` | **resource key** (queue) | `@nikscripts/effect-pm/LogContext` | `src/LogContext.ts` |
| `LogAnnotationKeys.lineage` | annotation key | `"@nikscripts/effect-pm/lineage"` | JSON array of **lineage segment keys** | `@nikscripts/effect-pm/LogContext` | `src/LogContext.ts` |

### Store / query parameters

| Parameter | Key kind | Must be | API | Source |
|-----------|----------|---------|-----|--------|
| `persistLayer(node)` | node log key | `Node.key` | `Logs.persistLayer` | `src/Logs.ts` |
| `byNode(node)` | node log key | `Node.key` | `Logs.byNode` | `src/Logs.ts` |
| `record(groupId, …)` | store bucket key | node log key | `LogStore.record` | `src/store/log.ts` |
| `load({ groupId })` | store bucket key | node log key | `LogStore.load` / `Logs.byNode` | `src/store/log.ts` |
| `byResource({ processId })` | resource key filter | `Process.Tag.key` | `Logs.byResource` | `src/Logs.ts` |
| `byResource({ queueId })` | resource key filter | `QueueResource.Tag.key` | `Logs.byResource` | `src/Logs.ts` |
| `load({ lineageContains })` | lineage segment key | any `Tag.key` in ancestry | `LogStore.load` | `src/internal/manager/logQuery.ts` |
| `LogEntry.hasKey(key)` | lineage segment key | `Tag.key` | `LogEntry.hasKey` | `src/LogEntry.ts` |
| `LogEntry.atRoot(key)` | lineage segment key | usually **node log key** | `LogEntry.atRoot` | `src/LogEntry.ts` |
| `LogEntry.atLeaf(key)` | lineage segment key | usually **resource key** | `LogEntry.atLeaf` | `src/LogEntry.ts` |

## Node log key rules

1. **Must equal** the `Resource.Node` key for that process: `WnbaNode.key` → node log key `"wnba/scores"`.
2. **Same node log key** in `Logs.persistLayer(node)` and `Logs.byNode(node)` (or pass the `Node` class).
3. **Stamped** on every persisted line as annotation key `LogAnnotationKeys.node` → node log key value.
4. **Stored** in `LogStore` as store bucket key `groupId`.
5. Use **slash-separated** paths (`domain/role`), not placeholders (`my-node`, `node-a`, bare `wnba`).

```ts
import * as Resource from "@nikscripts/effect-pm/Resource";
import * as Logs from "@nikscripts/effect-pm/Logs";
import { LogStore } from "@nikscripts/effect-pm/store/Log";

class BillingNode extends Resource.Node<BillingNode>("billing/scores") {}

// node log key — BillingNode.key
const nodeLogKey = BillingNode.key; // "billing/scores"

Logs.persistLayer(nodeLogKey).pipe(
  Layer.provideMerge(Layer.mergeAll(Logs.layer, LogStore.layerMemory)),
);

const rows = yield* Logs.byNode(nodeLogKey, { limit: 200 });

// also accepts the Node class (resolves .key)
Logs.persistLayer(BillingNode);
yield* Logs.byNode(BillingNode);
```

```ts
// ❌ wrong — invented node log key, drifts from Resource.Node
Logs.persistLayer("my-node");
Logs.persistLayer("wnba"); // WnbaNode.key is "wnba/scores", not "wnba"
```

## Resource keys (per-resource logs)

Resource identity uses **`tag.key`** (may contain `/`; metrics tags may use `@` prefix).

```ts
import * as Process from "@nikscripts/effect-pm/Process";
import * as Resource from "@nikscripts/effect-pm/Resource";
import * as Logs from "@nikscripts/effect-pm/Logs";
import * as LogEntry from "@nikscripts/effect-pm/LogEntry";
// example: resource-web/hub.ts
import { LiveNode, LiveScorePoller } from "./hub";

// resource key — LiveScorePoller.key === "wnba/LiveScorePoller"
const resourceKey = LiveScorePoller.key;

Logs.stream.pipe(Stream.filter(LogEntry.hasKey(resourceKey)));

yield* Logs.byResource({ processId: resourceKey });

const { stream, query } = yield* Resource.logs(LiveScorePoller);
```

## Architecture

```
BillingNode process (node log key: billing/scores)
  Logs.layer                    → LogRelay + one merged capture Logger
  Logs.persistLayer(nodeLogKey) → relay subscriber → LogStore (no second logger)
  Logs.withScope(tag)           → stamps resource key into lineage
  Resource.logs(tag)            → { stream, query } when export piped on tag
```

- **Capture:** exactly one merged capture logger per node (`Logs.layer`).
- **Bus:** one `LogRelay` (PubSub + bounded tail).
- **Stream:** unfiltered; filter with `Stream.filter` + `LogEntry.hasKey(resourceKey)` / `atRoot(nodeLogKey)` / `atLeaf(resourceKey)`.
- **Store:** `LogStore` on the Store bridge (`Store.contract`), not `ProcessStore`.

## Node runtime

### Live only

```ts
import * as Logs from "@nikscripts/effect-pm/Logs";

Effect.provide(program, Logs.layer);

const tail = yield* Logs.snapshot;
const live = yield* Logs.stream;
```

### Live + durable

`persistLayer` must be **wrapped** around the layers that provide `LogRelay` and `LogStore`:

```ts
import * as Logs from "@nikscripts/effect-pm/Logs";
import { LogStore } from "@nikscripts/effect-pm/store/Log";
// example: resource-web/server.ts

const nodeLogKey = WnbaNode.key; // "wnba/scores"

const logStack = Logs.persistLayer(nodeLogKey).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Logs.layer,
      LogStore.layer({ filename: ".effect-pm/logs.sqlite" }),
    ),
  ),
);

Effect.provide(program, logStack);
```

### Query durable history

```ts
import * as Logs from "@nikscripts/effect-pm/Logs";
import { LogStore } from "@nikscripts/effect-pm/store/Log";
import * as LogEntry from "@nikscripts/effect-pm/LogEntry";

// node log key — everything this node captured
yield* Logs.byNode(WnbaNode, { limit: 500, sort: "desc" });

// resource key — one process across nodes
yield* Logs.byResource({ processId: LiveScorePoller.key }, { limit: 100 });

// lineage segment key — store query
yield* LogStore.load({
  lineageContains: LiveScorePoller.key,
  limit: 100,
  sort: "desc",
});
```

## Per-resource export

```ts
import * as Resource from "@nikscripts/effect-pm/Resource";
import * as QueueResource from "@nikscripts/effect-pm/QueueResource";
import * as LogEntry from "@nikscripts/effect-pm/LogEntry";

class MailQueue extends QueueResource.Tag<MailQueue>()("app/Mail", spec).pipe(
  Resource.withLogExport,
) {}

const resourceKey = MailQueue.key; // "app/Mail"

const { stream, query } = yield* Resource.logs(MailQueue);

stream.pipe(Stream.filter(LogEntry.hasKey(resourceKey)));
const history = yield* query({ limit: 50 });
```

## LogEntry predicates

All predicate arguments are **lineage segment keys** (usually a **resource key** or **node log key**).

```ts
import * as LogEntry from "@nikscripts/effect-pm/LogEntry";
import { LiveNode, LiveScorePoller } from "resource-web/hub";

const nodeLogKey = LiveNode.key;           // "wnba/live"
const resourceKey = LiveScorePoller.key;   // "wnba/LiveScorePoller"

LogEntry.lineage(entry);                         // lineage segment keys[]
LogEntry.hasKey(resourceKey)(entry);
LogEntry.atRoot(nodeLogKey)(entry);              // lineage[0]
LogEntry.atLeaf(resourceKey)(entry);             // last segment
```

Lineage JSON uses annotation key `LogAnnotationKeys.lineage`. Legacy `processId` / `queueId` annotation keys still populate lineage for old rows.

## Multi-node fixture (`resource-web`)

| Class | Key kind | Key value | Example file |
|-------|----------|-----------|--------------|
| `WnbaNode` | node log key | `wnba/scores` | `resource-web/hub.ts` |
| `LiveNode` | node log key | `wnba/live` | `resource-web/hub.ts` |
| `StatsNode` | node log key | `wnba/stats` | `resource-web/hub.ts` |
| `BoxScoreQueue` | resource key | `wnba/BoxScoreQueue` | `resource-web/hub.ts` |
| `ScoresDb` | resource key | `wnba/ScoresDb` | `resource-web/hub.ts` |
| `ScoresApi` | resource key | `@wnba/ScoresApi` | `resource-web/hub.ts` |
| `LiveScorePoller` | resource key | `wnba/LiveScorePoller` | `resource-web/hub.ts` |
| `PlayByPlayQueue` | resource key | `wnba/PlayByPlayQueue` | `resource-web/hub.ts` |
| `WorkerPool` | resource key | `wnba/WorkerPool` | `resource-web/hub.ts` |

`resource-web/server.ts` calls `Logs.persistLayer(WnbaNode | LiveNode | StatsNode)` — each stack uses the matching **node log key**.

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
