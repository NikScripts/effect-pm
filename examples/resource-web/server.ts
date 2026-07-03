/**
 * @module examples/resource-web/server
 *
 * The **WNBA node** — a node process serving the hub's box-score queue and live-score poller over
 * http on one port, plus the `NodeStatus` that `serveAllHttp` auto-mounts. The browser dashboard
 * reaches it via `Resource.connectHttp(WnbaNode, …)` (vite proxies `/rpc` here), so the top-right
 * node status dot goes live. Run: `pnpm run example:resource-web-server` (alongside
 * `pnpm run example:resource-web`).
 */
import { Clock, Console, DateTime, Duration, Effect, Layer, Random, Stream } from "effect";
// A node node entry point — the raw http server is exactly what `NodeHttpServer.layer` wants.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Resource from "../../src/Resource";
import { serverEntry as queueEntry } from "../../src/QueueContract";
import { serverEntry as processEntry } from "../../src/ScheduledProcess";
import { HistoryStore } from "../../src/HistoryStore";
import { NodeLogs } from "../../src/NodeLogs";
import { Polling } from "../../src/Polling";
import { ProcessSchedule } from "../../src/ProcessSchedule";
import { ProcessStorage } from "../../src/ProcessStorage";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../../src/ApiUsageSchema";
import { BoxScoreQueue, HOST_PORTS, LiveNode, LiveScorePoller, PlayByPlayQueue, ScoresApi, ScoresDb, StatsNode, WnbaNode, WorkerPool } from "./hub";
import { Combine, combineQuery } from "../../src/MultiNode";

const WNBA_PORT = HOST_PORTS.wnba;
const LIVE_PORT = HOST_PORTS.live;
const STATS_PORT = HOST_PORTS.stats;

// The WorkerPool impl, Effect form (spec-checked by `serverEntry`): resolve `peers` once, then
// `fleetActive` folds the peers' `active` + this node's own. `own` varies per node so the fleet total
// is meaningful; the impl's `peers` requirement is discharged by `peersLayer` at each serve.
const workerPoolImpl = (own: number) =>
  Effect.gen(function* () {
    const peers = yield* Resource.peers(WorkerPool);
    const self = yield* Resource.selfNode(WorkerPool); // which node am I — no hand-threaded key
    return {
      active: Effect.succeed(own),
      fleetActive: combineQuery(peers, (p) => p.active, Combine.sum).pipe(
        Effect.map((others) => own + others),
      ),
      // a per-node map: peers folded by node + this instance's own row, keyed by `self`
      activeByNode: Effect.gen(function* () {
        const byNode = yield* combineQuery(peers, (p) => p.active, Combine.byNode);
        return { ...byNode, [self]: own };
      }),
    };
  });

const importWorker = (job: { readonly id: string }) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`importing ${job.id}`);
    yield* Effect.sleep(Duration.millis(400));
  });

// ── WNBA live-score poller: armed only around game time ──────────────────────
// In a real app you'd fetch the league schedule from a sports API; here we mock a few games and
// arm the poller from 20 min before each tip-off until 60 min after — so it only polls live scores
// while a game is on. The window entries show up (and are editable) in the dashboard's schedule.
const MIN = 60_000;
const HR = 60 * MIN;
// @effect-diagnostics-next-line globalDate:off
const baseNow = Date.now();
const toDate = (ms: number): Date => DateTime.toDateUtc(DateTime.makeUnsafe(ms));
const wnbaGames: ReadonlyArray<{ readonly id: string; readonly tipOff: number }> = [
  { id: "LV@NY", tipOff: baseNow - 10 * MIN }, // tipped off 10 min ago → live now
  { id: "SEA@CHI", tipOff: baseNow + 2 * HR }, // later today
  { id: "PHX@LA", tipOff: baseNow + 26 * HR }, // tomorrow
];
const pollerSchedule = ProcessSchedule.define(({ window, all }) =>
  all(...wnbaGames.map((g) => window(g.id, toDate(g.tipOff - 20 * MIN), toDate(g.tipOff + 60 * MIN)))),
);

// ── ScoresApi — synthetic API-usage windows (served on WnbaNode) ─────────────
// A real consumer instruments its outbound client (`HttpApiResource.instrumentEndpoints`) and serves
// `ApiMetrics.serverEntry(tag)` (fed from the Metric registry). For the fixture there's no real
// client, so we hand the served tag a mock `{ metrics, usageNow }` with synthetic windows — a
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
  usageNow: Effect.map(
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
};

// Simulated physical connection for the scores DB: a brief ~10s drop every 3 minutes (epoch-aligned)
// — occasional, not constant, so the box-score queue's dependency-aware readiness cascade is there to
// catch but the dashboard mostly reads healthy. A real DB resource would acquire this eagerly with
// `Layer.scoped` (failures at boot); here we just toggle a flag so the health board has something live.
const scoresDbImpl = {
  connected: Effect.map(Clock.currentTimeMillis, (now) => now % 180_000 > 10_000),
};

// Dogfood the durable log storage: after the live-score poller has logged a few times, read its logs
// back out of LogStore two ways — every line on the live node, and just the poller's lines (by
// resource). Proves the persist → query round-trip. (Provided into liveNode, which has the LogStore.)
const logStorageDemo = Layer.effectDiscard(
  Effect.forkScoped(
    Effect.gen(function* () {
      yield* Effect.sleep(Duration.seconds(8));
      const onNode = yield* NodeLogs.byNode("live", { limit: 500 });
      const fromPoller = yield* NodeLogs.byResource({
        processId: "wnba/LiveScorePoller",
      });
      // Console.log (direct stdout) so the demo is visible regardless of the serve's logger routing
      yield* Console.log(
        `[logs] durable storage — live node holds ${onNode.length} lines; ` +
          `${fromPoller.length} are LiveScorePoller's (by resource)`,
      );
    }),
  ),
);

// Three nodes in one process, each its own port + `/rpc`: the box-score queue + scores DB + scores
// API on WnbaNode, the live-score poller on LiveNode, the play-by-play queue on StatsNode. Each
// `serveAllHttp` consumes its own NodeHttpServer (Layer.provide, not provideMerge — so they don't
// fight over one HttpServer).
const wnbaNode = Resource.serveAllHttp([
  queueEntry(BoxScoreQueue, {
    effect: importWorker,
    concurrency: 3,
    captureLogs: true,
  }),
  // ApiMetrics serves like any resource; the fixture hands it the mock impl via `Resource.serverEntry`
  // (spec-checked against the tag) — a real app would use `ApiMetrics.serverEntry(ScoresApi)`, fed from
  // the instrumented client's registry.
  Resource.serverEntry(ScoresApi, scoresApiMock),
  // Serve the scores DB from its own provided service (below) — the same instance the box-score
  // queue's readiness depends on via `readinessOf(ScoresDb)`, so the cascade is consistent. The
  // Effect-form `serverEntry` spec-checks the impl and surfaces its `ScoresDb` requirement (provided
  // below) instead of a bare `{ tag, impl }` literal that would erase it.
  Resource.serverEntry(ScoresDb, ScoresDb),
  // the multi-node WorkerPool, served here + on the other two nodes; `peersLayer` (below) lets this
  // instance reach the others so `fleetActive` gathers across the fleet.
  Resource.serverEntry(WorkerPool, workerPoolImpl(5)),
]).pipe(
  Layer.provide(Resource.peersLayer(WorkerPool, WnbaNode)),
  // provide ScoresDb so the queue's readiness derivation (`readinessOf(ScoresDb)`) can resolve it;
  // the served entry above re-exposes this same service over RPC.
  Layer.provide(Resource.layer(ScoresDb, scoresDbImpl)),
  Layer.provide(HistoryStore.layerMemory()),
  // live relay (dashboard log stream) + durable storage: persistLayer("wnba") batches every captured
  // line into LogStore bucketed by node; ProcessStorage backs LogStore (memory here — swap for sqlite/
  // redis for cross-restart history). Queryable via NodeLogs.byNode("wnba") / byResource({ queueId }).
  Layer.provide(NodeLogs.layer),
  Layer.provide(NodeLogs.persistLayer("wnba")),
  Layer.provide(ProcessStorage.layer),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: WNBA_PORT })),
);

const liveNode = Resource.serveAllHttp([
  processEntry(LiveScorePoller, {
    effect: Effect.logInfo("wnba: polling live scores"),
    polling: Polling.spaced(Duration.seconds(2)),
    scheduleLayer: pollerSchedule,
    captureLogs: true,
  }),
  Resource.serverEntry(WorkerPool, workerPoolImpl(3)),
]).pipe(
  Layer.provide(Resource.peersLayer(WorkerPool, LiveNode)),
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(NodeLogs.layer),
  // provideMerge (not provide): these install a logger / fork a fiber and provide no service, so a
  // bare provide would be pruned as unused — merging forces the build.
  Layer.provideMerge(NodeLogs.persistLayer("live")),
  Layer.provideMerge(logStorageDemo),
  Layer.provide(ProcessStorage.layer),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: LIVE_PORT })),
);

const statsNode = Resource.serveAllHttp([
  queueEntry(PlayByPlayQueue, {
    effect: importWorker,
    concurrency: 3,
    captureLogs: true,
  }),
  Resource.serverEntry(WorkerPool, workerPoolImpl(4)),
]).pipe(
  Layer.provide(Resource.peersLayer(WorkerPool, StatsNode)),
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(NodeLogs.layer),
  Layer.provide(NodeLogs.persistLayer("stats")),
  Layer.provide(ProcessStorage.layer),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: STATS_PORT })),
);

// Each node is its own forked scope (NOT merged) so each gets its own HttpRouter — merging them
// would register `/rpc` twice on one shared router. One process, three independent servers.
const program = Effect.gen(function* () {
  yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(wnbaNode)));
  yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(liveNode)));
  yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(statsNode)));
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
