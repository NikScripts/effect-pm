/**
 * @module examples/web-dashboard/queue-data
 *
 * Tag-driven data layer. Each queue **tag** is the source of truth; this builds the
 * atom bundle the widgets need (status / metrics+history / trend / logs + controls)
 * straight from the tag's live service. The service comes from `Resource.client` over
 * http — so this is the **remote** layer (swap `clientLayer` for `QueueResource.layer`
 * to run the engine locally; the widgets don't change). No `REGISTRY`, no `TREE`.
 */
import { Effect, Layer, Stream } from "effect";
import { Atom, type AsyncResult } from "effect/unstable/reactivity";
import * as Resource from "../../src/Resource";
import { specOf } from "../../src/Resource";
import * as Group from "../../src/Group";
import * as LogEntry from "../../src/LogEntry";
import * as NodeStatus from "../../src/NodeStatus";
import { FRESH_MS, readCache, writeCache } from "./cache";
import {
  Billing,
  Daily,
  Fleet,
  Jobs,
  KeyRotation,
  Droplet,
  Mail,
  MiniNode,
  Notify,
  RegionEU,
  RegionUS,
  Weekly,
  Worker1,
  Worker2,
  Worker3,
} from "./fleet";

/** A captured log line for the log pane. */
export interface LogLine {
  readonly id: number;
  readonly t: number;
  readonly level: string;
  readonly message: string;
}
/** A windowed metrics sample for the chart. */
export interface MetricPoint {
  readonly t: number;
  readonly throughput: number;
  readonly latency: number;
}

type AllQueues =
  | Mail | Jobs | Billing | Notify
  | Worker1 | Worker2 | Worker3
  | RegionUS | RegionEU | Daily | Weekly;
type QueueSvc = [typeof Mail] extends [Effect.Effect<infer A, infer _E, infer _R>] ? A : never;
/** A leaf queue tag (yieldable for the fleet's queue service). */
export type LeafTag = Effect.Effect<QueueSvc, never, AllQueues> & { readonly key: string };
type ProcessSvc = [typeof KeyRotation] extends [Effect.Effect<infer A, infer _E, infer _R>] ? A : never;
/** A leaf process tag (yieldable for a process service). */
export type ProcessTag = Effect.Effect<ProcessSvc, never, KeyRotation> & { readonly key: string };

/** A node in the `Group.Tag` tree (a group). */
export interface GroupNode {
  readonly key: string;
  readonly members: Record<string, unknown>;
}

/** Which node a resource runs on (the Mini, else undefined = the Droplet). */
export const nodeOf = (id: string): string | undefined => (id.includes("/Mini/") ? "mini" : undefined);

/** Which kind of leaf a tag is, by its contract (a queue enqueues; a process runs). */
export const kindOf = (member: unknown): "queue" | "process" => {
  const spec = specOf(member as { readonly [k: symbol]: unknown } as Parameters<typeof specOf>[0]);
  return "enqueue" in spec || "sizes" in spec ? "queue" : "process";
};

// In the browser the client is same-origin (vite proxies /rpc → Droplet, /mini → Mini).
// In Node (the TUI) there's no proxy, so reach the servers directly.
const inBrowser = typeof window !== "undefined";
const dropletRpc = inBrowser ? "/rpc" : "http://localhost:7777/rpc";
/** The Mini node's rpc endpoint (used by `httpClient`). */
export const miniUrl = inBrowser ? "/mini/rpc" : "http://localhost:7778/rpc";

// One transport per HOST — each node serves its whole group on one /rpc (httpServer),
// so every Droplet queue shares `dropletTransport`; KeyRotation reaches the Mini. WebSocket
// (not http) so the browser's many live streams multiplex over one connection per node instead
// of starving at the ~6-connection HTTP/1.1 cap — see docs/observe/dashboard.md. `socketClient`
// resolves a "/path" against the page origin, and swaps http→ws for the non-browser (CLI) url.
const dropletTransport = Resource.socketClient(Droplet, { url: dropletRpc });
const miniTransport = Resource.socketClient(MiniNode, { url: miniUrl });

// Point the nodeless NodeStatus client at a specific node with the 2-arg `client(tag, node)` form — it
// reads the node's value and unwraps its transport. (The node is exposed in `appLayer` below.)
const nodeStatusLayer = (resourceKey: string) =>
  Resource.client(NodeStatus.Tag, nodeOf(resourceKey) === "mini" ? MiniNode : Droplet);

/** The merged remote client layer — every fleet resource over http. Shared by the
 *  reactive runtime (below) and the `pm` CLI (run-and-exit commands). */
export const appLayer = Layer.mergeAll(
  // EXPOSE each node's transport (not just provide it INTO the queue clients) so the node tag itself is
  // in the runtime context. The HealthBoard's per-node `NodeStatus` reads it via `client(tag, node)`;
  // without this, that node isn't resolvable and the node status hangs on "connecting…".
  dropletTransport,
  miniTransport,
  Resource.client(Mail).pipe(Layer.provide(dropletTransport)),
  Resource.client(Jobs).pipe(Layer.provide(dropletTransport)),
  Resource.client(Billing).pipe(Layer.provide(dropletTransport)),
  Resource.client(Notify).pipe(Layer.provide(dropletTransport)),
  Resource.client(Worker1).pipe(Layer.provide(dropletTransport)),
  Resource.client(Worker2).pipe(Layer.provide(dropletTransport)),
  Resource.client(Worker3).pipe(Layer.provide(dropletTransport)),
  Resource.client(RegionUS).pipe(Layer.provide(dropletTransport)),
  Resource.client(RegionEU).pipe(Layer.provide(dropletTransport)),
  Resource.client(Daily).pipe(Layer.provide(dropletTransport)),
  Resource.client(Weekly).pipe(Layer.provide(dropletTransport)),
  // KeyRotation lives on the Mini node — its own transport, not the Droplet.
  Resource.client(KeyRotation).pipe(Layer.provide(miniTransport)),
);

/** One reactive runtime that reaches every queue (over the wire). */
export const runtime = Atom.runtime(appLayer);

/** A read/stream value atom (error channel erased — widgets only read success). */
export type ValueAtom<A> = Atom.Atom<AsyncResult.AsyncResult<A, unknown>>;
/** A no-arg command trigger. */
export type CommandAtom = Atom.AtomResultFn<void, unknown, unknown>;

/** The atoms + controls one queue card needs — all derived from the tag. */
export interface QueueBundle {
  readonly status: ValueAtom<QueueStatus | undefined>;
  readonly metrics: ValueAtom<QueueMetrics | undefined>;
  readonly history: ValueAtom<ReadonlyArray<MetricPoint>>;
  readonly trend: ValueAtom<ReadonlyArray<number>>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  readonly pause: CommandAtom;
  readonly resume: CommandAtom;
  readonly clear: CommandAtom;
  readonly shutdown: CommandAtom;
}
type QueueStatus = QueueSvc["status"] extends Resource.Subscribable<infer S> ? S : never;
type QueueMetrics = QueueSvc["metrics"] extends {
  readonly stream: Stream.Stream<infer M, infer _E, infer _R>;
} ? M : never;

// one combined metrics stream carries both backfill points and live raw metrics
type MetricsItem = { readonly point: MetricPoint } | { readonly metric: QueueMetrics };

const HISTORY = 120;
const TREND = 60;
let logId = 0;

/** Map a captured log entry to the UI line (monotonic id for stable React keys). */
const toLogLine = (l: { readonly level: string; readonly message: string }): LogLine => ({
  id: (logId += 1),
  t: Date.now(),
  level: l.level,
  message: l.message,
});
/** Continue log ids past anything restored from the cache so React keys stay unique. */
const bumpLogIdFrom = (key: string): void => {
  const entry = readCache<LogLine>(key);
  if (entry !== undefined) logId = entry.items.reduce((mx, l) => Math.max(mx, l.id), logId);
};

/**
 * Generic cached accumulator: seed from the localStorage snapshot (instant paint + skip
 * the server history query while the snapshot is fresh), accumulate the live stream, and
 * persist — one mechanism for every resource/atom, no per-type cache code.
 */
const cachedAccumulator = <A, R>(opts: {
  readonly key: string;
  readonly cap: number;
  readonly stream: Stream.Stream<A, never, R>;
  readonly query?: Effect.Effect<ReadonlyArray<A>, never, R>;
}): Stream.Stream<ReadonlyArray<A>, never, R> => {
  const entry = readCache<A>(opts.key);
  const fresh = entry !== undefined && Date.now() - entry.at < FRESH_MS;
  const seed: ReadonlyArray<A> = fresh && entry !== undefined ? entry.items : [];
  const source =
    fresh || opts.query === undefined
      ? opts.stream
      : Stream.concat(Stream.unwrap(Effect.map(opts.query, Stream.fromIterable)), opts.stream);
  return source.pipe(
    Stream.scan(seed, (acc, x) => [...acc, x].slice(-opts.cap)),
    Stream.tap((acc) => Effect.sync(() => writeCache(opts.key, acc))),
  );
};

const cache = new Map<string, QueueBundle>();

const resourceLogsAccumulator = (resourceKey: string) =>
  runtime.atom(
    cachedAccumulator({
      key: `${resourceKey}/logs`,
      cap: 300,
      stream: Stream.unwrap(Effect.map(NodeStatus.Tag, (h) => h.logs.stream)).pipe(
        Stream.filter(LogEntry.hasKey(resourceKey)),
        Stream.map(toLogLine),
      ),
      query: Effect.flatMap(NodeStatus.Tag, (h) => h.logs.query({ limit: 300 })).pipe(
        Effect.map((entries) => entries.filter(LogEntry.hasKey(resourceKey)).map(toLogLine)),
      ),
    }).pipe(Stream.provide(nodeStatusLayer(resourceKey))),
  );

/** Build (once per tag) the atom bundle for a queue tag. */
export const queueBundle = (tag: LeafTag): QueueBundle => {
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;

  const statusStream = Stream.unwrap(Effect.map(tag, (q) => q.status.changes));
  const metricsStream = Stream.unwrap(Effect.map(tag, (q) => q.metrics.stream));
  const toPoint = (m: QueueMetrics): MetricPoint => ({
    t: Date.now(),
    throughput: m.throughputPerSec,
    latency: m.avgTotalMillis ?? 0,
  });
  const trendValue = (s: QueueStatus): number => s.sizes.high + s.sizes.normal + s.sizes.low;
  bumpLogIdFrom(`${tag.key}/logs`);

  // Dedup the wire streams. ONE status stream feeds both `status` and `trend`; ONE metrics
  // stream feeds both `metrics` and `history` — derived via Atom.mapResult, so the registry
  // runs each underlying stream once. (Separate atoms each opened their own RPC stream: a
  // detail's status + trend + metrics + history streams, plus logs and two history queries,
  // blew past the browser's ~6-connection-per-origin limit, leaving the last two — trend and
  // history — stuck "Waiting" until an interaction freed a slot.) The metrics-history backfill
  // is concatenated ahead of live; trend/history seed from the localStorage cache.
  const statusTrend = runtime.atom(
    statusStream.pipe(
      Stream.scan(
        {
          latest: undefined as QueueStatus | undefined,
          trend: readCache<number>(`${tag.key}/trend`)?.items ?? [],
        },
        (acc, s) => ({ latest: s, trend: [...acc.trend, trendValue(s)].slice(-TREND) }),
      ),
      Stream.tap((acc) => Effect.sync(() => writeCache(`${tag.key}/trend`, acc.trend))),
    ),
  );
  const metricsHistory = runtime.atom(
    Stream.concat(
      Stream.unwrap(
        Effect.flatMap(tag, (q) => q.metrics.query({ limit: HISTORY })).pipe(
          Effect.map((ms) => Stream.fromIterable(ms.map((m): MetricsItem => ({ point: toPoint(m) })))),
        ),
      ),
      metricsStream.pipe(Stream.map((m): MetricsItem => ({ metric: m }))),
    ).pipe(
      Stream.scan(
        {
          latest: undefined as QueueMetrics | undefined,
          history: readCache<MetricPoint>(`${tag.key}/history`)?.items ?? [],
        },
        (acc, item) =>
          "metric" in item
            ? { latest: item.metric, history: [...acc.history, toPoint(item.metric)].slice(-HISTORY) }
            : { latest: acc.latest, history: [...acc.history, item.point].slice(-HISTORY) },
      ),
      Stream.tap((acc) => Effect.sync(() => writeCache(`${tag.key}/history`, acc.history))),
    ),
  );

  const bundle: QueueBundle = {
    status: Atom.mapResult(statusTrend, (a) => a.latest),
    metrics: Atom.mapResult(metricsHistory, (a) => a.latest),
    history: Atom.mapResult(metricsHistory, (a) => a.history),
    trend: Atom.mapResult(statusTrend, (a) => a.trend),
    logs: resourceLogsAccumulator(tag.key),
    pause: runtime.fn(() => Effect.flatMap(tag, (q) => q.pause)),
    resume: runtime.fn(() => Effect.flatMap(tag, (q) => q.resume)),
    clear: runtime.fn(() => Effect.flatMap(tag, (q) => q.clear)),
    shutdown: runtime.fn(() => Effect.flatMap(tag, (q) => q.shutdown)),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

type ProcessStatus = ProcessSvc["status"] extends Resource.Subscribable<infer S> ? S : never;

/** The atoms + controls one process card needs — derived from the tag. */
export interface ProcessBundle {
  readonly status: ValueAtom<ProcessStatus>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  readonly start: CommandAtom;
  readonly stop: CommandAtom;
  readonly run: CommandAtom;
}
const processCache = new Map<string, ProcessBundle>();

/** Build (once per tag) the atom bundle for a process tag. */
export const processBundle = (tag: ProcessTag): ProcessBundle => {
  const existing = processCache.get(tag.key);
  if (existing !== undefined) return existing;
  const statusStream = Stream.unwrap(Effect.map(tag, (p) => p.status.changes));
  bumpLogIdFrom(`${tag.key}/logs`);
  const bundle: ProcessBundle = {
    status: runtime.atom(statusStream),
    // cached + query-then-tail, same generic mechanism as the queue.
    logs: resourceLogsAccumulator(tag.key),
    start: runtime.fn(() => Effect.flatMap(tag, (p) => p.start)),
    stop: runtime.fn(() => Effect.flatMap(tag, (p) => p.stop)),
    run: runtime.fn(() => Effect.flatMap(tag, (p) => p.run)),
  };
  processCache.set(tag.key, bundle);
  return bundle;
};

/** Walk a `Group.Tag` tree to its leaf resource tags (queues + processes), raw. */
export const leafTags = (node: { readonly members: Record<string, unknown> }): ReadonlyArray<unknown> =>
  Object.values(Group.members(node)).flatMap((m) => (Group.isGroup(m) ? leafTags(m) : [m]));

/** Only the queue leaves of a tree. */
export const queueLeaves = (node: { readonly members: Record<string, unknown> }): ReadonlyArray<LeafTag> =>
  leafTags(node).filter((m) => kindOf(m) === "queue") as ReadonlyArray<LeafTag>;

/** Only the process leaves of a tree. */
export const processLeaves = (node: { readonly members: Record<string, unknown> }): ReadonlyArray<ProcessTag> =>
  leafTags(node).filter((m) => kindOf(m) === "process") as ReadonlyArray<ProcessTag>;

/** One row of the fleet table — headline status + metrics, carrying its tag. */
export interface FleetRow {
  readonly tag: LeafTag;
  readonly phase: string;
  readonly paused: boolean;
  readonly pending: number;
  readonly completed: number;
  readonly inFlight: number;
  readonly throughput: number;
  readonly latency: number;
}

/** A blank row for a queue that hasn't reported yet. */
export const blankRow = (tag: LeafTag): FleetRow => ({
  tag,
  phase: "running",
  paused: false,
  pending: 0,
  completed: 0,
  inFlight: 0,
  throughput: 0,
  latency: 0,
});

// one aggregate atom across the whole fleet (status + metrics of every leaf),
// derived straight from the tags — the sortable table reads it.
interface FleetEvent {
  readonly tag: LeafTag;
  readonly s: QueueStatus | undefined;
  readonly m: QueueMetrics | undefined;
}
const fleetEvents: ReadonlyArray<Stream.Stream<FleetEvent, never, AllQueues>> = queueLeaves(Fleet).flatMap((tag) => [
  Stream.unwrap(Effect.map(tag, (q) => q.status.changes)).pipe(Stream.map((s): FleetEvent => ({ tag, s, m: undefined }))),
  Stream.unwrap(Effect.map(tag, (q) => q.metrics.stream)).pipe(Stream.map((m): FleetEvent => ({ tag, s: undefined, m }))),
]);

/** id → live {@link FleetRow} for every queue in the fleet. */
export const fleetAtom = runtime.atom(
  Stream.mergeAll(fleetEvents, { concurrency: "unbounded" }).pipe(
    Stream.scan({} as Record<string, FleetRow>, (acc, ev) => {
      const prev = acc[ev.tag.key] ?? blankRow(ev.tag);
      const next: FleetRow =
        ev.s !== undefined
          ? {
              ...prev,
              phase: ev.s.phase,
              paused: ev.s.paused,
              pending: ev.s.sizes.high + ev.s.sizes.normal + ev.s.sizes.low,
              completed: ev.s.completed,
              inFlight: ev.s.inFlight,
            }
          : ev.m !== undefined
            ? { ...prev, throughput: ev.m.throughputPerSec, latency: ev.m.avgTotalMillis ?? 0 }
            : prev;
      return { ...acc, [ev.tag.key]: next };
    }),
  ),
);
