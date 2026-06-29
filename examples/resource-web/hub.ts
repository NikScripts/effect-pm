/**
 * @module examples/resource-web/hub
 *
 * The review fixture for the shipped `@nikscripts/effect-pm/web` widgets — one of each **unique**
 * thing the dashboard renders, no duplicates: a nested group, a queue, and a scheduled process
 * (the WNBA live-score poller, armed only around game time). Local layers so it renders standalone;
 * swapping each for `Resource.client` + connect is how it points at a remote host.
 */
import { Clock, DateTime, Duration, Effect, Layer, Random, Schema, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as Resource from "../../src/Resource";
import * as QueueResource from "../../src/QueueContract";
import * as ProcessResource from "../../src/ScheduledProcess";
import * as Group from "../../src/Group";
import { ApiMetrics } from "../../src/ApiMetrics";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../../src/ApiUsageSchema";
import { Polling } from "../../src/Polling";
import { ProcessSchedule } from "../../src/ProcessSchedule";
import { ProcessStorage } from "../../src/ProcessStorage";

const importJob = Schema.Struct({ id: Schema.String });

// A queue (box-score imports), a scheduled process (the live-score poller), and an API-usage tap
// over the scores client — under one league.
class BoxScoreQueue extends QueueResource.Tag<BoxScoreQueue>()("wnba/BoxScoreQueue", importJob) {}
class LiveScorePoller extends ProcessResource.Tag<LiveScorePoller>()("wnba/LiveScorePoller") {}
class ScoresApi extends ApiMetrics.Tag<ScoresApi>("@wnba/ScoresApi")() {}

/** WNBA league group — a nested group the dashboard drills into. */
export class Wnba extends Group.Tag<Wnba>("hub/Wnba")({
  LiveScorePoller,
  BoxScoreQueue,
  ScoresApi,
}) {}

/** The hub the dashboard renders. */
export class ServicesHub extends Group.Tag<ServicesHub>("hub/ServicesHub")({
  Wnba,
}) {}

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

// ── ScoresApi — mock the API-usage tap with synthetic windows ────────────────
// Normally `ApiMetrics.layerFor(tag, HttpApiResource.Service)` feeds this from real outbound
// requests; for a standalone in-browser fixture we provide the tag directly with fake windows so
// the API widget (sparkline + endpoint table) has something live to show.
let apiTotal = 0;
let apiErrors = 0;
const endpoint = (name: string, requests: number, errors: number, avgDurationMs: number) => ({
  group: "scores",
  endpoint: name,
  requests,
  errors,
  avgDurationMs,
});
const fakeWindow: Effect.Effect<ApiUsageMetrics> = Effect.gen(function* () {
  const nowMs = yield* Clock.currentTimeMillis;
  const games = yield* Random.nextIntBetween(5, 25);
  const teams = yield* Random.nextIntBetween(0, 8);
  const sync = yield* Random.nextIntBetween(0, 3);
  const requests = games + teams + sync;
  const errors = (yield* Random.next) < 0.25 ? 1 : 0;
  const avg = yield* Random.nextIntBetween(40, 100);
  const inFlight = yield* Random.nextIntBetween(0, 4);
  apiTotal += requests;
  apiErrors += errors;
  return {
    windowStart: DateTime.makeUnsafe(nowMs - 2_000),
    windowEnd: DateTime.makeUnsafe(nowMs),
    windowMillis: 2_000,
    requests,
    errors,
    inFlight,
    throughputPerSec: requests / 2,
    byEndpoint: [
      endpoint("GET /games", games, errors, avg),
      endpoint("GET /teams", teams, 0, 30),
      endpoint("POST /sync", sync, 0, 120),
    ],
  };
});
const scoresApiMock = {
  metrics: Stream.tick(Duration.seconds(2)).pipe(Stream.mapEffect(() => fakeWindow)),
  usageNow: Effect.map(
    Random.nextIntBetween(0, 4),
    (inFlight): ApiUsageSnapshot => ({
      clientId: "@wnba/ScoresApi",
      inFlight,
      requestsTotal: apiTotal,
      errorsTotal: apiErrors,
      topEndpoints: [
        { group: "scores", endpoint: "GET /games", requests: Math.floor(apiTotal * 0.7), errors: apiErrors },
        { group: "scores", endpoint: "GET /teams", requests: Math.floor(apiTotal * 0.25), errors: 0 },
        { group: "scores", endpoint: "POST /sync", requests: Math.floor(apiTotal * 0.05), errors: 0 },
      ],
    }),
  ),
};

const appLayer = Layer.mergeAll(
  Resource.layer(ScoresApi, scoresApiMock),
  QueueResource.layer(BoxScoreQueue, { effect: importWorker, concurrency: 3 }),
  ProcessResource.layer(LiveScorePoller, {
    effect: Effect.logInfo("wnba: polling live scores"),
    polling: Polling.spaced(Duration.seconds(2)),
    scheduleLayer: pollerSchedule,
  }),
).pipe(Layer.provide(ProcessStorage.layer));

/** One reactive runtime providing every resource in the hub. */
export const runtime = Atom.runtime(appLayer);
