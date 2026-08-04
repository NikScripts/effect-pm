# Effect Hyperlink (`hyperlink-ts`)

The web made documents location-transparent; Effect Hyperlink does it for services.

Effect-first **process orchestration** and **location-transparent services** for long-running
applications — managed daemons, work pools, and schedules that you drive with the **same
`yield* Tag` code whether they run local or remote**.

```bash
pnpm add hyperlink-ts effect
```

> Pre-1.0 (`0.9.0-beta.x`). Breaking changes land as minor bumps until 1.0.

## The model

Everything is a **`Hyperlink`** — a tag whose contract is the spec. The *same* code reads and
controls it; only the provided layer decides where it runs:

```ts
const queue = yield* RosterQueue;   // identical local or over RPC
yield* queue.add(job);
yield* queue.status.get;
```

- **`Hyperlink`** — the foundation: `Tag` + `layer` (local), `serve` (host, composed with
  `Node.httpServer` / `wsServer`), `client` / `connect` (remote). Contracts are introspectable
  via `specOf` / `methodMeta` (build generic UIs).
- **`WorkPool`** — priority **work pools** with concurrency, optional `rateLimit`, `attempts` retry,
  **`refill`** (self-feeding from a source), and durable history via `WorkPool.store` on a
  `Store.Service`. Per-HyperService logs use the **`Logs`** platform + **`Hyperlink.logs`**.
- **`Daemon`** — a supervised long-running process: lifecycle (`start`/`stop`/`run`), reactive
  `status`, schedule control, optional reactive `result`. Logs via **`Hyperlink.logs`**.
- **`Group`** — organize member tags (nestable; members may live on the same or different nodes).

## Quick start

### A work pool

```ts
import { Effect, Layer, Schema, Stream } from "effect";
import * as WorkPool from "hyperlink-ts/WorkPool";

const Job = Schema.Struct({ id: Schema.String });
class RosterQueue extends WorkPool.Service<RosterQueue>()("nwsl/RosterQueue", {
  payload: Job,
}) {}

const layer = WorkPool.layer(RosterQueue, {
  effect: (job) => importRoster(job),
  concurrency: 4,
  attempts: 3,
});

const program = Effect.gen(function* () {
  const queue = yield* RosterQueue;
  yield* queue.add({ id: "thorns" });
  yield* queue.metrics.pipe(Stream.runForEach(render), Effect.forkScoped);
}).pipe(Effect.provide(layer), Effect.scoped);
```

A **self-feeding** pool:

```ts
WorkPool.layer(RosterQueue, {
  effect,
  refill: { onStart: true, onDrained: true, load: (queue) => loadFromDb(queue) },
});
```

### A managed daemon

```ts
import * as Daemon from "hyperlink-ts/Daemon";

class LiveScores extends Daemon.Service<LiveScores>()("nwsl/LiveScores") {}

const layer = Daemon.layer(LiveScores, {
  effect: pollLiveScores,
  // `polling` sets the cadence; add a schedule at definition with `.pipe(Daemon.schedule([…]))`
});
// elsewhere: yield* (yield* LiveScores).run
```

### Remote (the dashboard path)

```ts
import { Effect, Layer, Stream } from "effect";
import * as Hyperlink from "hyperlink-ts/Hyperlink";
import * as Node from "hyperlink-ts/Node";
import * as Store from "hyperlink-ts/Store";
import * as WorkPool from "hyperlink-ts/WorkPool";
import * as LogEntry from "hyperlink-ts/LogEntry";

class Droplet extends Node.Service<Droplet>()("hub/droplet") {}
class AppStore extends Store.Service<AppStore>("@app/Store")(
  Droplet.logs,
  WorkPool.store(RosterQueue),
) {}

// host — engines soft-default Memory; AppStore overrides Soft capture (bakes Logs + journals)
Node.httpServer([WorkPool.serve(RosterQueue, { effect })]).pipe(
  Layer.provide(AppStore.layerMemory),
);

// dashboard — same Tag over RPC; node-handle logs + lineage filter
// (see docs/guides/logs.md — Remote clients)
const n = yield* Droplet;
n.logs.stream.pipe(Stream.filter(LogEntry.hasKey(RosterQueue.key)));
const { stream, query } = yield* Hyperlink.logs(RosterQueue); // local Storage / remote node handle
```

Dial a nodeless tag over http with `Hyperlink.connect(tag, Hyperlink.protocolHttp(3009))`
(bare ports resolve via `HYPERLINK_CLIENT_HOST`, default `localhost`).

## Persistence

Two planes, both opt-in, same `yield* Tag` surface, in-memory or SQLite:

- **Durability** — queue/engine journals via toolkit `*.store(tag)` on a `Store.Service`. Enable
  persistence on the pool; a restart recovers in-flight work.
- **Observability history** — runtime-wide logs use `Node.logs` / toolkit `*.store` on a
  `Store.Service` and read back with `Logs.byNode` / `Logs.byHyperlink` / `Hyperlink.logs(tag)`.
  Persist the store with `AppStore.layer({ filename })`. Status / logs / ping on a remote node are
  `(yield* MyNode).status` / `.logs` / `.ping`.

## Docs

| Doc | What |
|---|---|
| [docs/guides/logs.md](./docs/guides/logs.md) | Logs platform — keys, `Hyperlink.logs`, remote node-handle tails |
| [docs/guides/work-pools.md](./docs/guides/work-pools.md) | Work pools end to end |
| [docs/guides/stores.md](./docs/guides/stores.md) | Store composition recipe |
| [docs/index.md](./docs/index.md) | Live book |
| [AGENTS.md](./AGENTS.md) | Repo map / branch policy for agents |

## License

MIT
