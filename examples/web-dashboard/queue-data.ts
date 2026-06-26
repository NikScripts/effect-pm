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
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Resource, specOf } from "../../src/Resource";
import { Group } from "../../src/Group";
import { FRESH_MS, readCache, writeCache } from "./cache";
import {
  Billing,
  Daily,
  Fleet,
  Jobs,
  KeyRotation,
  Mail,
  MiniHost,
  Notify,
  pathOf,
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
export type LeafTag = Effect.Effect<QueueSvc, never, AllQueues> & { readonly id: string };
type ProcessSvc = [typeof KeyRotation] extends [Effect.Effect<infer A, infer _E, infer _R>] ? A : never;
/** A leaf process tag (yieldable for a process service). */
export type ProcessTag = Effect.Effect<ProcessSvc, never, KeyRotation> & { readonly id: string };

/** A node in the `Group.Tag` tree (a group). */
export interface GroupNode {
  readonly id: string;
  readonly members: Record<string, unknown>;
}

/** Which host a resource runs on (the Mini, else undefined = the Droplet). */
export const hostOf = (id: string): string | undefined => (id.includes("/Mini/") ? "mini" : undefined);

/** Which kind of leaf a tag is, by its contract (a queue enqueues; a process runs). */
export const kindOf = (member: unknown): "queue" | "process" => {
  const spec = specOf(member as { readonly [k: symbol]: unknown } as Parameters<typeof specOf>[0]);
  return "enqueue" in spec || "sizes" in spec ? "queue" : "process";
};

// remote transport per queue (its own http path; ndjson matches the server default).
const remote = (id: string) =>
  RpcClient.layerProtocolHttp({ url: `/rpc/${pathOf(id)}` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const appLayer = Layer.mergeAll(
  Resource.client(Mail).pipe(Layer.provide(remote(Mail.id))),
  Resource.client(Jobs).pipe(Layer.provide(remote(Jobs.id))),
  Resource.client(Billing).pipe(Layer.provide(remote(Billing.id))),
  Resource.client(Notify).pipe(Layer.provide(remote(Notify.id))),
  Resource.client(Worker1).pipe(Layer.provide(remote(Worker1.id))),
  Resource.client(Worker2).pipe(Layer.provide(remote(Worker2.id))),
  Resource.client(Worker3).pipe(Layer.provide(remote(Worker3.id))),
  Resource.client(RegionUS).pipe(Layer.provide(remote(RegionUS.id))),
  Resource.client(RegionEU).pipe(Layer.provide(remote(RegionEU.id))),
  Resource.client(Daily).pipe(Layer.provide(remote(Daily.id))),
  Resource.client(Weekly).pipe(Layer.provide(remote(Weekly.id))),
  // KeyRotation lives on the Mini host — reached through its own transport, not the Droplet.
  Resource.client(KeyRotation).pipe(Layer.provide(Resource.connectHttp(MiniHost, { url: "/mini/rpc" }))),
);

/** One reactive runtime that reaches every queue (over the wire). */
export const runtime = Atom.runtime(appLayer);

/** A read/stream value atom (error channel erased — widgets only read success). */
export type ValueAtom<A> = Atom.Atom<AsyncResult.AsyncResult<A, unknown>>;
/** A no-arg command trigger. */
export type CommandAtom = Atom.AtomResultFn<void, unknown, unknown>;

/** The atoms + controls one queue card needs — all derived from the tag. */
export interface QueueBundle {
  readonly status: ValueAtom<QueueStatus>;
  readonly metrics: ValueAtom<QueueMetrics>;
  readonly history: ValueAtom<ReadonlyArray<MetricPoint>>;
  readonly trend: ValueAtom<ReadonlyArray<number>>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  readonly pause: CommandAtom;
  readonly resume: CommandAtom;
  readonly clear: CommandAtom;
  readonly shutdown: CommandAtom;
}
type QueueStatus = QueueSvc extends { readonly status: Stream.Stream<infer S, infer _E, infer _R> } ? S : never;
type QueueMetrics = QueueSvc extends { readonly metrics: Stream.Stream<infer M, infer _E, infer _R> } ? M : never;

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
  readonly live: Stream.Stream<A, never, R>;
  readonly history?: Effect.Effect<ReadonlyArray<A>, never, R>;
}): Stream.Stream<ReadonlyArray<A>, never, R> => {
  const entry = readCache<A>(opts.key);
  const fresh = entry !== undefined && Date.now() - entry.at < FRESH_MS;
  const seed: ReadonlyArray<A> = fresh && entry !== undefined ? entry.items : [];
  const source =
    fresh || opts.history === undefined
      ? opts.live
      : Stream.concat(Stream.unwrap(Effect.map(opts.history, Stream.fromIterable)), opts.live);
  return source.pipe(
    Stream.scan(seed, (acc, x) => [...acc, x].slice(-opts.cap)),
    Stream.tap((acc) => Effect.sync(() => writeCache(opts.key, acc))),
  );
};

const cache = new Map<string, QueueBundle>();

/** Build (once per tag) the atom bundle for a queue tag. */
export const queueBundle = (tag: LeafTag): QueueBundle => {
  const existing = cache.get(tag.id);
  if (existing !== undefined) return existing;

  const statusStream = Stream.unwrap(Effect.map(tag, (q) => q.status));
  const metricsStream = Stream.unwrap(Effect.map(tag, (q) => q.metrics));
  const toPoint = (m: QueueMetrics): MetricPoint => ({
    t: Date.now(),
    throughput: m.throughputPerSec,
    latency: m.avgTotalMillis ?? 0,
  });
  bumpLogIdFrom(`${tag.id}/logs`);

  // all accumulators go through the generic cache: instant paint from localStorage, skip
  // the server query while the snapshot is fresh, then follow live. One mechanism, no
  // per-resource cache code.
  const bundle: QueueBundle = {
    status: runtime.atom(statusStream),
    metrics: runtime.atom(metricsStream),
    history: runtime.atom(
      cachedAccumulator({
        key: `${tag.id}/history`,
        cap: HISTORY,
        live: metricsStream.pipe(Stream.map(toPoint)),
        history: Effect.flatMap(tag, (q) => q.metricsHistory({ limit: HISTORY })).pipe(
          Effect.map((ms) => ms.map(toPoint)),
        ),
      }),
    ),
    trend: runtime.atom(
      cachedAccumulator({
        key: `${tag.id}/trend`,
        cap: TREND,
        live: statusStream.pipe(Stream.map((s) => s.sizes.high + s.sizes.normal + s.sizes.low)),
      }),
    ),
    logs: runtime.atom(
      cachedAccumulator({
        key: `${tag.id}/logs`,
        cap: 300,
        live: Stream.unwrap(Effect.map(tag, (q) => q.logs)).pipe(Stream.map(toLogLine)),
        history: Effect.flatMap(tag, (q) => q.logHistory({ limit: 300 })).pipe(
          Effect.map((ls) => ls.map(toLogLine)),
        ),
      }),
    ),
    pause: runtime.fn(() => Effect.flatMap(tag, (q) => q.pause)),
    resume: runtime.fn(() => Effect.flatMap(tag, (q) => q.resume)),
    clear: runtime.fn(() => Effect.flatMap(tag, (q) => q.clear)),
    shutdown: runtime.fn(() => Effect.flatMap(tag, (q) => q.shutdown)),
  };
  cache.set(tag.id, bundle);
  return bundle;
};

type ProcessStatus = ProcessSvc extends { readonly status: Stream.Stream<infer S, infer _E, infer _R> } ? S : never;

/** The atoms + controls one process card needs — derived from the tag. */
export interface ProcessBundle {
  readonly status: ValueAtom<ProcessStatus>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  readonly start: CommandAtom;
  readonly stop: CommandAtom;
  readonly runImmediately: CommandAtom;
}
const processCache = new Map<string, ProcessBundle>();

/** Build (once per tag) the atom bundle for a process tag. */
export const processBundle = (tag: ProcessTag): ProcessBundle => {
  const existing = processCache.get(tag.id);
  if (existing !== undefined) return existing;
  const statusStream = Stream.unwrap(Effect.map(tag, (p) => p.status));
  bumpLogIdFrom(`${tag.id}/logs`);
  const bundle: ProcessBundle = {
    status: runtime.atom(statusStream),
    // cached + query-then-tail, same generic mechanism as the queue.
    logs: runtime.atom(
      cachedAccumulator({
        key: `${tag.id}/logs`,
        cap: 300,
        live: Stream.unwrap(Effect.map(tag, (p) => p.logs)).pipe(Stream.map(toLogLine)),
        history: Effect.flatMap(tag, (p) => p.logHistory({ limit: 300 })).pipe(
          Effect.map((ls) => ls.map(toLogLine)),
        ),
      }),
    ),
    start: runtime.fn(() => Effect.flatMap(tag, (p) => p.start)),
    stop: runtime.fn(() => Effect.flatMap(tag, (p) => p.stop)),
    runImmediately: runtime.fn(() => Effect.flatMap(tag, (p) => p.runImmediately)),
  };
  processCache.set(tag.id, bundle);
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
  Stream.unwrap(Effect.map(tag, (q) => q.status)).pipe(Stream.map((s): FleetEvent => ({ tag, s, m: undefined }))),
  Stream.unwrap(Effect.map(tag, (q) => q.metrics)).pipe(Stream.map((m): FleetEvent => ({ tag, s: undefined, m }))),
]);

/** id → live {@link FleetRow} for every queue in the fleet. */
export const fleetAtom = runtime.atom(
  Stream.mergeAll(fleetEvents, { concurrency: "unbounded" }).pipe(
    Stream.scan({} as Record<string, FleetRow>, (acc, ev) => {
      const prev = acc[ev.tag.id] ?? blankRow(ev.tag);
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
      return { ...acc, [ev.tag.id]: next };
    }),
  ),
);
