# Service tags vs runtime layers (bundler-safe split)

Keep the **tag** (identity + contract) separate from the **runtime** (layers, `serveHttp`, storage,
native adapters). A browser/dashboard bundle imports only the tag; the engine, SQL adapters, and
Node bits never get pulled in.

## Why

A resource tag is just an identity + spec. The dashboard does `Resource.client(Tag)` and
`yield* Tag` — it needs the **tag**, not the engine. If tags and runtime wiring live in one module,
a client bundle resolves the engine (and its native deps). Splitting them keeps client bundles tiny
and safe (proven: tag-only subpath imports bundle to a few kb with **zero** engine code).

## The split

```ts
// tags.ts — browser-safe. Import the tag namespace from its subpath (tree-shakes per member).
import * as QueueResource from "@nikscripts/effect-pm/QueueContract";
import * as ScheduledProcess from "@nikscripts/effect-pm/ScheduledProcess";

export class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/RosterQueue", Job) {}
export class LiveScores extends ScheduledProcess.Tag<LiveScores>()("nwsl/LiveScores") {}
```

```ts
// runtime.ts — Node OS edge only. Layers, serveHttp, storage, persistence.
import { Layer } from "effect";
import { QueueResource } from "@nikscripts/effect-pm/QueueContract";
import { SQLiteHistoryStore } from "@nikscripts/effect-pm/storage/sqlite";
import { RosterQueue } from "./tags";

export const RosterQueueLive = QueueResource.serveHttp(RosterQueue, { effect, captureLogs: true })
  .pipe(Layer.provide(SQLiteHistoryStore.layer({ filename: "history.db" })));
```

```ts
// dashboard (browser) — only the tag + a client transport.
import { Resource } from "@nikscripts/effect-pm/Resource";
import { RosterQueue } from "./tags";

const queue = yield* RosterQueue;            // resolved from Resource.client(RosterQueue)
yield* queue.logHistory({ limit: 200 });
```

## Rule of thumb

If a file calls `Layer.provide` / `serveHttp` / `SQLiteRuntimeStorage` / a storage adapter, it
belongs in **runtime**, not beside your client/widget imports. Import tag namespaces from their
**subpaths** (`@nikscripts/effect-pm/QueueContract`, `/ScheduledProcess`, `/Group`, …) so member
access tree-shakes.

See [history-and-persistence.md](./history-and-persistence.md) for the dashboard data layer
(query-then-tail) and [toolkit-by-example.md](./toolkit-by-example.md) for full patterns.
