/**
 * @module examples/apps/web/hub
 *
 * The review fixture for the shipped `hyperlink-ts/web` widgets — one of each **unique**
 * thing the dashboard renders: a nested group, a queue, a scheduled daemon (the WNBA live-score
 * poller), and an HttpApiClient nest fixture (`ScoresApi`). Every resource is **nodeed remotely** across three
 * nodes (served by `server.ts`); the browser reaches each via `Hyperlink.ws` (vite proxies
 * `/rpc` / `/live` / `/stats` with `ws: true`), which is what lights up the top-right **node die**. `ScoresApi` is a
 * nest-shaped fixture (`Gate.httpApiClientKind` + full `metrics` nest) served on
 * `WnbaNode`. `ScoresDb` is a dependency resource the box-score queue's readiness depends on
 * (`readinessOf`) — when its (simulated) connection blips, the queue cascades to degraded,
 * dogfooding dependency-aware readiness.
 */
import { Effect, Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as Hyperlink from "../../../src/Hyperlink";
import * as Policy from "../../../src/Policy";
import * as WorkPool from "../../../src/WorkPool";
import * as Daemon from "../../../src/Daemon";
import * as Group from "../../../src/Group";
import * as FleetHealth from "../../../src/FleetHealth";
import * as Telemetry from "../../../src/Telemetry";
import * as ShardMap from "../../../src/ShardMap";
import * as Gate from "../../../src/Gate";
import * as Node from "../../../src/Node";

const importJob = Schema.Struct({ id: Schema.String });
const session = Schema.Struct({ id: Schema.String, user: Schema.String });

// Three remote machines (see `server.ts`): the box-score queue on `WnbaNode`, the live-score poller
// on `LiveNode`, the play-by-play queue on `StatsNode` — so the dashboard's node die shows three
// pips (a pyramid).
/** The three nodes' ports (one process, three servers — see `server.ts`). Exported so the node
 *  endpoints here and the servers stay in sync. */
export const HOST_PORTS = { wnba: 7780, live: 7781, stats: 7782 } as const;

/** Absolute `{ http, ws }` endpoints for one host port — the multi-protocol Node shorthand.
 *  Peers dial these; the browser still uses same-origin `Hyperlink.ws({ url: "/rpc" | … })`
 *  overrides below (vite proxy) so it never opens `127.0.0.1` from the page origin. */
const hostEndpoints = (port: number) =>
  ({
    http: `http://127.0.0.1:${port}/rpc`,
    ws: `ws://127.0.0.1:${port}/rpc`,
  }) as const;

// One identity each, both wire protocols declared (P3 set-membership). Served today via
// `Node.wsServer`; peers use `layerPeerProtocol(protocolWebsocket)`.
export class WnbaNode extends Node.Service<WnbaNode>()("wnba/scores", hostEndpoints(HOST_PORTS.wnba)) {}
export class LiveNode extends Node.Service<LiveNode>()("wnba/live", hostEndpoints(HOST_PORTS.live)) {}
export class StatsNode extends Node.Service<StatsNode>()("wnba/stats", hostEndpoints(HOST_PORTS.stats)) {}

// A **multi-node** serviceKey: the SAME WorkerPool served on all three nodes — one class, three
// instances. `active` is this instance's own count (a leaf field peers can read); `fleetActive` is the
// total across the fleet — a `fleet`-tagged query the layer folds from `Hyperlink.peers` + its own
// value (see `server.ts`). Dogfoods `fleet` + `peers` + layer-from-effect end to end across three real
// servers.
export class WorkerPool extends Hyperlink.Service<WorkerPool>()("wnba/WorkerPool", {
  active: Hyperlink.effect(Schema.Number),
  fleetActive: Hyperlink.effect(Schema.Number).pipe(Hyperlink.fleet),
  // a per-node view (one row per node) — needs `selfNode` to key this instance's own row
  activeByNode: Hyperlink.effect(Schema.Record(Schema.String, Schema.Number)).pipe(Hyperlink.fleet),
}).pipe(
  Hyperlink.nodes([WnbaNode, LiveNode, StatsNode]), // nodeless, every instance an equal peer
) {}

// A **fleet-health** mesh across the three nodes — each instance reports its own readiness; `byNode`
// folds every peer's (Reachable / Unreachable), `status` rolls that up. Dogfoods the FleetHealth widget.
export class MeshHealth extends FleetHealth.Service<MeshHealth>()().pipe(
  Hyperlink.nodes([WnbaNode, LiveNode, StatsNode]),
) {}

// A **telemetry** mesh — each node's Metric registry (the queues emit `queue_in_flight`). `fleetInFlight`
// folds every node's in-flight, `inFlightByNode` breaks it down. Dogfoods the Telemetry widget.
export class FleetMetrics extends Telemetry.Service<FleetMetrics>()().pipe(
  Hyperlink.nodes([WnbaNode, LiveNode, StatsNode]),
) {}

// A **shard-map** mesh — active game sessions partitioned across the three nodes by `consistentHash`.
// `sizeLocal` is this node's shard; `sizeByNode` / `size` are fleet folds. Dogfoods the ShardMap widget.
export class Sessions extends ShardMap.Service<Sessions>()("wnba/Sessions", {
  key: Schema.String,
  value: session,
  keyOf: (s) => s.id,
}).pipe(Hyperlink.nodes([WnbaNode, LiveNode, StatsNode])) {}

// A **gate** — a bounded-concurrency gate over an effect (here a simulated box-score fetch). No
// queues/priorities; each `run` acquires one of `concurrency` permits inline. Served on LiveNode and
// driven concurrently so the GateCard shows live in-flight / waiting / done counters.
export class FetchGate extends Gate.Service<FetchGate>()("wnba/FetchGate", {
  payload: Schema.String,
  success: Schema.Number,
  error: Schema.String,
}) {}

// A "scores database" connection, served on WnbaNode. Its readiness reflects a (simulated) physical
// connection that drops briefly now and then; the box-score queue *depends on* it (below), so when the
// DB blips the queue cascades to degraded. This dogfoods `readinessOf` + the readiness cascade.
export class ScoresDb extends Hyperlink.Service<ScoresDb>()(
  "wnba/ScoresDb",
  { connected: Hyperlink.effect(Schema.Boolean) },
  { node: WnbaNode },
).pipe(
  Hyperlink.withReadiness((svc) =>
    Effect.map(svc.connected, (c) =>
      c ? { ready: true } : { ready: false, detail: "connecting to scores DB…" },
    ),
  ),
) {}

export class BoxScoreQueue extends WorkPool.Service<BoxScoreQueue>()(
  "wnba/BoxScoreQueue",
  { payload: importJob, node: WnbaNode },
).pipe(
  Hyperlink.withReadiness((_svc, base) =>
    Effect.gen(function* () {
      const queue = yield* base;
      const db = yield* Hyperlink.readinessOf(ScoresDb);
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
export class LiveScorePoller extends Daemon.Service<LiveScorePoller>()(
  "wnba/LiveScorePoller",
  { node: LiveNode },
).pipe(Daemon.schedule([])) {}
export class PlayByPlayQueue extends WorkPool.Service<PlayByPlayQueue>()(
  "wnba/PlayByPlayQueue",
  { payload: importJob, node: StatsNode },
) {}
// A **priority queue** — named lanes (hot / warm / cold) rather than the fixed high/normal/low. Exercises
// the priority-lane widget: `status.sizes` is an arbitrary Record, rendered a bar per lane.
export class ImportJobs extends WorkPool.priority<ImportJobs>()("wnba/ImportJobs", {
  payload: importJob,
  laneCount: 3,
  namedLanes: { hot: 0, warm: 1, cold: 2 },
  node: StatsNode,
}) {}
/** Observe-only fixture: same `metrics` nest as {@link Gate.HttpApiClient} (no outbound client). */
export class ScoresApi extends Hyperlink.Service<ScoresApi>()(
  "@wnba/ScoresApi",
  { metrics: Gate.httpApiMetricsNestSpec },
  { kind: Gate.httpApiClientKind, node: WnbaNode },
) {}

/** WNBA league group — a nested group the dashboard drills into. */
export class Wnba extends Group.Service<Wnba>("hub/Wnba")({
  LiveScorePoller,
  ScoresDb,
  BoxScoreQueue,
  PlayByPlayQueue,
  ImportJobs,
  ScoresApi,
  WorkerPool,
  MeshHealth,
  FleetMetrics,
  Sessions,
  FetchGate,
}) {}

/** The hub the dashboard renders. */
export class ServicesHub extends Group.Service<ServicesHub>("hub/ServicesHub")({
  Wnba,
}) {}

// ── Browser runtime ──────────────────────────────────────────────────────────
// Every resource — the box-score queue, live-score poller, play-by-play queue, and the scores
// API-usage tap — is served remotely (server.ts); the browser is a thin `Hyperlink.client` over each
// node's `/rpc` (vite proxies them). `ScoresApi` lives on `WnbaNode` alongside the box-score queue.
// One transport per node → one pip each, auto-fed by `node.status`.
// A browser opens many concurrent live streams (each resource's status + metrics + logs); over
// HTTP/1.1 that dies at the ~6-connection-per-origin cap. `ws` rides ONE multiplexed
// WebSocket per node instead — vite proxies these same-origin ws paths to each server (ws: true).
// A `"/path"` url resolves against the page origin (browser host + http/https→ws/wss), lazily — so
// `hub.ts` is safe to import from the Node server too (nothing reads `location` at load).
// Construct overrides *before* Hyperlink.client below — connectLayer registers each dial in the
// per-Node memo so addressed `Hyperlink.client` reuses `/rpc` instead of the tag's 127.0.0.1 (F5).
const wnbaTransport = Hyperlink.ws(WnbaNode, { url: "/rpc" });
const liveTransport = Hyperlink.ws(LiveNode, { url: "/live/rpc" });
const statsTransport = Hyperlink.ws(StatsNode, { url: "/stats/rpc" });

// Expose each node itself in the runtime (not only the HyperService clients): the node-status die /
// HealthBoard `yield*` these handles. `Layer.provide(transport)` on a client does **not** re-export
// the Node into the merged layer — transports must sit in `mergeAll` for the die. Each transport is
// one const (shared by reference), so the client + the die reuse a single connection per node.
const appLayer = Layer.mergeAll(
  wnbaTransport,
  liveTransport,
  statsTransport,
  Hyperlink.client(BoxScoreQueue).pipe(Layer.provide(wnbaTransport)),
  Hyperlink.client(LiveScorePoller).pipe(Layer.provide(liveTransport)),
  Hyperlink.client(PlayByPlayQueue).pipe(Layer.provide(statsTransport)),
  Hyperlink.client(ImportJobs).pipe(Layer.provide(statsTransport)),
  Hyperlink.client(ScoresApi).pipe(Layer.provide(wnbaTransport)),
  Hyperlink.client(ScoresDb).pipe(Layer.provide(wnbaTransport)),
  // WorkerPool is a *nodeless* multi-node tag, so the client names which instance to read — here the
  // one on WnbaNode. `client(tag, node)` resolves the transport from that node, so the requirement is
  // the node (satisfied by wnbaTransport), enforced at compile time.
  Hyperlink.client(WorkerPool, WnbaNode).pipe(Layer.provide(wnbaTransport)),
  Hyperlink.client(MeshHealth, WnbaNode).pipe(Layer.provide(wnbaTransport)),
  Hyperlink.client(FleetMetrics, WnbaNode).pipe(Layer.provide(wnbaTransport)),
  Hyperlink.client(Sessions, WnbaNode).pipe(Layer.provide(wnbaTransport)),
  // FetchGate is a nodeless gate served on LiveNode; name the instance to read (like WorkerPool).
  Hyperlink.client(FetchGate, LiveNode).pipe(Layer.provide(liveTransport)),
);

/** One reactive runtime providing every HyperService in the hub.
 *  Soft verify (`"status"`): ScoresDb intentionally blips readiness; deep `"reject"` would
 *  fail Layer build during those windows and take the whole dashboard down. Reachability still
 *  runs; failures are ignored so degraded cards stay mountable. */
export const runtime = Atom.runtime(
  appLayer.pipe(Policy.provide(Policy.verifyStatus)),
);
