# Toolkit by example — every unique pattern a consumer writes

The complete DX surface for building services on the `Resource` toolkit, one example per
unique API. Code the way the downstream repo (e.g. `services-hub`) would actually write it.

> **Style:** PascalCase is for classes, types, and namespaces only (tags, hosts, groups).
> Everything else — layers, schemas, effects — is camelCase. Layer values use a `Layer` suffix.

> **Imports:** everything is on the barrel (`@nikscripts/effect-pm`). `QueueResource` is a single
> unified namespace — the toolkit `Tag` / `layer` / `server` / `serveHttp` / `configure` plus the
> engine helpers (`make` / `Service` / `Schema` / `Errors`) — one import.
>
> **Browser/dashboard bundles:** for the smallest bundle, import the **light** queue surface from
> the subpath — `import { queueTag, queueStatus, configure } from "@nikscripts/effect-pm/QueueContract"`
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
> import * as QueueResource from "@nikscripts/effect-pm/QueueContract";
> import * as ProcessResource from "@nikscripts/effect-pm/ProcessContract";
> import * as ProcessScheduleResource from "@nikscripts/effect-pm/ProcessScheduleContract";
>
> class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/RosterQueue", rosterJob) {}
> // QueueResource.Tag/ProcessResource.Tag bundle to ~27kb with ZERO engine symbols (proven).
> ```
>
> The **barrel** `import { QueueResource }` is the same API but its namespace is materialized, so
> `QueueResource.Tag` from the barrel may include engine code (pure-Effect — never *breaks* a build,
> just larger). Use the barrel on the Node side (where you also call `.layer` / `.make` / `.serveHttp`);
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

Default schedule is `alwaysArmed` — it **runs immediately** with its layer. Pass
`schedule: ProcessSchedule.empty` to start disarmed.

```ts
import { Duration, Effect } from "effect";
import { Polling, ProcessResource } from "@nikscripts/effect-pm";

class SeasonMatches extends ProcessResource.Tag<SeasonMatches>()("nwsl/SeasonMatches") {}

const seasonMatchesLayer = ProcessResource.layer(SeasonMatches, {
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

```ts
const driveProcess = Effect.gen(function* () {
  const proc = yield* SeasonMatches;
  yield* proc.runImmediately;                 // out-of-band run
  const status = yield* proc.statusNow;       // { supervising, armed, activeInstances, nextTriggerRun,
                                              //   runsStarted, runsSucceeded, runsFailed, lastRunDurationMillis, ... }
  yield* proc.setSchedule([{ id: "game-1", startAt, stopAt }]); // specific run windows
  yield* proc.stop;                           // pause supervision
  yield* proc.start;                          // resume
});
```

## 8. A schedule as its own resource (CRUD + reconcile)

```ts
import { ProcessScheduleResource } from "@nikscripts/effect-pm";

class NwslCron extends ProcessScheduleResource.Tag<NwslCron>()("nwsl/Cron") {}

const nwslCronLayer = ProcessScheduleResource.layer(NwslCron, {
  initial: [{ id: "sdp-tick", startAt }],
});

const syncFromDb = Effect.gen(function* () {
  const cron = yield* NwslCron;
  const result = yield* cron.reconcile(entriesFromDb); // { added, updated, removed, unchanged }
  yield* cron.changes.pipe(Stream.runForEach((entries) => Effect.log(entries.length)));
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

class LiveScorePoller extends ProcessResource.Tag<LiveScorePoller>()(
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

const miniLayer = ProcessResource.serveHttp(LiveScorePoller, {
  effect: pollLiveScores,
  polling: Polling.spaced(Duration.seconds(5)),
}).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 3010 })));

NodeRuntime.runMain(Layer.launch(miniLayer));
```

## 13. Drive a remote resource — identical to local

The whole point of location transparency: the consuming code doesn't change, only the layer.

```ts
const program = Effect.gen(function* () {
  const poller = yield* LiveScorePoller; // resolves to the MiniHost transport
  const status = yield* poller.statusNow;
});
// provided with: Resource.client(LiveScorePoller).pipe(Layer.provide(connectHttp(MiniHost, ...)))
```

## 14. HttpApiResource — a concurrency-gated client (compat helper)

```ts
import { HttpApiResource } from "@nikscripts/effect-pm";

const nwslClientLayer = HttpApiResource.layerEffect(
  NwslsoccerClient,
  buildNwslClient, // your Effect that builds the client
  { concurrency: 8 }, // gate the transport
);
```

## 15. A generic UI — walk the tree + introspect each contract

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

**Migration state:** these are still defined with the legacy `.Service` API and live behind a
`ProcessGroup` + `ControlService` control port reached by the `pm` CLI. They are being rewritten
to `.Tag` + separate `.layer` (examples 1–14 above). The dashboard should be built against the
**`.Tag` toolkit surface**, not the legacy control plane.

**Deploy topology** (see examples 10–13): the hub and all three league groups run on **one
Droplet**; **one or two processes** (most likely a live-score poller) are peeled off to the
**Mini** via a `Host`. The dashboard reaches every member uniformly with `Resource.client` +
`connect` — a member on the Mini looks identical to a local one; only its host differs.

### Dashboard build priority

1. **Tree navigation** — walk `ServicesHub` with `Group.members` + `Group.isGroup` (example 15) to
   render Hub → league → resource. This is the skeleton everything hangs off.
2. **Live status grid** — per resource, subscribe to the `status` stream (`statusNow` for first
   paint): processes show `supervising` / `armed` / `activeInstances` / `nextTriggerRun` plus **run
   metrics** (`runsStarted` / `runsSucceeded` / `runsFailed` / `lastRunDurationMillis` — render
   success rate + last-run timing); queues show per-priority `sizes`, `paused`, `completed`. This is
   the at-a-glance health board.
3. **Live-score pollers, front and center** — `NwslLiveScorePoller` / `WnbaLiveScorePoller` are the
   real-time, game-day-critical ones. Surface their status + recent runs prominently; this is the
   "live" in live dashboard.
4. **Queue throughput** — the three NWSL import queues: render `sizes` (depth) + `completed` +
   `metrics` (windowed throughput/latency) as progress/rate widgets.
5. **Logs drill-in** — per-resource `logs` stream for debugging a misbehaving poller/queue.
6. **Controls** — actuate from the UI: process `start`/`stop`/`runImmediately`/`setSchedule`;
   queue `pause`/`resume`/`add`/`clear`. Use `methodMeta` (`destructive`) to gate confirm dialogs.

Don't render from a hand-maintained list — derive everything from the contract via `specOf` +
`methodMeta` (example 15), so new resources (Ebwsl, future leagues) appear automatically.
