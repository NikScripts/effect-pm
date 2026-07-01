# @nikscripts/effect-pm

Effect-first **process orchestration** and **location-transparent resources** for long-running
applications — managed processes, priority queues, and schedules that you drive with the **same
`yield* Tag` code whether they run local or remote**.

```bash
pnpm add @nikscripts/effect-pm effect
```

> Pre-1.0 (`0.8.0-beta.x`). Breaking changes land as minor bumps until 1.0.

## The model

Everything is a **`Resource`** — a tag whose contract is the spec. The *same* code reads and
controls it; only the provided layer decides where it runs:

```ts
const queue = yield* RosterQueue;   // identical local or over RPC
yield* queue.add(job);
yield* queue.statusNow;
```

- **`Resource`** — the foundation: `Tag` + `layer` (local), `server` / `serveHttp` (host),
  `client` / `connect` (remote), `Host` / `serveInstances` (many instances behind one transport).
  Contracts are introspectable via `specOf` / `methodMeta` (build generic UIs).
- **`QueueResource`** — three-level **priority** queues with concurrency, optional `rateLimit`,
  `attempts` retry, `captureLogs`, **`refill`** (self-feeding from a source), and **`persist`**
  (durable, at-least-once).
- **`ScheduledProcess`** — a managed process: lifecycle (`start`/`stop`/`runImmediately`),
  observability (`status`/`logs`/`logHistory`), and schedule control. Built on the `Process` engine
  + `Polling` (in-instance cadence) + `ProcessSchedule` (when it's armed).
- **`ProcessScheduleResource`** — a schedule as a controllable resource (CRUD + `reconcile` +
  `changes` stream).
- **`Group`** — organize member tags (nestable; members may live on the same or different hosts).

## Quick start

### A priority queue

```ts
import { Effect, Layer, Schema, Stream } from "effect";
import { QueueResource } from "@nikscripts/effect-pm/QueueContract";

const Job = Schema.Struct({ id: Schema.String });
class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/RosterQueue", Job) {}

const layer = QueueResource.layer(RosterQueue, {
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

A **self-feeding** queue (the toolkit equivalent of `onStart` / `onDrained` refill):

```ts
QueueResource.layer(RosterQueue, {
  effect,
  refill: { onStart: true, onDrained: true, load: (queue) => loadFromDb(queue) },
});
```

### A scheduled process

```ts
import { ScheduledProcess } from "@nikscripts/effect-pm";

class LiveScores extends ScheduledProcess.Tag<LiveScores>()("nwsl/LiveScores") {}

const layer = ScheduledProcess.layer(LiveScores, {
  effect: pollLiveScores,
  // `schedule` + `polling` control when / how often it runs
});
// elsewhere: yield* (yield* LiveScores).runImmediately
```

### Remote (the dashboard path)

```ts
// host (Droplet / Mini)
QueueResource.serveHttp(RosterQueue, { effect, captureLogs: true })
  .pipe(Layer.provide(HistoryStore.layerMemory()));

// dashboard (browser) — same Tag, over the wire (from Resource.client(RosterQueue))
const queue = yield* RosterQueue;
const recent = yield* queue.logHistory({ limit: 200 });               // backfill
yield* queue.logs.pipe(Stream.runForEach(render), Effect.forkScoped); // then tail
```

## Persistence

Two planes, both opt-in, same `yield* Tag` surface, in-memory or SQLite:

- **Durability** — `DurableQueueStore` (priority-native, at-least-once + dedup). Enable with
  `persist` on the queue; a restart recovers in-flight work.
- **Observability history** — `HistoryStore` backs `logHistory` / `metricsHistory`; runtime-wide logs
  are durably stored by `HostLogs.persistLayer(host)` (into `LogStore`) and read back with
  `HostLogs.byHost` / `HostLogs.byResource`. `SQLiteHistoryStore.layer` / `SQLiteDurableQueueStore.layer`
  from `@nikscripts/effect-pm/storage/sqlite` make these durable across restarts.

Process / run analytics use `ProcessStore` / `ProcessStorage` over `RuntimeStorage`
(`@nikscripts/effect-pm/storage/{sqlite,redis}`).

## Docs

| Doc | What |
|---|---|
| [docs/guides/toolkit-by-example.md](./docs/guides/toolkit-by-example.md) | Every resource / group / host / UI pattern |
| [docs/guides/history-and-persistence.md](./docs/guides/history-and-persistence.md) | History, durable queue, the dashboard data layer |
| [docs/PROCESS-API.md](./docs/PROCESS-API.md) | Spec tables for `Process`, `Polling`, `ProcessSchedule` |
| [docs/STORAGE.md](./docs/STORAGE.md) | Persistence model (the SSOT) |
| [docs/PACKAGE-GUIDE.md](./docs/PACKAGE-GUIDE.md) | Narrative architecture |
| [docs/AGENTS.md](./docs/AGENTS.md) | Repo map for agents |

## License

MIT
