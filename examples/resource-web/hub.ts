/**
 * @module examples/resource-web/hub
 *
 * The review fixture for the shipped `@nikscripts/effect-pm/web` widgets — one of each **unique**
 * thing the dashboard renders: a nested group, a queue, a scheduled process (the WNBA live-score
 * poller), and an API-usage tap (`ScoresApi`). Every resource is **nodeed remotely** across three
 * nodes (served by `server.ts`); the browser reaches each via `Resource.httpClient` (vite proxies
 * `/rpc` / `/live` / `/stats`), which is what lights up the top-right **node die**. `ScoresApi` is an
 * `ApiMetrics` resource served on `WnbaNode` via `ApiMetrics.serve`. `ScoresDb` is a dependency
 * resource the box-score queue's readiness depends on (`readinessOf`) — when its (simulated)
 * connection blips, the queue cascades to degraded, dogfooding dependency-aware readiness.
 */
import { Effect, Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as Resource from "../../src/Resource";
import * as QueueResource from "../../src/QueueResource";
import * as Process from "../../src/Process";
import * as Group from "../../src/Group";
import * as ApiMetrics from "../../src/ApiMetrics";

const importJob = Schema.Struct({ id: Schema.String });

// Three remote machines (see `server.ts`): the box-score queue on `WnbaNode`, the live-score poller
// on `LiveNode`, the play-by-play queue on `StatsNode` — so the dashboard's node die shows three
// pips (a pyramid).
/** The three nodes' ports (one process, three servers — see `server.ts`). Exported so the node urls
 *  here and the servers stay in sync. Each node carries its server-side url so `Resource.peersLayer`
 *  can reach its peers; the browser overrides it with a vite-proxied path (below). */
export const HOST_PORTS = { wnba: 7780, live: 7781, stats: 7782 } as const;
const rpcUrl = (port: number) => `http://127.0.0.1:${port}/rpc`;

export class WnbaNode extends Resource.Node<WnbaNode>("wnba/scores", { url: rpcUrl(HOST_PORTS.wnba) }) {}
export class LiveNode extends Resource.Node<LiveNode>("wnba/live", { url: rpcUrl(HOST_PORTS.live) }) {}
export class StatsNode extends Resource.Node<StatsNode>("wnba/stats", { url: rpcUrl(HOST_PORTS.stats) }) {}

// A **multi-node** resource: the SAME WorkerPool served on all three nodes — one class, three
// instances. `active` is this instance's own count (a leaf field peers can read); `fleetActive` is the
// total across the fleet — a `fleet`-tagged query the layer folds from `Resource.peers` + its own
// value (see `server.ts`). Dogfoods `fleet` + `peers` + layer-from-effect end to end across three real
// servers.
export class WorkerPool extends Resource.Tag<WorkerPool>()("wnba/WorkerPool", {
  active: Resource.effect(Schema.Number),
  fleetActive: Resource.effect(Schema.Number).pipe(Resource.fleet),
  // a per-node view (one row per node) — needs `selfNode` to key this instance's own row
  activeByNode: Resource.effect(Schema.Record(Schema.String, Schema.Number)).pipe(Resource.fleet),
}).pipe(
  Resource.distributed([WnbaNode, LiveNode, StatsNode]), // nodeless, every instance an equal peer
) {}

// A "scores database" connection, served on WnbaNode. Its readiness reflects a (simulated) physical
// connection that drops briefly now and then; the box-score queue *depends on* it (below), so when the
// DB blips the queue cascades to degraded. This dogfoods `readinessOf` + the readiness cascade.
export class ScoresDb extends Resource.Tag<ScoresDb>()(
  "wnba/ScoresDb",
  { connected: Resource.effect(Schema.Boolean) },
  { node: WnbaNode },
).pipe(
  Resource.withReadiness((svc) =>
    Effect.map(svc.connected, (c) =>
      c ? { ready: true } : { ready: false, detail: "connecting to scores DB…" },
    ),
  ),
) {}

export class BoxScoreQueue extends QueueResource.Tag<BoxScoreQueue>()(
  "wnba/BoxScoreQueue",
  { payload: importJob, node: WnbaNode },
).pipe(
  Resource.withReadiness((_svc, base) =>
    Effect.gen(function* () {
      const queue = yield* base;
      const db = yield* Resource.readinessOf(ScoresDb);
      const ready = queue.ready && db.ready;
      return ready
        ? { ready: true as const }
        : {
            ready: false as const,
            detail: [queue.detail, db.detail].filter(Boolean).join("; ") || undefined,
          };
    }),
  ),
) {}
// Owns an inline schedule (seeded empty; `server.ts` seeds the live game windows at startup) so the
// dashboard can read + edit its run windows through the `schedule` verb group.
export class LiveScorePoller extends Process.Tag<LiveScorePoller>()(
  "wnba/LiveScorePoller",
  { node: LiveNode },
).pipe(Process.schedule([])) {}
export class PlayByPlayQueue extends QueueResource.Tag<PlayByPlayQueue>()(
  "wnba/PlayByPlayQueue",
  { payload: importJob, node: StatsNode },
) {}
export class ScoresApi extends ApiMetrics.Tag<ScoresApi>()("@wnba/ScoresApi", {
  node: WnbaNode,
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
// node's `/rpc` (vite proxies them). `ScoresApi` lives on `WnbaNode` alongside the box-score queue.
// One transport per node → one pip each, auto-fed by `NodeStatus`.
const wnbaTransport = Resource.httpClient(WnbaNode, { url: "/rpc" });
const liveTransport = Resource.httpClient(LiveNode, { url: "/live/rpc" });
const statsTransport = Resource.httpClient(StatsNode, { url: "/stats/rpc" });

// Expose each node itself in the runtime (not only the resource clients): the node-status die reads
// `NodeStatus` over each node's transport, so it needs the node in context. Each transport is one
// const (shared by reference), so the client + the die reuse a single connection per node.
const appLayer = Layer.mergeAll(
  wnbaTransport,
  liveTransport,
  statsTransport,
  Resource.client(BoxScoreQueue).pipe(Layer.provide(wnbaTransport)),
  Resource.client(LiveScorePoller).pipe(Layer.provide(liveTransport)),
  Resource.client(PlayByPlayQueue).pipe(Layer.provide(statsTransport)),
  Resource.client(ScoresApi).pipe(Layer.provide(wnbaTransport)),
  Resource.client(ScoresDb).pipe(Layer.provide(wnbaTransport)),
  // WorkerPool is a *nodeless* multi-node tag, so the client names which instance to read — here the
  // one on WnbaNode. `client(tag, node)` resolves the transport from that node, so the requirement is
  // the node (satisfied by wnbaTransport), enforced at compile time.
  Resource.client(WorkerPool, WnbaNode).pipe(Layer.provide(wnbaTransport)),
);

/** One reactive runtime providing every resource in the hub. */
export const runtime = Atom.runtime(appLayer);
