/**
 * @module examples/resource-web/hub
 *
 * The review fixture for the shipped `@nikscripts/effect-pm/web` widgets — one of each **unique**
 * thing the dashboard renders: a nested group, a queue, a scheduled process (the WNBA live-score
 * poller), and an API-usage tap (`ScoresApi`). Every resource is **hosted remotely** across three
 * hosts (served by `server.ts`); the browser reaches each via `Resource.connectHttp` (vite proxies
 * `/rpc` / `/live` / `/stats`), which is what lights up the top-right **host die**. `ScoresApi` is an
 * `ApiMetrics` resource served on `WnbaHost` via `ApiMetrics.serverEntry`. `ScoresDb` is a dependency
 * resource the box-score queue's readiness depends on (`readinessOf`) — when its (simulated)
 * connection blips, the queue cascades to degraded, dogfooding dependency-aware readiness.
 */
import { Effect, Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as Resource from "../../src/Resource";
import * as QueueResource from "../../src/QueueContract";
import * as ProcessResource from "../../src/ScheduledProcess";
import * as Group from "../../src/Group";
import { ApiMetrics } from "../../src/ApiMetrics";

const importJob = Schema.Struct({ id: Schema.String });

// Three remote machines (see `server.ts`): the box-score queue on `WnbaHost`, the live-score poller
// on `LiveHost`, the play-by-play queue on `StatsHost` — so the dashboard's host die shows three
// pips (a pyramid).
/** The three hosts' ports (one process, three servers — see `server.ts`). Exported so the host urls
 *  here and the servers stay in sync. Each host carries its server-side url so `Resource.peersLayer`
 *  can reach its peers; the browser overrides it with a vite-proxied path (below). */
export const HOST_PORTS = { wnba: 7780, live: 7781, stats: 7782 } as const;
const rpcUrl = (port: number) => `http://127.0.0.1:${port}/rpc`;

export class WnbaHost extends Resource.Host<WnbaHost>("wnba/scores", { url: rpcUrl(HOST_PORTS.wnba) }) {}
export class LiveHost extends Resource.Host<LiveHost>("wnba/live", { url: rpcUrl(HOST_PORTS.live) }) {}
export class StatsHost extends Resource.Host<StatsHost>("wnba/stats", { url: rpcUrl(HOST_PORTS.stats) }) {}

// A **multi-host** resource: the SAME WorkerPool served on all three hosts — one class, three
// instances. `active` is this instance's own count (a leaf field peers can read); `fleetActive` is the
// total across the fleet — a `fleet`-tagged query the layer folds from `Resource.peers` + its own
// value (see `server.ts`). Dogfoods `fleet` + `peers` + layer-from-effect end to end across three real
// servers.
export class WorkerPool extends Resource.Tag<WorkerPool>()(
  "wnba/WorkerPool",
  {
    active: Resource.query(Schema.Number),
    fleetActive: Resource.query(Schema.Number).pipe(Resource.fleet),
  },
  // the fleet, as a factory option — hostless, every instance equal (no primary host).
  { multiHost: [WnbaHost, LiveHost, StatsHost] },
) {}

// A "scores database" connection, served on WnbaHost. Its readiness reflects a (simulated) physical
// connection that drops briefly now and then; the box-score queue *depends on* it (below), so when the
// DB blips the queue cascades to degraded. This dogfoods `readinessOf` + the readiness cascade.
export class ScoresDb extends Resource.Tag<ScoresDb>()(
  "wnba/ScoresDb",
  { connected: Resource.query(Schema.Boolean) },
  { host: WnbaHost },
).pipe(
  Resource.withReadiness((svc) =>
    Effect.map(svc.connected, (c) =>
      c ? { ready: true } : { ready: false, detail: "connecting to scores DB…" },
    ),
  ),
) {}

export class BoxScoreQueue extends QueueResource.Tag<BoxScoreQueue>()(
  "wnba/BoxScoreQueue",
  importJob,
  { host: WnbaHost },
).pipe(
  // depend on the scores DB: ready only when the queue is running AND the DB is connected. `base` is
  // the queue's own `phase === "running"` check — kept, not replaced — AND-ed with the DB's readiness.
  Resource.withReadiness((_svc, base) =>
    Resource.allReady([base, Resource.readinessOf(ScoresDb)]),
  ),
) {}
export class LiveScorePoller extends ProcessResource.Tag<LiveScorePoller>()(
  "wnba/LiveScorePoller",
  { host: LiveHost },
) {}
export class PlayByPlayQueue extends QueueResource.Tag<PlayByPlayQueue>()(
  "wnba/PlayByPlayQueue",
  importJob,
  { host: StatsHost },
) {}
export class ScoresApi extends ApiMetrics.Tag<ScoresApi>()("@wnba/ScoresApi", {
  host: WnbaHost,
}) {}

/** WNBA league group — a nested group the dashboard drills into. */
export class Wnba extends Group.Tag<Wnba>("hub/Wnba")({
  LiveScorePoller,
  ScoresDb,
  BoxScoreQueue,
  PlayByPlayQueue,
  ScoresApi,
}) {}

/** The hub the dashboard renders. */
export class ServicesHub extends Group.Tag<ServicesHub>("hub/ServicesHub")({
  Wnba,
}) {}

// ── Browser runtime ──────────────────────────────────────────────────────────
// Every resource — the box-score queue, live-score poller, play-by-play queue, and the scores
// API-usage tap — is served remotely (server.ts); the browser is a thin `Resource.client` over each
// host's `/rpc` (vite proxies them). `ScoresApi` lives on `WnbaHost` alongside the box-score queue.
// One transport per host → one pip each, auto-fed by `HostStatus`.
const wnbaTransport = Resource.connectHttp(WnbaHost, { url: "/rpc" });
const liveTransport = Resource.connectHttp(LiveHost, { url: "/live/rpc" });
const statsTransport = Resource.connectHttp(StatsHost, { url: "/stats/rpc" });

// Expose each host itself in the runtime (not only the resource clients): the host-status die reads
// `HostStatus` over each host's transport, so it needs the host in context. Each transport is one
// const (shared by reference), so the client + the die reuse a single connection per host.
const appLayer = Layer.mergeAll(
  wnbaTransport,
  liveTransport,
  statsTransport,
  Resource.client(BoxScoreQueue).pipe(Layer.provide(wnbaTransport)),
  Resource.client(LiveScorePoller).pipe(Layer.provide(liveTransport)),
  Resource.client(PlayByPlayQueue).pipe(Layer.provide(statsTransport)),
  Resource.client(ScoresApi).pipe(Layer.provide(wnbaTransport)),
  Resource.client(ScoresDb).pipe(Layer.provide(wnbaTransport)),
);

/** One reactive runtime providing every resource in the hub. */
export const runtime = Atom.runtime(appLayer);
