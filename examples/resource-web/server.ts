/**
 * @module examples/resource-web/server
 *
 * The **WNBA host** — a node process serving the hub's box-score queue and live-score poller over
 * http on one port, plus the `HostStatus` that `serveAllHttp` auto-mounts. The browser dashboard
 * reaches it via `Resource.connectHttp(WnbaHost, …)` (vite proxies `/rpc` here), so the top-right
 * host status dot goes live. Run: `pnpm run example:resource-web-server` (alongside
 * `pnpm run example:resource-web`).
 */
import { DateTime, Duration, Effect, Layer, Logger } from "effect";
// A node host entry point — the raw http server is exactly what `NodeHttpServer.layer` wants.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Resource from "../../src/Resource";
import { serverEntry as queueEntry } from "../../src/QueueContract";
import { serverEntry as processEntry } from "../../src/ScheduledProcess";
import { HistoryStore } from "../../src/HistoryStore";
import { Polling } from "../../src/Polling";
import { ProcessSchedule } from "../../src/ProcessSchedule";
import { ProcessStorage } from "../../src/ProcessStorage";
import { BoxScoreQueue, LiveScorePoller } from "./hub";

const WNBA_PORT = 7780;
const LIVE_PORT = 7781;

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

// Two hosts in one process, each its own port + `/rpc`: the box-score queue on WnbaHost, the
// live-score poller on LiveHost. Each `serveAllHttp` consumes its own NodeHttpServer (Layer.provide,
// not provideMerge — so the two don't fight over one HttpServer service when merged).
const wnbaHost = Resource.serveAllHttp([
  queueEntry(BoxScoreQueue, {
    effect: importWorker,
    concurrency: 3,
    captureLogs: true,
  }),
]).pipe(
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(Logger.layer([], { mergeWithExisting: false })),
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
  Layer.provide(Logger.layer([], { mergeWithExisting: false })),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: LIVE_PORT })),
);

// Each host is its own forked scope (NOT merged) so each gets its own HttpRouter — merging them
// would register `/rpc` twice on one shared router. One process, two independent servers.
const program = Effect.gen(function* () {
  yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(wnbaHost)));
  yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(liveHost)));
  yield* Effect.logInfo(`wnba host (BoxScoreQueue) :${WNBA_PORT} · live host (LiveScorePoller) :${LIVE_PORT}`);
  return yield* Effect.never;
});

NodeRuntime.runMain(program.pipe(Effect.scoped));
