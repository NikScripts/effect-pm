# Toolkit by example — every unique pattern a consumer writes

The complete DX surface for building services on the `Resource` toolkit, one example per
unique API. Code the way the downstream repo (e.g. `services-hub`) would actually write it.

> **Style:** PascalCase is for classes, types, and namespaces only (tags, hosts, groups).
> Everything else — layers, schemas, effects — is camelCase. Layer values use a `Layer` suffix.

> **Imports:** everything is on the barrel (`@nikscripts/effect-pm`). `QueueResource` is a single
> unified namespace — the toolkit `Tag` / `layer` / `serve` / `serveRemote` / `configure` plus the
> engine helpers (`make` / `Service` / `Schema` / `Errors`) — one import.
>
> **Browser/dashboard bundles:** for the smallest bundle, import the **light** queue surface from
> the subpath — `import { queueTag, queueStatus, configure } from "@nikscripts/effect-pm/QueueResource"`
> — which is **proven engine-free** (≈23kb, zero engine code) and tree-shakes in any bundler. The
> barrel `QueueResource.Tag` is functionally identical but may include the queue engine code
> depending on your bundler (it's pure-Effect with **no native deps**, so it never *breaks* a build —
> just larger). Guaranteed barrel-namespace tree-shaking is a tracked follow-up
> (`docs/plans/18-unbundled-build-treeshaking.md`).
>
> **Browser-safe tags — `import * as` from the subpath (proven engine-free):** for any module a
> browser bundle pulls (your shared tag definitions), import the namespace from the resource's
> subpath. You get the same `QueueResource.Tag` ergonomics, and it **tree-shakes** — zero engine code:
>
> ```ts
> import * as QueueResource from "@nikscripts/effect-pm/QueueResource";
> import * as Process from "@nikscripts/effect-pm/Process";
>
> class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/RosterQueue", rosterJob) {}
> // QueueResource.Tag / Process.Tag bundle with ZERO engine symbols (proven by the tree-shake check).
> ```
>
> The **barrel** `import { QueueResource }` is the same API but its namespace is materialized, so
> `QueueResource.Tag` from the barrel may include engine code (pure-Effect — never *breaks* a build,
> just larger). Use the barrel on the Node side (where you also call `.layer` / `.make` / `.serve`);
> use the `import * as … from "<subpath>"` form anywhere a browser bundles. Making the barrel
> namespace tree-shake too is the remaining follow-up (`docs/plans/18`).

---

## 1. Define a queue

The tag (a class) carries the **item schema** (validated on the wire). Config — including the
worker `effect` — lives in the **layer**, not the tag.

```ts
import { Effect, Schema } from "effect";
import { QueueResource } from "@nikscripts/effect-pm";
import { NwslsoccerClient } from "@services/api/nwslsoccer";

const rosterJob = Schema.Struct({ teamId: Schema.String, seasonId: Schema.String });

class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/RosterQueue", rosterJob) {}

// the worker effect's requirements (NwslsoccerClient) flow into the layer's R; job is inferred
const rosterQueueLayer = QueueResource.layer(RosterQueue, {
  effect: (job) =>
    Effect.gen(function* () {
      const client = yield* NwslsoccerClient;
      yield* client.team.getTeamRoster({
        params: { teamId: job.teamId },
        query: { seasonId: job.seasonId },
      });
    }),
  concurrency: 5,
});
```

## 2. Per-environment config (`.configure`)

A config-patch **layer** keyed by the tag — the successor to the old `.Service(...).configure(...)`.
Merge it with the base layer; the patch folds onto the config at build.

```ts
import { Duration, Layer } from "effect";

const rosterQueueProd = QueueResource.configure(RosterQueue, {
  concurrency: 3,
  rateLimit: { window: Duration.seconds(1), limit: 10 },
});

const prodLayer = rosterQueueLayer.pipe(Layer.provideMerge(rosterQueueProd));
```

## 3. Use a queue

```ts
const enqueueWork = Effect.gen(function* () {
  const queue = yield* RosterQueue;
  yield* queue.add({ teamId: "123", seasonId: "2026" }); // single
  yield* queue.add([jobA, jobB, jobC]);                  // batch — one RPC
  yield* queue.prioritize(urgentJob);                    // high priority
  yield* queue.defer(lowJob);                            // low priority
  const { high, normal, low } = yield* queue.sizes;
  const done = yield* queue.completed;
});
```

## 4. Refill on `Drained` (no refill hook needed)

```ts
import { Stream } from "effect";

const refillOnDrain = Effect.gen(function* () {
  const queue = yield* RosterQueue;
  yield* queue.events.pipe(
    Stream.filter((event) => event._tag === "Drained"),
    Stream.runForEach(() =>
      Effect.gen(function* () {
        const jobs = yield* loadRosterJobsFromDb;
        yield* queue.add(jobs);
      }),
    ),
  );
});
```

## 5. Define a process (polling)

A base `Process.Tag` is **always-armed** — it **runs immediately** with its layer. Add a schedule at
definition time with `.pipe(Process.schedule([…]))`; seed it empty (`Process.schedule([])`) to start
disarmed.

```ts
import { Duration, Effect } from "effect";
import { Polling, Process } from "@nikscripts/effect-pm";

class SeasonMatches extends Process.Tag<SeasonMatches>()("nwsl/SeasonMatches") {}

const seasonMatchesLayer = Process.layer(SeasonMatches, {
  effect: Effect.gen(function* () {
    const client = yield* NwslsoccerClient;
    yield* client.season.getSeasonMatches({ params: { seasonId } });
  }),
  polling: Polling.spaced(Duration.seconds(15)), // poll every 15s
});
```

## 6. Schedule context from inside a process effect

```ts
import { Process } from "@nikscripts/effect-pm";

const tick = Effect.gen(function* () {
  const id = yield* Process.currentScheduleId; // Option<string> — which window triggered this run
  const controls = yield* Process.scheduleControls; // { entries, set, add, clear }
  yield* doWork;
});
```

## 7. Drive a process

`status` is a reactive `ref`: `status.get` reads the current snapshot, `status.changes` streams it.

```ts
const driveProcess = Effect.gen(function* () {
  const proc = yield* SeasonMatches;
  yield* proc.runImmediately;                 // out-of-band run
  const status = yield* proc.status.get;      // { supervising, armed, activeInstances, nextTriggerRun,
                                              //   runsStarted, runsSucceeded, runsFailed, lastRunDurationMillis, ... }
  yield* proc.stop;                           // pause supervision
  yield* proc.start;                          // resume
});
```

A process defined with an inline schedule (`.pipe(Process.schedule([…]))`) additionally exposes a
`schedule` verb group — `schedule.entries` (a reactive `ref`), `schedule.set` / `add` / `clear`:

```ts
class Ingest extends Process.Tag<Ingest>()("nwsl/Ingest").pipe(Process.schedule([])) {}

const armWindows = Effect.gen(function* () {
  const proc = yield* Ingest;
  yield* proc.schedule.set([{ id: "game-1", startAt, stopAt }]); // specific run windows
  const windows = yield* proc.schedule.entries.get;
});
```

## 7b. Process execution store (auto-write on `Process.layer`)

Register **`Process.store(tag)`** on an app `Store.Service` and provide **`StoreScopeBridgeTag`**
at the root (`Store.Service.layerMemory` or the built-in default). On **`Process.layer`**, the engine
auto-appends terminal runs (`RunCompleted` / `RunFailed`) to the built-in execution contract.

```ts
import { Duration, Effect, Layer, Schema } from "effect";
import { Polling, Process } from "@nikscripts/effect-pm";
import * as Store from "@nikscripts/effect-pm/Store";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class Prices extends Process.Tag<Prices>()("app/Prices", Price) {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(Prices),
) {}

const pricesLayer = Process.layer(Prices, {
  effect: Effect.succeed({ symbol: "AAPL", usd: 42 }),
  polling: Polling.spaced(Duration.seconds(30)),
}).pipe(Layer.provide(AppStore.layerMemory));

// query persisted runs
const readRuns = Effect.gen(function* () {
  const store = yield* Prices.store;
  const events = yield* store.events({ limit: 20 });
  const latest = yield* Prices.result.get; // reactive Option when success is on the tag
});
```

See [process.md](./process.md) and `examples/forms/process-store/process-layer-store-auto-write.ts`.

## 8. A schedule as its own resource (reusable window manager)

`Process.Schedule` is a standalone schedule `Resource` — full CRUD (`set` / `add` / `upsert` /
`remove` / `removeMany` / `clear`), lookups (`get` / `has`), and a reactive `entries` ref. Gate any
number of processes with `Process.schedule(TheSchedule)`.

```ts
import { Effect, Stream } from "effect";
import { Process } from "@nikscripts/effect-pm";

class NwslCron extends Process.Schedule<NwslCron>()("nwsl/Cron") {}

const nwslCronLayer = Process.scheduleLayer(NwslCron, {
  initial: [Process.at("sdp-tick", startAt)],
});

const syncFromDb = Effect.gen(function* () {
  const cron = yield* NwslCron;
  yield* cron.set(entriesFromDb);
  yield* cron.entries.changes.pipe(Stream.runForEach((entries) => Effect.log(entries.length)));
});
```

## 9. Group resources (nested)

A `Group.Tag` is pure organization — a record of member tags (which can be other groups).

```ts
import { Group } from "@nikscripts/effect-pm";

class NwslGroup extends Group.Tag<NwslGroup>("hub/Nwsl")({
  RosterQueue,
  SeasonMatches,
  Cron: NwslCron,
}) {}

class ServicesHub extends Group.Tag<ServicesHub>("hub/ServicesHub")({
  Nwsl: NwslGroup,
  Ebwsl: EbwslGroup,
  Wnba: WnbaGroup,
}) {}

// reach a member through the tree (names preserved)
const useIt = Effect.gen(function* () {
  const queue = yield* ServicesHub.Nwsl.RosterQueue;
  yield* queue.add(job);
});
```

## 10. Bind a resource to a host (lives on another machine)

```ts
import { Resource } from "@nikscripts/effect-pm";

class MiniHost extends Resource.Host<MiniHost>("hosts/mini") {}

class LiveScorePoller extends Process.Tag<LiveScorePoller>()(
  "wnba/LiveScorePoller",
  { host: MiniHost },
) {}
```

## 11. The Droplet entrypoint — run local resources + reach the remote one

Each machine's entrypoint decides what it **runs** (provide its `.layer`, auto-starts) vs what it
**reaches** (`Resource.client` + `connect`). `Layer.launch` keeps the runtime alive.

```ts
import { Layer } from "effect";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

const dropletLayer = Layer.mergeAll(
  // local on the droplet — provided directly, start immediately
  rosterQueueLayer.pipe(Layer.provideMerge(rosterQueueProd)),
  seasonMatchesLayer,
  nwslCronLayer,
  // the poller runs on the mini — wire a client to reach it
  Resource.client(LiveScorePoller).pipe(
    Layer.provide(
      Resource.connectHttp(MiniHost, { url: "http://mini.local:3010/rpc" }),
    ),
  ),
  nwslClientLayer, // your worker-dependency layers (HTTP clients, import sources, …)
);

NodeRuntime.runMain(Layer.launch(dropletLayer));
```

## 12. The Mini entrypoint — serve the one resource it hosts

```ts
import { Duration, Layer } from "effect";
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

const miniLayer = Resource.httpServer([
  Process.serve(LiveScorePoller, {
    effect: pollLiveScores,
    polling: Polling.spaced(Duration.seconds(5)),
  }),
]).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 3010 })));

NodeRuntime.runMain(Layer.launch(miniLayer));
```

## 12b. Serve many resources on one host (`serve` / `httpServer`)

A host usually runs **several** resources on **one** port. `Resource.httpServer([...serve-layers])` mounts
them all behind one `/rpc` (+ an auto `/health` + `HostStatus`); each layer is built with a **spec-checked**
`serve` — `QueueResource.serve` / `Process.serve` (they carry the engine) or
`Resource.serve(tag, impl)` for a raw resource. It **unions** each layer's requirement (a queue's
worker `R`, an `ApiMetrics` `Scope`, …) into the layer's `R | HttpServer` — no per-entry cast. Use
`serveRemote` in place of `serve` for a served-only (gateway) node.

```ts
const dropletLayer = Resource.httpServer([
  QueueResource.serve(RosterImportQueue, { effect: importRoster, itemSchema: RosterItem }),
  Process.serve(SeasonMatches, { effect: fetchSeason, polling: Polling.spaced(hour) }),
  Resource.serve(Database, { status: pingStatus }),
]).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 3001 })));
```

Clients reach each member with `Resource.client(Tag)` over **one** `connectHttp(Host)` transport (§13).
Working references: `test/serve-all-queues.test.ts` (two real queue engines, one host, one port) and
`test/serve-all-http.test.ts`.

**When resources need _different_ implementations of the same dependency** (a hooked vs. plain source),
give each its **own** `Layer.provide` on the `serve` layer — because each layer carries its own
requirement, they stay isolated. See [per-resource-dependencies.md](./per-resource-dependencies.md).

## 13. Drive a remote resource — identical to local

The whole point of location transparency: the consuming code doesn't change, only the layer.

```ts
const program = Effect.gen(function* () {
  const poller = yield* LiveScorePoller; // resolves to the MiniHost transport
  const status = yield* poller.status.get;
});
// provided with: Resource.client(LiveScorePoller).pipe(Layer.provide(connectHttp(MiniHost, ...)))
```

## 14. CustomQueueResource — N-level queues

Use when you need more than high/normal/low. Same toolkit pattern as `QueueResource`, but the tag
takes **lane config positionally** and `add` is **`add(item, level?)`**:

```ts
import { CustomQueueResource } from "@nikscripts/effect-pm";
import { Schema } from "effect";

const Job = Schema.Struct({ id: Schema.String });

class ImportJobs extends CustomQueueResource.Tag<ImportJobs>()(
  "nwsl/ImportJobs",
  Job,
  5,
  { live: 0, roster: 4 },
) {}

const importJobsLayer = CustomQueueResource.layer(ImportJobs, {
  levelCount: 5,
  namedLevels: { live: 0, roster: 4 },
  takeAlgorithm: "weighted",
  effect: (job) => processImport(job),
});

// Same yield* ImportJobs code local or remote; only the layer changes.
const program = Effect.gen(function* () {
  const queue = yield* ImportJobs;
  yield* queue.add({ id: "evt-1" }, "live");
  const sizes = yield* queue.sizes; // { live: 1, "1": 0, ... }
});
```

Contract-only import (tree-shake engine):

```ts
import * as CustomQueueResource from "@nikscripts/effect-pm/CustomQueueResource";
```

See [`docs/RESOURCE-API.md`](../RESOURCE-API.md#customqueueresource) and
[`examples/forms/queue/custom-queue-resource-n-level.ts`](../../examples/forms/queue/custom-queue-resource-n-level.ts).

## 15. HttpApiResource — a concurrency-gated client (compat helper)

```ts
import { HttpApiResource } from "@nikscripts/effect-pm";

const nwslClientLayer = HttpApiResource.layerEffect(
  NwslsoccerClient,
  buildNwslClient, // your Effect that builds the client
  { concurrency: 8 }, // gate the transport
);
```

## 16. A generic UI — walk the tree + introspect each contract

This is all a dashboard/TUI needs: enumerate, introspect, drive.

```ts
import { Group, specOf, methodMeta, Resource } from "@nikscripts/effect-pm";

const renderNode = (node: { readonly members: Record<string, unknown> }) => {
  for (const [name, member] of Object.entries(Group.members(node))) {
    if (Group.isGroup(member)) {
      renderNode(member); // recurse — it's a subgroup
      continue;
    }
    // a leaf resource: render a widget per contract method
    for (const [verb, method] of Object.entries(specOf(member))) {
      const { kind, description, destructive, streaming } = methodMeta(method);
      // kind "query" → read panel; streaming → live panel;
      // kind "mutate" + destructive → confirm-before button; description → label
    }
  }
};

// drive any member over RPC the same way:
// const svc = yield* SomeTag  // provided via Resource.client(SomeTag) + connect(host)
```

---

## ServicesHub (wow-sports) — what we're actually building & dashboard priorities

This package exists to run **`services-hub`** (the `wow-sports` repo). The live dashboard + TUI
target that `ServicesHub` group. Concrete shape today:

```
ServicesHub
├── Nwsl   — 2 processes + 3 queues
│     ├── NwslGetSeasonMatches      (process, polls season matches/standings ~15s)
│     ├── NwslLiveScorePoller       (process, live scores — game-day real-time)
│     ├── NwslRosterImportQueue     (queue)
│     ├── NwslTeamMediaImportQueue  (queue)
│     └── NwslPlayerMediaImportQueue(queue)
├── Wnba   — 4 processes
│     ├── WnbaIncrementalSeasonImport (process)
│     ├── WnbaLiveScorePoller         (process, live scores — game-day real-time)
│     ├── WnbaSeasonApiFetch          (process)
│     └── WnbaCoreKeyHealthCheck      (process, health/credential check)
└── Ebwsl  — scaffolded, no resources yet (coming)
```

**Migration state:** the consumer's services are being migrated onto the `.Tag` toolkit surface
(`.Tag` + a separate `.layer` / `serve`, examples 1–14 above). Build the dashboard against that
toolkit surface — `Resource.client` + the resource tags (see
[history-and-persistence.md](./history-and-persistence.md) for the data layer).

**Deploy topology** (see examples 10–13): the hub and all three league groups run on **one
Droplet**; **one or two processes** (most likely a live-score poller) are peeled off to the
**Mini** via a `Host`. The dashboard reaches every member uniformly with `Resource.client` +
`connect` — a member on the Mini looks identical to a local one; only its host differs.

### Dashboard build priority

1. **Tree navigation** — walk `ServicesHub` with `Group.members` + `Group.isGroup` (example 15) to
   render Hub → league → resource. This is the skeleton everything hangs off.
2. **Live status grid** — per resource, subscribe to the `status.changes` stream (`status.get` for
   first paint): processes show `supervising` / `armed` / `activeInstances` / `nextTriggerRun` plus **run
   metrics** (`runsStarted` / `runsSucceeded` / `runsFailed` / `lastRunDurationMillis` — render
   success rate + last-run timing); queues show per-priority `sizes`, `paused`, `completed`. This is
   the at-a-glance health board.
3. **Live-score pollers, front and center** — `NwslLiveScorePoller` / `WnbaLiveScorePoller` are the
   real-time, game-day-critical ones. Surface their status + recent runs prominently; this is the
   "live" in live dashboard.
4. **Queue throughput** — the three NWSL import queues: render `sizes` (depth) + `completed` +
   `metrics` (windowed throughput/latency) as progress/rate widgets.
5. **Logs drill-in** — per-resource `logs` stream for debugging a misbehaving poller/queue.
6. **Controls** — actuate from the UI: process `start`/`stop`/`runImmediately`/`schedule.set`;
   queue `pause`/`resume`/`add`/`clear`. Use `methodMeta` (`destructive`) to gate confirm dialogs.

Don't render from a hand-maintained list — derive everything from the contract via `specOf` +
`methodMeta` (example 15), so new resources (Ebwsl, future leagues) appear automatically.
