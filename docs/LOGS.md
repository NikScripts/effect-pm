# Logs platform — key catalog & reference

**Narrative guide (start here):** [`docs/guides/logs.md`](./guides/logs.md) — architecture, live bus, durable journals, lineage, remote clients, migration.

This file remains the **lookup SSOT**: every identifier below is labeled by **key kind** and mapped to a **package import path**, **source file**, and **example file** (short path under `examples/` or `test/`). Per-resource export uses `Resource.logs` / `Resource.withLogExport`.

## Module paths

| Module | Package import | Source |
|--------|----------------|--------|
| Logs platform | `@nikscripts/effect-pm/Logs` | `src/Logs.ts` |
| Log annotations | `@nikscripts/effect-pm/LogContext` | `src/LogContext.ts` |
| Log entry + predicates | `@nikscripts/effect-pm/LogEntry` | `src/LogEntry.ts` |
| Resource foundation | `@nikscripts/effect-pm/Resource` | `src/Resource.ts` |
| Store (registrations) | `@nikscripts/effect-pm/Store` | `src/Store.ts` |
| Process tags | `@nikscripts/effect-pm/Process` | `src/Process.ts` |
| Queue tags | `@nikscripts/effect-pm/QueueResource` | `src/QueueResource.ts` |

| Example | Short path | Role |
|---------|------------|------|
| WNBA hub fixture | `resource-web/hub.ts` | Node + resource tag definitions |
| WNBA servers | `resource-web/server.ts` | `Store.Service` + `Node.logs` / toolkit `.store` per node |
| Test key constants | `test/fixtures/logKeys.ts` | Canonical keys for unit tests |
| Logs env helper | `test/fixtures/logsEnv.ts` | `EnvNode.logs` on `Store.Service.layerMemory` for tests |
| Resource.logs integration | `test/logs-resource.test.ts` | Runtime `Resource.logs` stream + query |

## Key kinds (vocabulary)

| Key kind | Identifies | Declared on | Stored / queried as |
|----------|------------|-------------|---------------------|
| **Node log key** | One OS process / runtime host (durable bucket) | `Resource.Node` constructor arg → `.key` | `Node.logs` scope; `annotations.node` |
| **Resource key** | One queue, process, or custom tag | `Resource.Tag` / `Process.Tag` / `QueueResource.Tag` constructor arg → `.key` | registration scope; lineage JSON |
| **Annotation key** | Name of a field on `LogEntry.annotations` | `LogAnnotationKeys.*` | Not a bucket — metadata field name |
| **Store scope key** | Journal partition for a registration | Same as node or resource key | `handle.log.append` / `handle.log.read` |
| **Lineage segment key** | One hop in resource ancestry | Each element in lineage JSON array | `LogEntry.hasKey` / `atRoot` / `atLeaf` |
| **RPC `groupId`** | Wire routing prefix for multi-host RPC | Tag `groupId` when set | **Not** a log key |
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
| `testTuiNodeKey` | node log key (example) | `acme/tui` | — (example fixture) | `resource-tui/live-queues.ts` | `resource-tui/queue-live.tsx` |

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
| `Node.logs` / `Resource.store(Node)` | node log key | `Node.key` | store registration | `src/Resource.ts` |
| `byNode(node)` | node log key | `Node.key` | `Logs.byNode` | `src/Logs.ts` |
| `byResource({ processId })` | resource key filter | `Process.Tag.key` | `Logs.byResource` | `src/Logs.ts` |
| `byResource({ queueId })` | resource key filter | `QueueResource.Tag.key` | `Logs.byResource` | `src/Logs.ts` |
| `handle.log.read` | store scope key | node or resource key | store handle | registration `log` shape |
| `LogEntry.hasKey(key)` | lineage segment key | `Tag.key` | `LogEntry.hasKey` | `src/LogEntry.ts` |
| `LogEntry.atRoot(key)` | lineage segment key | usually **node log key** | `LogEntry.atRoot` | `src/LogEntry.ts` |
| `LogEntry.atLeaf(key)` | lineage segment key | usually **resource key** | `LogEntry.atLeaf` | `src/LogEntry.ts` |

## Node log key rules

1. **Must equal** the `Resource.Node` key for that process: `WnbaNode.key` → node log key `"wnba/scores"`.
2. **Register** `Node.logs` (or `Resource.store(Node)`) on the app `Store.Service`; query with `Logs.byNode(Node)`.
3. **Stamped** on every node-journal line as annotation key `LogAnnotationKeys.node` → node log key value.
4. **Two copies OK** — when both `Node.logs` and `Process.store` / `QueueResource.store` are registered, the same `lineId` can land in both scopes (memo is per scope).
5. Use **slash-separated** paths (`domain/role`), not placeholders (`my-node`, `node-a`, bare `wnba`).

```ts
import * as Resource from "@nikscripts/effect-pm/Resource";
import * as Logs from "@nikscripts/effect-pm/Logs";
import * as Process from "@nikscripts/effect-pm/Process";
import * as Store from "@nikscripts/effect-pm/Store";

class BillingNode extends Resource.Node<BillingNode>("billing/scores") {}
class Daily extends Process.Tag<Daily>()("app/Daily") {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  BillingNode.logs,
  Process.store(Daily),
) {}

Effect.provide(program, AppStore.layerMemory)
const rows = yield* Logs.byNode(BillingNode, { limit: 200 })
```

```ts
// ❌ wrong — invented node log key, drifts from Resource.Node
Logs.byNode("my-node")
Logs.byNode("wnba") // WnbaNode.key is "wnba/scores", not "wnba"
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
  AppStore.layerMemory          → Logs.layer (baked in) + Storage + durable tails
  BillingNode.logs              → match-all follower → handle.log.append (node journal)
  Process.store(Daily)          → lineage follower → handle.log.append (resource scope)
  Logs.withScope(tag)           → appends resource key onto fiber lineage path
  Resource.logs(tag)            → { stream, query } (live + durable)
```

- **Capture:** exactly one merged capture logger per node (`Logs.layer`, baked into `Store.Service`).
- **Bus:** one `LogRelay` (PubSub + bounded tail).
- **Durable tails:** Stream pipeline per registration — level ∧ match → `(scopeKey, lineId)` memo → batch append.
- **Stream:** unfiltered on `Logs.stream`; `Resource.logs` applies lineage + optional `logStreamLevel`.

## Node runtime

### Live only

```ts
import * as Logs from "@nikscripts/effect-pm/Logs";

Effect.provide(program, Logs.layer);

const tail = yield* Logs.snapshot;
const live = yield* Logs.stream;
```

### Live + durable (registration followers)

```ts
import * as Logs from "@nikscripts/effect-pm/Logs";
import * as Process from "@nikscripts/effect-pm/Process";
import * as Store from "@nikscripts/effect-pm/Store";
// example: resource-web/server.ts

class AppStore extends Store.Service<AppStore>("@app/Store")(
  WnbaNode.logs,
  Process.store(LiveScorePoller),
) {}

// Provide the store *into* the resource layer so Logs.layer is installed before
// auto-started queue workers fork (Process can use either order — workers start on `run`).
Effect.provide(
  program,
  Process.layer(...).pipe(Layer.provideMerge(AppStore.layerMemory)),
)
```

### Query durable history

```ts
import * as Logs from "@nikscripts/effect-pm/Logs";

// node journal — everything this node's match-all follower captured
yield* Logs.byNode(WnbaNode, { limit: 500 });

// resource scope — that registration's handle.log.read
yield* Logs.byResource({ processId: LiveScorePoller.key }, { limit: 100 });

const handle = yield* AppStore.at(LiveScorePoller);
yield* handle.log.read({ limit: 100 });
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

`resource-web/server.ts` registers `WnbaNode.logs` / `LiveNode.logs` / `StatsNode.logs` on per-node `Store.Service` classes (plus toolkit `.store` registrations).

## Remote dashboard (browser → node)

When the dashboard reaches resources over RPC, durable per-resource rows come from the node's journal (`NodeStatus.logs.query`) filtered by **resource key**. Locally, `Resource.logs(tag).query` prefers registration Storage and falls back to NodeStatus when remote.

```ts
import * as NodeStatus from "@nikscripts/effect-pm/NodeStatus";
import * as LogEntry from "@nikscripts/effect-pm/LogEntry";

const resourceKey = LiveScorePoller.key;

NodeStatus.logs.stream.pipe(Stream.filter(LogEntry.hasKey(resourceKey)));

const rows = yield* NodeStatus.logs.query({ limit: 300 });
const scoped = rows.filter(LogEntry.hasKey(resourceKey));
```

Example: `src/web/data.ts` (`resourceLogsAtom`), `examples/web-dashboard/queue-data.ts` (`resourceLogsAccumulator`).

Server must provide an app `Store.Service` with `Node.logs` (and desired toolkit stores) on the node stack — e.g. `DropletStore.layerMemory` in `examples/web-dashboard/queue-server.ts`. `httpServer` infers the node log key from served tags' bound `Node` for `NodeStatus.logs.query`.

## Migration

| Old | New |
|-----|-----|
| `Logs.persistLayer` + `@nikscripts/effect-pm/store/Log` | **Removed** — `Node.logs` + toolkit `.store` on `Store.Service` |
| `NodeLogs.*` / `/NodeLogs` | **Removed** — use `Logs.*` / `@nikscripts/effect-pm/Logs` |
| `ProcessStore` log facet | implicit `log` shape on toolkit store registrations |
| `captureLogs` on engines | **Removed** — `Logs.layer` (baked into Store) + `Logs.withScope(tag)` |
| `queue.logs` / `proc.logs` on handle | `Resource.logs(tag)` (local Storage / remote NodeStatus) |
| `HistoryStore` `${tag.key}/logs` | **Removed** — durable logs via registration `handle.log` |
| `HostLogs` (docs) | `Logs` |

## Verification

```bash
pnpm typecheck
pnpm test test/logs-resource.test.ts test/logs-durable-tail.test.ts test/host-logs-history.test.ts test/logs-two-copies-stream-level.test.ts test/process-log-history.test.ts
```
