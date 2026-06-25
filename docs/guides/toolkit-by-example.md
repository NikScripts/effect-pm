# Toolkit by example — every unique pattern a consumer writes

The complete DX surface for building services on the `Resource` toolkit, one example per
unique API. Code the way the downstream repo (e.g. `services-hub`) would actually write it.

> **Style:** PascalCase is for classes, types, and namespaces only (tags, hosts, groups).
> Everything else — layers, schemas, effects — is camelCase. Layer values use a `Layer` suffix.

> **Imports:** most things are on the barrel (`@nikscripts/effect-pm`). The toolkit queue is on a
> subpath (`@nikscripts/effect-pm/QueueContract`) because the barrel `QueueResource` name is still
> the legacy engine during migration.

---

## 1. Define a queue

The tag (a class) carries the **item schema** (validated on the wire). Config — including the
worker `effect` — lives in the **layer**, not the tag.

```ts
import { Effect, Schema } from "effect";
import { QueueResource } from "@nikscripts/effect-pm/QueueContract";
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
  const status = yield* proc.statusNow;       // { supervising, armed, activeInstances, nextTriggerRun, ... }
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
