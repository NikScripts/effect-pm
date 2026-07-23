/**
 * @module examples/resource-web/server
 *
 * The **WNBA node** — a node process serving the hub's box-score queue and live-score poller over a
 * **WebSocket** (`wsServer(...)`) on one port, plus the `Node.status` that the
 * server auto-mounts. The browser dashboard reaches it via `Hyperlink.ws(WnbaNode, …)`
 * (vite proxies `/rpc` here with `ws: true`) — one multiplexed connection carries every resource's
 * status/metrics/logs streams, which HTTP/1.1's ~6-connection cap would otherwise starve. Run:
 * `pnpm run example:resource-web-server` (alongside `pnpm run example:resource-web`).
 */
import { Clock, Console, DateTime, Duration, Effect, Layer, Random, Stream } from "effect";
// A node node entry point — the raw http server is exactly what `NodeHttpServer.layer` wants.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Hyperlink from "../../src/Hyperlink";
import { serve as queueEntry } from "../../src/WorkPool";
import * as FleetHealth from "../../src/FleetHealth";
import * as Telemetry from "../../src/Telemetry";
import * as ShardMap from "../../src/ShardMap";
import * as Gate from "../../src/Gate";
import { serve as processEntry } from "../../src/Daemon";
import { HistoryStore } from "../../src/HistoryStore";
import * as Logs from "../../src/Logs";
import { Polling } from "../../src/Polling";
import * as Store from "../../src/Store";
import * as WorkPool from "../../src/WorkPool";
import * as Daemon from "../../src/Daemon";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../../src/ApiUsageSchema";
import { BoxScoreQueue, FetchGate, HOST_PORTS, ImportJobs, LiveNode, LiveScorePoller, MeshHealth, FleetMetrics, PlayByPlayQueue, ScoresApi, ScoresDb, Sessions, StatsNode, WnbaNode, WorkerPool } from "./hub";
import { combineByNode, combineQuery, combineSum } from "../../src/MultiNode";
import * as Node from "../../src/Node";

const WNBA_PORT = HOST_PORTS.wnba;
const LIVE_PORT = HOST_PORTS.live;
const STATS_PORT = HOST_PORTS.stats;

// The WorkerPool impl, Effect form (spec-checked by `serve`): resolve `peers` once, then
// `fleetActive` folds the peers' `active` + this node's own. `own` varies per node so the fleet total
// is meaningful; the impl's `peers` requirement is discharged by `peersLayer` at each serve.
const workerPoolImpl = (own: number) =>
  Effect.gen(function* () {
    const peers = yield* Hyperlink.peers(WorkerPool);
    const self = yield* Hyperlink.selfNode(WorkerPool); // which node am I — no hand-threaded key
    return {
      active: Effect.succeed(own),
      fleetActive: combineQuery(peers, (p) => p.active, combineSum).pipe(
        Effect.map((others) => own + others),
      ),
      // a per-node map: peers folded by node + this instance's own row, keyed by `self`
      activeByNode: Effect.gen(function* () {
        const byNode = yield* combineQuery(peers, (p) => p.active, combineByNode);
        return { ...byNode, [self]: own };
      }),
    };
  });

const importWorker = (job: { readonly id: string }) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`importing ${job.id}`);
    yield* Effect.sleep(Duration.millis(400));
  });

// A producer that enqueues jobs at all three priorities in waves, so the queue widgets show live
// pending (high/normal/low) + done + throughput and the worker logs flow. Workers drain each burst
// (concurrency 3), so the backlog oscillates instead of exploding — a stand-in for a real upstream.
const loadQueue = (
  enqueue: {
    readonly prioritize: (items: ReadonlyArray<{ readonly id: string }>) => Effect.Effect<unknown, unknown>;
    readonly add: (items: ReadonlyArray<{ readonly id: string }>) => Effect.Effect<unknown, unknown>;
    readonly defer: (items: ReadonlyArray<{ readonly id: string }>) => Effect.Effect<unknown, unknown>;
  },
  label: string,
) =>
  Effect.forkScoped(
    Effect.gen(function* () {
      let n = 0;
      const jobs = (count: number) => Array.from({ length: count }, () => ({ id: `${label}-${n++}` }));
      while (true) {
        yield* enqueue.prioritize(jobs(yield* Random.nextIntBetween(2, 6)));
        yield* enqueue.add(jobs(yield* Random.nextIntBetween(3, 8)));
        yield* enqueue.defer(jobs(yield* Random.nextIntBetween(4, 10)));
        yield* Effect.sleep(Duration.seconds(yield* Random.nextIntBetween(4, 8)));
      }
    }),
  );

// ── WNBA live-score poller: armed only around game time ──────────────────────
// In a real app you'd fetch the league schedule from a sports API; here we mock a few games and
// arm the poller from 20 min before each tip-off until 60 min after — so it only polls live scores
// while a game is on. `LiveScorePoller` owns an inline schedule (see `hub.ts`); the node seeds these
// windows into it at startup (below), and they show up (editable) in the dashboard's schedule.
const MIN = 60_000;
const HR = 60 * MIN;
// @effect-diagnostics-next-line globalDate:off
const baseNow = Date.now();
const wnbaGames: ReadonlyArray<{ readonly id: string; readonly tipOff: number }> = [
  { id: "LV@NY", tipOff: baseNow - 10 * MIN }, // tipped off 10 min ago → live now
  { id: "SEA@CHI", tipOff: baseNow + 2 * HR }, // later today
  { id: "PHX@LA", tipOff: baseNow + 26 * HR }, // tomorrow
];
const pollerWindows = wnbaGames.map((g) => ({
  id: g.id,
  startAt: DateTime.makeUnsafe(g.tipOff - 20 * MIN),
  stopAt: DateTime.makeUnsafe(g.tipOff + 60 * MIN),
}));

// ── ScoresApi — synthetic API-usage windows (served on WnbaNode) ─────────────
// A real consumer instruments its outbound client (`Gate.instrumentEndpoints`) and serves
// `ApiMetrics.serve(tag)` (fed from the Metric registry). For the fixture there's no real
// client, so we hand the served tag a mock `{ metrics, usage }` with synthetic windows — a
// realistic-ish WNBA stats surface (HttpApi groups × endpoints), accumulated for `topEndpoints`.
interface EndpointSpec {
  readonly group: string;
  readonly endpoint: string;
  readonly weight: number;
  readonly avg: number;
}
const apiCatalog: ReadonlyArray<EndpointSpec> = [
  { group: "games", endpoint: "GET /games", weight: 8, avg: 45 },
  { group: "games", endpoint: "GET /games/:id", weight: 12, avg: 38 },
  { group: "games", endpoint: "GET /games/:id/boxscore", weight: 10, avg: 95 },
  { group: "games", endpoint: "GET /games/live", weight: 16, avg: 130 },
  { group: "games", endpoint: "GET /games/:id/play-by-play", weight: 11, avg: 150 },
  { group: "teams", endpoint: "GET /teams", weight: 3, avg: 28 },
  { group: "teams", endpoint: "GET /teams/:id", weight: 5, avg: 32 },
  { group: "teams", endpoint: "GET /teams/:id/roster", weight: 6, avg: 60 },
  { group: "players", endpoint: "GET /players/:id", weight: 7, avg: 36 },
  { group: "players", endpoint: "GET /players/:id/stats", weight: 6, avg: 72 },
  { group: "players", endpoint: "GET /players/:id/splits", weight: 4, avg: 110 },
  { group: "standings", endpoint: "GET /standings", weight: 3, avg: 24 },
  { group: "odds", endpoint: "GET /odds", weight: 5, avg: 64 },
  { group: "odds", endpoint: "GET /odds/:gameId", weight: 4, avg: 52 },
];

let apiTotal = 0;
let apiErrors = 0;
const apiCumulative = new Map<string, { requests: number; errors: number }>();

const fakeWindow: Effect.Effect<ApiUsageMetrics> = Effect.gen(function* () {
  const nowMs = yield* Clock.currentTimeMillis;
  const byEndpoint: Array<ApiUsageMetrics["byEndpoint"][number]> = [];
  let requests = 0;
  let errors = 0;
  for (const spec of apiCatalog) {
    const reqs = yield* Random.nextIntBetween(0, spec.weight + 1);
    if (reqs === 0) continue; // an endpoint not hit this window isn't reported
    const errs = (yield* Random.next) < 0.06 ? Math.min(reqs, yield* Random.nextIntBetween(1, 3)) : 0;
    const jitter = yield* Random.nextIntBetween(-10, 12);
    requests += reqs;
    errors += errs;
    const prev = apiCumulative.get(spec.endpoint) ?? { requests: 0, errors: 0 };
    apiCumulative.set(spec.endpoint, { requests: prev.requests + reqs, errors: prev.errors + errs });
    byEndpoint.push({
      group: spec.group,
      endpoint: spec.endpoint,
      requests: reqs,
      errors: errs,
      avgDurationMs: Math.max(5, spec.avg + jitter),
    });
  }
  apiTotal += requests;
  apiErrors += errors;
  const inFlight = yield* Random.nextIntBetween(0, 6);
  return {
    windowStart: DateTime.makeUnsafe(nowMs - 2_000),
    windowEnd: DateTime.makeUnsafe(nowMs),
    windowMillis: 2_000,
    requests,
    errors,
    inFlight,
    throughputPerSec: requests / 2,
    byEndpoint,
  };
});
const scoresApiMock = {
  metrics: Stream.tick(Duration.seconds(2)).pipe(Stream.mapEffect(() => fakeWindow)),
  usage: {
    get: Effect.map(
      Random.nextIntBetween(0, 6),
      (inFlight): ApiUsageSnapshot => ({
        clientId: "@wnba/ScoresApi",
        inFlight,
        requestsTotal: apiTotal,
        errorsTotal: apiErrors,
        topEndpoints: apiCatalog
          .map((spec) => {
            const c = apiCumulative.get(spec.endpoint) ?? { requests: 0, errors: 0 };
            return { group: spec.group, endpoint: spec.endpoint, requests: c.requests, errors: c.errors };
          })
          .sort((a, b) => b.requests - a.requests)
          .slice(0, 5),
      }),
    ),
    changes: Stream.tick(Duration.seconds(2)).pipe(
      Stream.mapEffect(() =>
        Effect.map(
          Random.nextIntBetween(0, 6),
          (inFlight): ApiUsageSnapshot => ({
            clientId: "@wnba/ScoresApi",
            inFlight,
            requestsTotal: apiTotal,
            errorsTotal: apiErrors,
            topEndpoints: apiCatalog
              .map((spec) => {
                const c = apiCumulative.get(spec.endpoint) ?? { requests: 0, errors: 0 };
                return { group: spec.group, endpoint: spec.endpoint, requests: c.requests, errors: c.errors };
              })
              .sort((a, b) => b.requests - a.requests)
              .slice(0, 5),
          }),
        ),
      ),
    ),
  },
};

// Simulated physical connection for the scores DB: a brief ~10s drop every 3 minutes (epoch-aligned)
// — occasional, not constant, so the box-score queue's dependency-aware readiness cascade is there to
// catch but the dashboard mostly reads healthy. A real DB resource would acquire this eagerly with
// `Layer.scoped` (failures at boot); here we just toggle a flag so the health board has something live.
// Visible on the dashboard: a ~9s drop every 40s, so the health board / readiness banner flip
// between healthy and degraded regularly enough to eyeball (and the box-score queue cascades with it).
const scoresDbImpl = {
  connected: Effect.map(Clock.currentTimeMillis, (now) => now % 40_000 > 9_000),
};

class WnbaStore extends Store.Service<WnbaStore>("@examples/resource-web/WnbaStore")(
  WnbaNode.logs,
  WorkPool.store(BoxScoreQueue),
) {}

class LiveStore extends Store.Service<LiveStore>("@examples/resource-web/LiveStore")(
  LiveNode.logs,
  Daemon.store(LiveScorePoller),
  Gate.store(FetchGate),
) {}

class StatsStore extends Store.Service<StatsStore>("@examples/resource-web/StatsStore")(
  StatsNode.logs,
  WorkPool.store(PlayByPlayQueue),
  WorkPool.store(ImportJobs),
) {}

// Dogfood durable registration journals: after the live-score poller has logged a few times, read
// node-wide + resource-scoped lines via Logs.byNode / byHyperlink.
const logStorageDemo = Layer.effectDiscard(
  Effect.forkScoped(
    Effect.gen(function* () {
      yield* Effect.sleep(Duration.seconds(8));
      const onNode = yield* Logs.byNode(LiveNode, { limit: 500 });
      const fromPoller = yield* Logs.byHyperlink("wnba/LiveScorePoller");
      yield* Console.log(
        `[logs] durable storage — live node holds ${onNode.length} lines; ` +
          `${fromPoller.length} are LiveScorePoller's (by resource)`,
      );
    }),
  ),
);

// Three nodes in one process, each its own port + `/rpc`: the box-score queue + scores DB + scores
// API on WnbaNode, the live-score poller on LiveNode, the play-by-play queue on StatsNode. Soft
// Storage: each node provides its own `*Store.layerMemory` **into** `httpServer` (one AppStore per
// Node runtime — see `docs/guides/stores.md`). `Layer.provide` (not sibling merge) so Soft unwrap
// captures AppStore; also keeps NodeHttpServers from fighting over one HttpServer.
const wnbaNode = Node.wsServer([
  queueEntry(BoxScoreQueue, {
    effect: importWorker,
    concurrency: 3,
  }),
  // ApiMetrics serves like any resource; the fixture hands it the mock impl via `Hyperlink.serve`
  // (spec-checked against the tag) — a real app would use `ApiMetrics.serve(ScoresApi)`, fed from
  // the instrumented client's registry.
  Hyperlink.serve(ScoresApi, scoresApiMock),
  // Serve the scores DB from its own provided service (below) — the same instance the box-score
  // queue's readiness depends on via `readinessOf(ScoresDb)`, so the cascade is consistent. The
  // Effect-form `serve` spec-checks the impl and surfaces its `ScoresDb` requirement (provided
  // below) instead of a bare `{ tag, impl }` literal that would erase it.
  Hyperlink.serve(ScoresDb, ScoresDb),
  // the multi-node WorkerPool, served here + on the other two nodes; `peersLayer` (below) lets this
  // instance reach the others so `fleetActive` gathers across the fleet.
  Hyperlink.serve(WorkerPool, workerPoolImpl(5)),
  FleetHealth.serve(MeshHealth),
  Telemetry.serve(FleetMetrics),
  // the sessions shard-map, served on all three nodes; `peersLayer` lets each instance reach the
  // others so `size` / `sizeByNode` fold across the fleet and routed `put` reaches the owning shard.
  ShardMap.serve(Sessions),
]).pipe(
  Layer.provide(Hyperlink.peersLayer(WorkerPool, WnbaNode)),
  Layer.provide(Hyperlink.peersLayer(MeshHealth, WnbaNode)),
  Layer.provide(Hyperlink.peersLayer(FleetMetrics, WnbaNode)),
  Layer.provide(Hyperlink.peersLayer(Sessions, WnbaNode)),
  // peers dial websocket too — one knob, matching the server's own wire (default would be http → 404
  // against a ws-only /rpc). The peer urls stay on the Nodes; this only chooses how to reach them.
  Layer.provide(Hyperlink.layerPeerProtocol(Hyperlink.protocolWebsocket)),
  // provide ScoresDb so the queue's readiness derivation (`readinessOf(ScoresDb)`) can resolve it;
  // the served entry above re-exposes this same service over RPC.
  Layer.provide(Hyperlink.layer(ScoresDb, scoresDbImpl)),
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(WnbaStore.layerMemory),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: WNBA_PORT })),
);

const liveNode = Node.wsServer([
  processEntry(LiveScorePoller, {
    effect: Effect.logInfo("wnba: polling live scores"),
    polling: Polling.spaced(Duration.seconds(2)),
  }),
  Hyperlink.serve(WorkerPool, workerPoolImpl(3)),
  FleetHealth.serve(MeshHealth),
  Telemetry.serve(FleetMetrics),
  ShardMap.serve(Sessions),
  // a bounded-concurrency run gate (4 permits) over a simulated box-score fetch — a slow effect that
  // usually succeeds with a byte count, ~1-in-8 fails with a timeout, so the GateCard shows
  // live in-flight / done / failed counters.
  Gate.serve(FetchGate, {
    concurrency: 4,
    effect: (url: string) =>
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(yield* Random.nextIntBetween(300, 900)));
        if ((yield* Random.nextIntBetween(0, 8)) === 0) {
          return yield* Effect.fail(`fetch timed out: ${url}`);
        }
        return yield* Random.nextIntBetween(1_000, 40_000);
      }),
  }),
]).pipe(
  Layer.provide(Hyperlink.peersLayer(WorkerPool, LiveNode)),
  Layer.provide(Hyperlink.peersLayer(MeshHealth, LiveNode)),
  Layer.provide(Hyperlink.peersLayer(FleetMetrics, LiveNode)),
  Layer.provide(Hyperlink.peersLayer(Sessions, LiveNode)),
  Layer.provide(Hyperlink.layerPeerProtocol(Hyperlink.protocolWebsocket)),
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(LiveStore.layerMemory),
  Layer.provideMerge(logStorageDemo),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: LIVE_PORT })),
);

const statsNode = Node.wsServer([
  queueEntry(PlayByPlayQueue, {
    effect: importWorker,
    concurrency: 3,
  }),
  // a custom queue with named lanes (hot/warm/cold); its store facet lives in StatsStore (above), so
  // `serve` (not serveMemory) — one Store.Storage per node, shared like the queue's.
  WorkPool.serve(ImportJobs, {
    levelCount: 3,
    namedLevels: { hot: 0, warm: 1, cold: 2 },
    concurrency: 1, // drain slower than we fill, so the named lanes carry a visible backlog
    effect: importWorker,
    autoStart: true,
  }),
  Hyperlink.serve(WorkerPool, workerPoolImpl(4)),
  FleetHealth.serve(MeshHealth),
  Telemetry.serve(FleetMetrics),
  ShardMap.serve(Sessions),
]).pipe(
  Layer.provide(Hyperlink.peersLayer(WorkerPool, StatsNode)),
  Layer.provide(Hyperlink.peersLayer(MeshHealth, StatsNode)),
  Layer.provide(Hyperlink.peersLayer(FleetMetrics, StatsNode)),
  Layer.provide(Hyperlink.peersLayer(Sessions, StatsNode)),
  Layer.provide(Hyperlink.layerPeerProtocol(Hyperlink.protocolWebsocket)),
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(StatsStore.layerMemory),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: STATS_PORT })),
);

// Each node is its own forked scope (NOT merged) so each gets its own HttpRouter — merging them
// would register `/rpc` twice on one shared router. One process, three independent servers.
// Seed the poller's inline schedule with this run's live game windows, then keep the node alive. The
// dashboard reads/edits these same windows over RPC through the `schedule` verb group.
const liveNodeProgram = Effect.gen(function* () {
  const poller = yield* LiveScorePoller;
  yield* poller.schedule.set(pollerWindows);
  // Drive the run gate: fork runs faster than four permits can drain, so a `waiting` backlog builds
  // and the GateCard's in-flight gauge sits near its limit. Each run's failure is swallowed
  // here (the gate already tallies it) so the producer fiber keeps going.
  const gate = yield* FetchGate;
  let g = 0;
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.forkScoped(Effect.ignore(gate.run(`box/${g++}`)));
        yield* Effect.sleep(Duration.millis(yield* Random.nextIntBetween(90, 200)));
      }
    }),
  );
  return yield* Effect.never;
}).pipe(Effect.provide(liveNode));

// Serve the box-score queue AND keep it fed, so its widgets show live load.
const wnbaNodeProgram = Effect.gen(function* () {
  yield* loadQueue(yield* BoxScoreQueue, "box");
  // feed the sessions shard-map — routed `put` (key via `keyOf`) lands each session on its owning
  // node, so the ShardMapCard's per-node bars spread; occasionally end a session so it churns.
  const sessions = yield* Sessions;
  const live: Array<string> = [];
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      let n = 0;
      while (true) {
        if (live.length > 24 && (yield* Random.nextIntBetween(0, 3)) === 0) {
          const id = live.shift();
          if (id !== undefined) yield* sessions.delete(id);
        } else {
          const id = `sess-${n++}`;
          yield* sessions.put({ id, user: `fan-${id}` });
          live.push(id);
        }
        yield* Effect.sleep(Duration.millis(yield* Random.nextIntBetween(80, 260)));
      }
    }),
  );
  return yield* Effect.never;
}).pipe(Effect.provide(wnbaNode));

const statsNodeProgram = Effect.gen(function* () {
  yield* loadQueue(yield* PlayByPlayQueue, "pbp");
  // feed the custom queue across its named lanes so the CustomQueueCard shows live per-lane bars.
  const imports = yield* ImportJobs;
  const lanes = ["hot", "warm", "cold"] as const;
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      let n = 0;
      while (true) {
        const lane = lanes[yield* Random.nextIntBetween(0, lanes.length)] ?? "warm";
        yield* imports.add({ id: `imp-${n++}` }, lane);
        yield* Effect.sleep(Duration.millis(yield* Random.nextIntBetween(60, 220)));
      }
    }),
  );
  return yield* Effect.never;
}).pipe(Effect.provide(statsNode));

const program = Effect.gen(function* () {
  yield* Effect.forkScoped(wnbaNodeProgram);
  yield* Effect.forkScoped(liveNodeProgram);
  yield* Effect.forkScoped(statsNodeProgram);
  yield* Effect.logInfo(
    `wnba :${WNBA_PORT} (BoxScoreQueue) · live :${LIVE_PORT} (LiveScorePoller) · stats :${STATS_PORT} (PlayByPlayQueue)`,
  );
  // WorkerPool (nodeless, `distributed` set) is served on all three nodes with `peersLayer`, so a client
  // hitting any node gets `fleetActive` = that node's `active` + its peers' (5 + 3 + 4 = 12); the peer
  // connections are established when each `peersLayer` builds above. (The fold is proven end-to-end in
  // `test/multi-node-peers-http.test.ts`.)
  yield* Effect.logInfo("WorkerPool: multi-node, served on wnba/live/stats (fleetActive folds active)");
  return yield* Effect.never;
});

NodeRuntime.runMain(program.pipe(Effect.scoped));
