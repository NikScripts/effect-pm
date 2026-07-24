<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/LOGS>.
<!-- docs-site-link:end -->
# Logs platform — key catalog & reference

**Narrative guide (start here):** [`docs/guides/logs.md`](./guides/logs.md) — architecture, live bus, durable journals, lineage, remote clients, migration.

This file remains the **lookup SSOT**: every identifier below is labeled by **key kind** and mapped to a **package import path**, **source file**, and **example file** (short path under `examples/` or `test/`). Per-resource export uses `Hyperlink.logs` / `Hyperlink.withLogExport`.

## Module paths

| Module | Package import | Source |
|--------|----------------|--------|
| Logs platform | `hyperlink-ts/Logs` | `src/Logs.ts` |
| Log annotations | `hyperlink-ts/LogContext` | `src/LogContext.ts` |
| Log entry + predicates | `hyperlink-ts/LogEntry` | `src/LogEntry.ts` |
| Hyperlink foundation | `hyperlink-ts/Hyperlink` | `src/Hyperlink.ts` |
| Store (registrations) | `hyperlink-ts/Store` | `src/Store.ts` |
| Daemon tags | `hyperlink-ts/Daemon` | `src/Daemon.ts` |
| WorkPool tags | `hyperlink-ts/WorkPool` | `src/WorkPool.ts` |

| Example | Short path | Role |
|---------|------------|------|
| WNBA hub fixture | `resource-web/hub.ts` | Node + resource tag definitions |
| WNBA servers | `resource-web/server.ts` | `Store.Service` + `Node.logs` / toolkit `.store` per node |
| Test key constants | `test/fixtures/logKeys.ts` | Canonical keys for unit tests |
| Logs env helper | `test/fixtures/logsEnv.ts` | `EnvNode.logs` on `Store.Service.layerMemory` for tests |
| Hyperlink.logs integration | `test/logs-resource.test.ts` | Runtime `Hyperlink.logs` stream + query |

## Key kinds (vocabulary)

| Key kind | Identifies | Declared on | Stored / queried as |
|----------|------------|-------------|---------------------|
| **Node log key** | One OS process / runtime host (durable bucket) | `Node.Tag` constructor arg → `.key` | `Node.logs` scope; `annotations.node` |
| **Hyperlink key** | One work pool, daemon, or custom tag | `Hyperlink.Tag` / `Daemon.Tag` / `WorkPool.Tag` constructor arg → `.key` | registration scope; lineage JSON |
| **Annotation key** | Name of a field on `LogEntry.annotations` | `LogAnnotationKeys.*` | Not a bucket — metadata field name |
| **Store scope key** | Journal partition for a registration | Same as node or resource key | Durable `_logs` journal (private); read via `Hyperlink.logs` / `Logs.by*` |
| **Lineage segment key** | One hop in resource ancestry | Each element in lineage JSON array | `LogEntry.hasKey` / `atRoot` / `atLeaf` |
| **RPC `groupId`** | Wire routing prefix for multi-host RPC | Tag `groupId` when set | **Not** a log key |
| **Group catalog key** | Dashboard / CLI grouping | `Group.Tag` constructor arg | **Not** a log key — e.g. `hub/Wnba` |

## Key catalog

### Node log keys

| Symbol | Key kind | Key value | Package import | Source | Example |
|--------|----------|-----------|----------------|--------|---------|
| `WnbaNode.key` | node log key | `wnba/scores` | `hyperlink-ts/Hyperlink` | `src/Hyperlink.ts` | `resource-web/hub.ts` |
| `LiveNode.key` | node log key | `wnba/live` | `hyperlink-ts/Hyperlink` | `src/Hyperlink.ts` | `resource-web/hub.ts` |
| `StatsNode.key` | node log key | `wnba/stats` | `hyperlink-ts/Hyperlink` | `src/Hyperlink.ts` | `resource-web/hub.ts` |
| `Hyperlink.selfNode(tag)` | node log key (runtime) | same as host `Node.key` | `hyperlink-ts/Hyperlink` | `src/Hyperlink.ts` | `resource-web/server.ts` |
| `Logs.NodeLogKey` | node log key (type) | `string` constrained to `Node.key` | `hyperlink-ts/Logs` | `src/Logs.ts` | — |
| `Logs.nodeLogKey(node)` | node log key (resolver) | `node.key` | `hyperlink-ts/Logs` | `src/Logs.ts` | — |
| `testBillingNodeKey` | node log key (test) | `billing/scores` | — (test fixture) | `test/fixtures/logKeys.ts` | `test/host-logs-history.test.ts` |
| `testRelayNodeKey` | node log key (test) | `test/relay` | — (test fixture) | `test/fixtures/logKeys.ts` | `test/logs-relay.test.ts` |
| `testTuiNodeKey` | node log key (example) | `acme/tui` | — (example fixture) | `resource-tui/live-queues.ts` | `resource-tui/queue-live.tsx` |

### Hyperlink keys (resource-web)

| Symbol | Key kind | Key value | Package import | Source | Example |
|--------|----------|-----------|----------------|--------|---------|
| `BoxScoreQueue.key` | resource key | `wnba/BoxScoreQueue` | `hyperlink-ts/WorkPool` | `src/WorkPool.ts` | `resource-web/hub.ts` |
| `LiveScorePoller.key` | resource key | `wnba/LiveScorePoller` | `hyperlink-ts/Daemon` | `src/Daemon.ts` | `resource-web/hub.ts` |
| `PlayByPlayQueue.key` | resource key | `wnba/PlayByPlayQueue` | `hyperlink-ts/WorkPool` | `src/WorkPool.ts` | `resource-web/hub.ts` |
| `ScoresDb.key` | resource key | `wnba/ScoresDb` | `hyperlink-ts/Hyperlink` | `src/Hyperlink.ts` | `resource-web/hub.ts` |
| `ScoresApi.key` | resource key | `@wnba/ScoresApi` | `hyperlink-ts/ApiMetrics` | `src/ApiMetrics.ts` | `resource-web/hub.ts` |
| `WorkerPool.key` | resource key | `wnba/WorkerPool` | `hyperlink-ts/Hyperlink` | `src/Hyperlink.ts` | `resource-web/hub.ts` |
| `testSyncProcessKey` | resource key (test) | `billing/SyncWorker` | — (test fixture) | `test/fixtures/logKeys.ts` | `test/log-pipeline.test.ts` |
| `Logs.HyperlinkLogKey` | resource key (type) | `string` constrained to `Tag.key` | `hyperlink-ts/Logs` | `src/Logs.ts` | — |

### Annotation keys (`LogAnnotationKeys`)

| Symbol | Key kind | Field name (value) | Holds | Package import | Source |
|--------|----------|-------------------|-------|----------------|--------|
| `LogAnnotationKeys.node` | annotation key | `"node"` | **node log key** value | `hyperlink-ts/LogContext` | `src/LogContext.ts` |
| `LogAnnotationKeys.lineage` | annotation key | `"hyperlink-ts/lineage"` | JSON array of **lineage segment keys** | `hyperlink-ts/LogContext` | `src/LogContext.ts` |

### Store / query parameters

| Parameter | Key kind | Must be | API | Source |
|-----------|----------|---------|-----|--------|
| `Node.logs` / `Hyperlink.store(Node)` | node log key | `Node.key` | store registration | `src/Hyperlink.ts` |
| `byNode(node)` | node log key | `Node.key` | `Logs.byNode` | `src/Logs.ts` |
| `byHyperlink(tag \| key)` | resource key / scope tag | `Tag.key` | `Logs.byHyperlink` | `src/Logs.ts` |
| `Logs.byHyperlink` / `Hyperlink.logs().query` | resource key / scope tag | `Tag.key` | durable helpers | registration `_logs` journal (private) |
| `LogEntry.hasKey(key)` | lineage segment key | `Tag.key` | `LogEntry.hasKey` | `src/LogEntry.ts` |
| `LogEntry.atRoot(key)` | lineage segment key | usually **node log key** | `LogEntry.atRoot` | `src/LogEntry.ts` |
| `LogEntry.atLeaf(key)` | lineage segment key | usually **resource key** | `LogEntry.atLeaf` | `src/LogEntry.ts` |

## Node log key rules

1. **Must equal** the `Node.Tag` key for that process: `WnbaNode.key` → node log key `"wnba/scores"`.
2. **Register** `Node.logs` (or `Hyperlink.store(Node)`) on the app `Store.Service`; query with `Logs.byNode(Node)`.
3. **Stamped** on every node-journal line as annotation key `LogAnnotationKeys.node` → node log key value.
4. **Two copies OK** — when both `Node.logs` and `Daemon.store` / `WorkPool.store` are registered, the same live line can land in both scopes (one append per active registration). Each scope’s durable tail seeds its `(scopeKey, lineId)` claim from existing `_logs` rows at acquire (rematerialize-safe).
5. Use **slash-separated** paths (`domain/role`), not placeholders (`my-node`, `node-a`, bare `wnba`).

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink";
import * as Node from "hyperlink-ts/Node"
import * as Logs from "hyperlink-ts/Logs";
import * as Daemon from "hyperlink-ts/Daemon";
import * as Store from "hyperlink-ts/Store";

class BillingNode extends Node.Tag<BillingNode>()("billing/scores") {}
class Daily extends Daemon.Tag<Daily>()("app/Daily") {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  BillingNode.logs,
  Daemon.store(Daily),
) {}

Effect.provide(program, AppStore.layerMemory)
const rows = yield* Logs.byNode(BillingNode, { limit: 200 })
```

```ts
// ❌ wrong — invented node log key, drifts from Node.Tag
Logs.byNode("my-node")
Logs.byNode("wnba") // WnbaNode.key is "wnba/scores", not "wnba"
```

## Hyperlink keys (per-resource logs)

Hyperlink identity uses **`tag.key`** (may contain `/`; metrics tags may use `@` prefix).

```ts
import * as Daemon from "hyperlink-ts/Daemon";
import * as Hyperlink from "hyperlink-ts/Hyperlink";
import * as Logs from "hyperlink-ts/Logs";
import * as LogEntry from "hyperlink-ts/LogEntry";
// example: resource-web/hub.ts
import { LiveNode, LiveScorePoller } from "./hub";

// resource key — LiveScorePoller.key === "wnba/LiveScorePoller"
const resourceKey = LiveScorePoller.key;

Logs.stream.pipe(Stream.filter(LogEntry.hasKey(resourceKey)));

yield* Logs.byHyperlink(resourceKey);

const { stream, query } = yield* Hyperlink.logs(LiveScorePoller);
```

## Architecture

```
BillingNode process (node log key: billing/scores)
  AppStore.layerMemory          → Logs.layer (baked in) + Storage + durable tails
  BillingNode.logs              → match-all follower → private `_logs` journal (node)
  Daemon.store(Daily)          → lineage follower → private `_logs` journal (resource)
  Logs.withScope(tag)           → appends resource key onto fiber lineage path
  Hyperlink.logs(tag)            → { stream, query } (live + durable)
```

- **Capture:** exactly one merged capture logger per node (`Logs.layer`, baked into `Store.Service`).
- **Bus:** one `Logs.Relay` (PubSub + bounded tail; internal Context tag remains `LogRelay`).
- **Durable tails:** Stream pipeline per registration — level ∧ match → claim → batch append; claim seeded from durable `_logs` at layer acquire.
- **Stream:** unfiltered on `Logs.stream`; `Hyperlink.logs` applies lineage + optional `logStreamLevel`.

## Node runtime

### Live only

```ts
import * as Logs from "hyperlink-ts/Logs";

Effect.provide(program, Logs.layer);

const tail = yield* Logs.snapshot;
const live = yield* Logs.stream;
```

### Live + durable (registration followers)

```ts
import * as Logs from "hyperlink-ts/Logs";
import * as Daemon from "hyperlink-ts/Daemon";
import * as Store from "hyperlink-ts/Store";
// example: resource-web/server.ts

class AppStore extends Store.Service<AppStore>("@app/Store")(
  WnbaNode.logs,
  Daemon.store(LiveScorePoller),
) {}

// Provide the store *into* the resource layer so Logs.layer is installed before
// auto-started WorkPool workers fork (Daemon can use either order — workers start on `run`).
Effect.provide(
  program,
  Daemon.layer(...).pipe(Layer.provideMerge(AppStore.layerMemory)),
)
```

### Query durable history

```ts
import * as Logs from "hyperlink-ts/Logs";

// node journal — everything this node's match-all follower captured
yield* Logs.byNode(WnbaNode, { limit: 500 });

// resource scope — durable journal for that registration (same as Hyperlink.logs().query locally)
yield* Logs.byHyperlink(LiveScorePoller, { limit: 100 });

const { query } = yield* Hyperlink.logs(LiveScorePoller);
yield* query({ limit: 100 });
```

## Per-resource export

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink";
import * as WorkPool from "hyperlink-ts/WorkPool";
import * as LogEntry from "hyperlink-ts/LogEntry";

class MailQueue extends WorkPool.Tag<MailQueue>()("app/Mail", spec).pipe(
  Hyperlink.withLogExport,
) {}

const resourceKey = MailQueue.key; // "app/Mail"

const { stream, query } = yield* Hyperlink.logs(MailQueue);

stream.pipe(Stream.filter(LogEntry.hasKey(resourceKey)));
const history = yield* query({ limit: 50 });
```

## LogEntry predicates

All predicate arguments are **lineage segment keys** (usually a **resource key** or **node log key**).

```ts
import * as LogEntry from "hyperlink-ts/LogEntry";
import { LiveNode, LiveScorePoller } from "resource-web/hub";

const nodeLogKey = LiveNode.key;           // "wnba/live"
const resourceKey = LiveScorePoller.key;   // "wnba/LiveScorePoller"

LogEntry.lineage(entry);                         // lineage segment keys[]
LogEntry.hasKey(resourceKey)(entry);
LogEntry.atRoot(nodeLogKey)(entry);              // lineage[0]
LogEntry.atLeaf(resourceKey)(entry);             // last segment
```

Lineage JSON uses annotation key `LogAnnotationKeys.lineage`. Hyperlink kind is `Hyperlink.kindOf(tag)` — there are no `processId` / `queueId` log annotations.

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

When the dashboard reaches resources over RPC, durable per-resource rows come from the node's journal
(`(yield* MyNode).logs.query`) filtered by **resource key**. Locally, `Hyperlink.logs(tag).query`
prefers registration Storage and falls back to the node-handle logs path when remote.

```ts
import * as LogEntry from "hyperlink-ts/LogEntry";
import { Stream } from "effect";

const resourceKey = LiveScorePoller.key;
const n = yield* LiveNode; // connected node handle

n.logs.stream.pipe(Stream.filter(LogEntry.hasKey(resourceKey)));

const rows = yield* n.logs.query({ limit: 300 });
const scoped = rows.filter(LogEntry.hasKey(resourceKey));
```

Example: `src/web/data.ts` (`hyperlinkLogsAtom`), `examples/web-dashboard/queue-data.ts` (`hyperlinkLogsAccumulator`).

Server must provide an app `Store.Service` with `Node.logs` (and desired toolkit stores) on the node stack — e.g. `DropletStore.layerMemory` in `examples/web-dashboard/queue-server.ts`. `httpServer` infers the node log key from served tags' bound `Node` for the handle’s `logs.query`.

## Migration

| Old | New |
|-----|-----|
| `Logs.persistLayer` + `hyperlink-ts/store/Log` | **Removed** — `Node.logs` + toolkit `.store` on `Store.Service` |
| `NodeLogs.*` / `/NodeLogs` | **Removed** — use `Logs.*` / `hyperlink-ts/Logs` |
| Process-store log facet | private `_logs` shape on toolkit store registrations (hidden from handle types) |
| `captureLogs` on engines | **Removed** — `Logs.layer` (baked into Store) + `Logs.withScope(tag)` |
| `queue.logs` / `proc.logs` on handle | `Hyperlink.logs(tag)` (local Storage / remote node-handle logs) |
| `HistoryStore` `${tag.key}/logs` | **Removed** — durable logs via registration `_logs` + `Hyperlink.logs` / `Logs.by*` |
| `HostLogs` (docs) | `Logs` |

## Verification

```bash
pnpm typecheck
pnpm test test/logs-resource.test.ts test/logs-durable-tail.test.ts test/host-logs-history.test.ts test/logs-two-copies-stream-level.test.ts test/process-log-history.test.ts
```
