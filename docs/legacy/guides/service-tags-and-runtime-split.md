# Service tags vs runtime layers (bundler-safe split)

Keep the **tag** (identity + contract) separate from the **runtime** (layers, `serve` / `httpServer`,
storage, native adapters). A browser/dashboard bundle imports only the tag; the engine, SQL adapters,
and Node bits never get pulled in.

## Why

A resource tag is just an identity + spec. The dashboard does `Hyperlink.client(Tag)` and
`yield* Tag` — it needs the **tag**, not the engine. If tags and runtime wiring live in one module,
a client bundle resolves the engine (and its native deps). Splitting them keeps client bundles tiny
and safe (proven: tag-only subpath imports bundle to a few kb with **zero** engine code).

## The split

```ts
// tags.ts — browser-safe. Import the tag namespace from its subpath (tree-shakes per member).
import * as WorkPool from "hyperlink-ts/WorkPool";
import * as Daemon from "hyperlink-ts/Daemon";
import * as Hyperlink from "hyperlink-ts/Hyperlink";

export class Droplet extends Hyperlink.Node<Droplet>("hub/droplet") {}
export class RosterQueue extends WorkPool.Tag<RosterQueue>()("nwsl/RosterQueue", {
  payload: Job,
  node: Droplet,
}) {}
export class LiveScores extends Daemon.Tag<LiveScores>()("nwsl/LiveScores") {}
```

```ts
// runtime.ts — Node OS edge only. Layers, serve / httpServer, storage, persistence.
import { Layer } from "effect";
import { Hyperlink } from "hyperlink-ts/Hyperlink";
import { WorkPool } from "hyperlink-ts/WorkPool";
import * as Logs from "hyperlink-ts/Logs";
import * as DaemonStorage from "hyperlink-ts/DaemonStorage";
import { SQLiteHistoryStore } from "hyperlink-ts/storage/sqlite";
import { Droplet, RosterQueue } from "./tags";

export const RosterQueueLive = Hyperlink.httpServer([
  WorkPool.serve(RosterQueue, { effect }),
]).pipe(
  Layer.provide(SQLiteHistoryStore.layer({ filename: "history.db" })), // metrics.query
  Layer.provide(Logs.layer),
  Layer.provide(Logs.persistLayer(Droplet)),
  Layer.provide(DaemonStorage.layer),
);
```

```ts
// dashboard (browser) — only the tag + a client transport; logs via NodeStatus + lineage.
import * as LogEntry from "hyperlink-ts/LogEntry";
import * as NodeStatus from "hyperlink-ts/NodeStatus";
import { Hyperlink } from "hyperlink-ts/Hyperlink";
import { RosterQueue } from "./tags";

const queue = yield* RosterQueue; // resolved from Hyperlink.client(RosterQueue)
yield* queue.metrics.query({ limit: 200 });

const rows = yield* NodeStatus.logs.query({ limit: 300 });
const scoped = rows.filter(LogEntry.hasKey(RosterQueue.key));
```

## Rule of thumb

If a file calls `Layer.provide` / `serve` / `httpServer` / `SQLiteRuntimeStorage` / a storage adapter,
it belongs in **runtime**, not beside your client/widget imports. Import tag namespaces from their
**subpaths** (`hyperlink-ts/WorkPool`, `/Daemon`, `/Group`, …) so member
access tree-shakes.

See [history-and-persistence.md](./history-and-persistence.md) for the dashboard data layer
(query-then-tail), [`docs/LOGS.md`](../../LOGS.md) for the logs platform, and
[toolkit-by-example.md](./toolkit-by-example.md) for full patterns.
