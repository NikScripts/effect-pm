/**
 * @module examples/resource-web/server
 *
 * The **WNBA host** — a node process serving the hub's box-score queue and live-score poller over
 * http on one port, plus the `HostStatus` that `serveAllHttp` auto-mounts. The browser dashboard
 * reaches it via `Resource.connectHttp(WnbaHost, …)` (vite proxies `/rpc` here), so the top-right
 * host status dot goes live. Run: `pnpm run example:resource-web-server` (alongside
 * `pnpm run example:resource-web`).
 */
import { Clock, DateTime, Duration, Effect, Layer, Random, Stream } from "effect";
// A node host entry point — the raw http server is exactly what `NodeHttpServer.layer` wants.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Resource from "../../src/Resource";
import { serverEntry as queueEntry } from "../../src/QueueContract";
import { serverEntry as processEntry } from "../../src/ScheduledProcess";
import { HistoryStore } from "../../src/HistoryStore";
import { HostLogs } from "../../src/HostLogs";
import { Polling } from "../../src/Polling";
import { ProcessSchedule } from "../../src/ProcessSchedule";
import { ProcessStorage } from "../../src/ProcessStorage";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../../src/ApiUsageSchema";
import { BoxScoreQueue, LiveScorePoller, PlayByPlayQueue, ScoresApi, ScoresDb } from "./hub";

const WNBA_PORT = 7780;
const LIVE_PORT = 7781;
const STATS_PORT = 7782;

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

// ── ScoresApi — synthetic API-usage windows (served on WnbaHost) ─────────────
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

// Three hosts in one process, each its own port + `/rpc`: the box-score queue + scores DB + scores
// API on WnbaHost, the live-score poller on LiveHost, the play-by-play queue on StatsHost. Each
// `serveAllHttp` consumes its own NodeHttpServer (Layer.provide, not provideMerge — so they don't
// fight over one HttpServer).
const wnbaHost = Resource.serveAllHttp([
  queueEntry(BoxScoreQueue, {
    effect: importWorker,
    concurrency: 3,
    captureLogs: true,
  }),
  // ApiMetrics serves like any resource; the fixture hands it the mock impl directly (a real app
  // would use `ApiMetrics.serverEntry(ScoresApi)`, fed from the instrumented client's registry).
  { tag: ScoresApi, impl: scoresApiMock },
  // Serve the scores DB from its own provided service (below) — the same instance the box-score
  // queue's readiness depends on via `readinessOf(ScoresDb)`, so the cascade is consistent.
  { tag: ScoresDb, impl: ScoresDb },
]).pipe(
  // provide ScoresDb so the queue's readiness derivation (`readinessOf(ScoresDb)`) can resolve it;
  // the served entry above re-exposes this same service over RPC.
  Layer.provide(Resource.layer(ScoresDb, scoresDbImpl)),
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(HostLogs.layer),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: WNBA_PORT })),
);

const liveHost = Resource.serveAllHttp([
  processEntry(LiveScorePoller, {
    effect: Effect.logInfo("wnba: polling live scores"),
    polling: Polling.spaced(Duration.seconds(2)),
    scheduleLayer: pollerSchedule,
    captureLogs: true,
  }),
]).pipe(
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(ProcessStorage.layer),
  Layer.provide(HostLogs.layer),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: LIVE_PORT })),
);

const statsHost = Resource.serveAllHttp([
  queueEntry(PlayByPlayQueue, {
    effect: importWorker,
    concurrency: 3,
    captureLogs: true,
  }),
]).pipe(
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(HostLogs.layer),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: STATS_PORT })),
);

// Each host is its own forked scope (NOT merged) so each gets its own HttpRouter — merging them
// would register `/rpc` twice on one shared router. One process, three independent servers.
const program = Effect.gen(function* () {
  yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(wnbaHost)));
  yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(liveHost)));
  yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(statsHost)));
  yield* Effect.logInfo(
    `wnba :${WNBA_PORT} (BoxScoreQueue) · live :${LIVE_PORT} (LiveScorePoller) · stats :${STATS_PORT} (PlayByPlayQueue)`,
  );
  return yield* Effect.never;
});

NodeRuntime.runMain(program.pipe(Effect.scoped));
