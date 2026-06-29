/**
 * @module examples/resource-web/hub
 *
 * The review fixture for the shipped `@nikscripts/effect-pm/web` widgets — one of each **unique**
 * thing the dashboard renders: a nested group, a queue, a scheduled process (the WNBA live-score
 * poller), and an API-usage tap. The queue + poller are **hosted remotely** on `WnbaHost` (served
 * by `server.ts`); the browser reaches them via `Resource.connectHttp` (vite proxies `/rpc`), which
 * is what lights up the top-right **host dot**. `ScoresApi` stays a local in-browser mock (swap it
 * for connect+client to serve it remotely too).
 */
import { Clock, DateTime, Duration, Effect, Layer, Random, Schema, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as Resource from "../../src/Resource";
import * as QueueResource from "../../src/QueueContract";
import * as ProcessResource from "../../src/ScheduledProcess";
import * as Group from "../../src/Group";
import { ApiMetrics } from "../../src/ApiMetrics";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../../src/ApiUsageSchema";

const importJob = Schema.Struct({ id: Schema.String });

// Two remote machines (see `server.ts`): the box-score queue lives on `WnbaHost`, the live-score
// poller on `LiveHost` — so the dashboard's host die shows two pips (one per host).
export class WnbaHost extends Resource.Host<WnbaHost>("wnba/scores") {}
export class LiveHost extends Resource.Host<LiveHost>("wnba/live") {}

export class BoxScoreQueue extends QueueResource.Tag<BoxScoreQueue>()(
  "wnba/BoxScoreQueue",
  importJob,
  { host: WnbaHost },
) {}
export class LiveScorePoller extends ProcessResource.Tag<LiveScorePoller>()(
  "wnba/LiveScorePoller",
  { host: LiveHost },
) {}
export class ScoresApi extends ApiMetrics.Tag<ScoresApi>()("@wnba/ScoresApi") {}

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

// ── ScoresApi — mock the API-usage tap with synthetic windows (local, in-browser) ────────────
// Normally `ApiMetrics.layerFor(tag, HttpApiResource.Service)` feeds this from real outbound
// requests; for the fixture we provide the tag directly with fake windows so the API widget
// (sparkline + endpoint table) has something live to show.
// A realistic-ish WNBA stats API surface — several HttpApi groups, each with a few endpoints
// (`group` is the HttpApiGroup; `endpoint` the method + path). `weight` ~ how busy it tends to be,
// `avg` its baseline latency. Cumulative per-endpoint totals build the snapshot's `topEndpoints`.
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

// ── Browser runtime ──────────────────────────────────────────────────────────
// The box-score queue + live-score poller are served remotely on `WnbaHost` (server.ts); the
// browser is a thin `Resource.client` over `/rpc` (vite proxies it to the host). `ScoresApi` is a
// local mock. One shared transport → one host dot, auto-fed by the host's `HostStatus`.
const wnbaTransport = Resource.connectHttp(WnbaHost, { url: "/rpc" });
const liveTransport = Resource.connectHttp(LiveHost, { url: "/live/rpc" });

// Expose each host itself in the runtime (not only the resource clients): the host-status die reads
// `HostStatus` over each host's transport, so it needs the host in context. Each transport is one
// const (shared by reference), so the client + the die reuse a single connection per host.
const appLayer = Layer.mergeAll(
  wnbaTransport,
  liveTransport,
  Resource.client(BoxScoreQueue).pipe(Layer.provide(wnbaTransport)),
  Resource.client(LiveScorePoller).pipe(Layer.provide(liveTransport)),
  Resource.layer(ScoresApi, scoresApiMock),
);

/** One reactive runtime providing every resource in the hub. */
export const runtime = Atom.runtime(appLayer);
