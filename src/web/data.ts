/**
 * @module web/data
 *
 * Tag-driven data layer for the dashboard. Each resource **tag** is the source of truth;
 * `queueBundle` / `processBundle` build the atom bundle the widgets read (status /
 * metrics+history / trend / logs + controls) straight from the tag's live service over the
 * consumer's reactive `runtime` (an `Atom.runtime(layer)` that provides the tags — local
 * engine or `Resource.client` over http; the widgets don't care which).
 *
 * @since 1.0.0
 */
import { Effect, type Schema, Stream } from "effect";
import { Atom, type AsyncResult } from "effect/unstable/reactivity";
import { Group } from "../Group";
import { specOf } from "../Resource";
import { queueMetrics, queueStatus } from "../QueueContract";
import { processStatus } from "../ScheduledProcess";
import { FRESH_MS, readCache, writeCache } from "./cache";
import { now } from "./now";

/** Live queue status (from the contract schema). @since 1.0.0 */
export type QueueStatus = Schema.Schema.Type<typeof queueStatus>;
/** Live queue metrics (from the contract schema). @since 1.0.0 */
export type QueueMetrics = Schema.Schema.Type<typeof queueMetrics>;
/** Live process status (from the contract schema). @since 1.0.0 */
export type ProcessStatus = Schema.Schema.Type<typeof processStatus>;

/** A captured log line for the log pane. @since 1.0.0 */
export interface LogLine {
  readonly id: number;
  readonly t: number;
  readonly level: string;
  readonly message: string;
}
/** A windowed metrics sample for the chart. @since 1.0.0 */
export interface MetricPoint {
  readonly t: number;
  readonly throughput: number;
  readonly latency: number;
}

/** The structural shape of a queue's live service the widgets consume. */
interface QueueService {
  readonly status: Stream.Stream<QueueStatus>;
  readonly metrics: Stream.Stream<QueueMetrics>;
  readonly logs: Stream.Stream<{ readonly level: string; readonly message: string }>;
  readonly metricsHistory: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<QueueMetrics>>;
  readonly logHistory: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<{ readonly level: string; readonly message: string }>>;
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
}
/** The structural shape of a process's live service. */
interface ProcessService {
  readonly status: Stream.Stream<ProcessStatus>;
  readonly logs: Stream.Stream<{ readonly level: string; readonly message: string }>;
  readonly logHistory: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<{ readonly level: string; readonly message: string }>>;
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly runImmediately: Effect.Effect<void>;
}

/** A queue tag — yieldable for its live service. Requirement `R` is provided by the runtime. @since 1.0.0 */
export type QueueTag<R = never> = Effect.Effect<QueueService, never, R> & { readonly id: string };
/** A process tag — yieldable for its live service. @since 1.0.0 */
export type ProcessTag<R = never> = Effect.Effect<ProcessService, never, R> & { readonly id: string };

/** A node in a `Group.Tag` tree. @since 1.0.0 */
export interface GroupNode {
  readonly id: string;
  readonly members: Record<string, unknown>;
}

/** A read/stream value atom (error channel erased — widgets only read success). @since 1.0.0 */
export type ValueAtom<A> = Atom.Atom<AsyncResult.AsyncResult<A, unknown>>;
/** A no-arg command trigger. @since 1.0.0 */
export type CommandAtom = Atom.AtomResultFn<void, unknown, unknown>;

/** Any reactive runtime that provides the dashboard's tags. @since 1.0.0 */
export type DashboardRuntime<R = never, ER = never> = Atom.AtomRuntime<R, ER>;

/** The atoms + controls one queue card needs — all derived from the tag. @since 1.0.0 */
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
/** The atoms + controls one process card needs — derived from the tag. @since 1.0.0 */
export interface ProcessBundle {
  readonly status: ValueAtom<ProcessStatus | undefined>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  readonly start: CommandAtom;
  readonly stop: CommandAtom;
  readonly runImmediately: CommandAtom;
}

/** Which kind of leaf a tag is, by its contract (a queue enqueues; a process runs). @since 1.0.0 */
export const kindOf = (member: unknown): "queue" | "process" => {
  const spec = specOf(member as Parameters<typeof specOf>[0]);
  return "enqueue" in spec || "sizes" in spec ? "queue" : "process";
};

// one combined metrics stream carries both backfill points and live raw metrics
type MetricsItem = { readonly point: MetricPoint } | { readonly metric: QueueMetrics };

const HISTORY = 120;
const TREND = 60;
let logId = 0;

const toLogLine = (l: { readonly level: string; readonly message: string }): LogLine => ({
  id: (logId += 1),
  t: now(),
  level: l.level,
  message: l.message,
});
const bumpLogIdFrom = (key: string): void => {
  const entry = readCache<LogLine>(key);
  if (entry !== undefined) logId = entry.items.reduce((mx, l) => Math.max(mx, l.id), logId);
};

/**
 * Generic cached accumulator: seed from the localStorage snapshot (instant paint + skip the
 * server history query while the snapshot is fresh), accumulate the live stream, and persist.
 */
const cachedAccumulator = <A, R>(opts: {
  readonly key: string;
  readonly cap: number;
  readonly live: Stream.Stream<A, never, R>;
  readonly history?: Effect.Effect<ReadonlyArray<A>, never, R>;
}): Stream.Stream<ReadonlyArray<A>, never, R> => {
  const entry = readCache<A>(opts.key);
  const fresh = entry !== undefined && now() - entry.at < FRESH_MS;
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

// bundles are runtime-specific (their atoms close over the runtime), so cache per runtime+tag
const bundleCache = new WeakMap<object, Map<string, QueueBundle>>();
const processBundleCache = new WeakMap<object, Map<string, ProcessBundle>>();
const cacheFor = <V>(map: WeakMap<object, Map<string, V>>, runtime: object): Map<string, V> => {
  let m = map.get(runtime);
  if (m === undefined) {
    m = new Map<string, V>();
    map.set(runtime, m);
  }
  return m;
};

/** Build (once per runtime+tag) the atom bundle for a queue tag. @since 1.0.0 */
export const queueBundle = <R, ER>(runtime: DashboardRuntime<R, ER>, tag: QueueTag<R>): QueueBundle => {
  const cache = cacheFor(bundleCache, runtime);
  const existing = cache.get(tag.id);
  if (existing !== undefined) return existing;

  const statusStream = Stream.unwrap(Effect.map(tag, (q) => q.status));
  const metricsStream = Stream.unwrap(Effect.map(tag, (q) => q.metrics));
  const toPoint = (m: QueueMetrics): MetricPoint => ({
    t: now(),
    throughput: m.throughputPerSec,
    latency: m.avgTotalMillis ?? 0,
  });
  const trendValue = (s: QueueStatus): number => s.sizes.high + s.sizes.normal + s.sizes.low;
  bumpLogIdFrom(`${tag.id}/logs`);

  // Dedup the wire streams: ONE status stream feeds status + trend, ONE metrics stream feeds
  // metrics + history (derived via Atom.mapResult) — keeps concurrent streams under the
  // browser's ~6-connection limit. trend/history seed from the localStorage cache.
  const statusTrend = runtime.atom(
    statusStream.pipe(
      Stream.scan(
        {
          latest: undefined as QueueStatus | undefined,
          trend: readCache<number>(`${tag.id}/trend`)?.items ?? [],
        },
        (acc, s) => ({ latest: s, trend: [...acc.trend, trendValue(s)].slice(-TREND) }),
      ),
      Stream.tap((acc) => Effect.sync(() => writeCache(`${tag.id}/trend`, acc.trend))),
    ),
  );
  const metricsHistory = runtime.atom(
    Stream.concat(
      Stream.unwrap(
        Effect.flatMap(tag, (q) => q.metricsHistory({ limit: HISTORY })).pipe(
          Effect.map((ms) => Stream.fromIterable(ms.map((m): MetricsItem => ({ point: toPoint(m) })))),
        ),
      ),
      metricsStream.pipe(Stream.map((m): MetricsItem => ({ metric: m }))),
    ).pipe(
      Stream.scan(
        {
          latest: undefined as QueueMetrics | undefined,
          history: readCache<MetricPoint>(`${tag.id}/history`)?.items ?? [],
        },
        (acc, item) =>
          "metric" in item
            ? { latest: item.metric, history: [...acc.history, toPoint(item.metric)].slice(-HISTORY) }
            : { latest: acc.latest, history: [...acc.history, item.point].slice(-HISTORY) },
      ),
      Stream.tap((acc) => Effect.sync(() => writeCache(`${tag.id}/history`, acc.history))),
    ),
  );

  const bundle: QueueBundle = {
    status: Atom.mapResult(statusTrend, (a) => a.latest),
    metrics: Atom.mapResult(metricsHistory, (a) => a.latest),
    history: Atom.mapResult(metricsHistory, (a) => a.history),
    trend: Atom.mapResult(statusTrend, (a) => a.trend),
    logs: runtime.atom(
      cachedAccumulator({
        key: `${tag.id}/logs`,
        cap: 300,
        live: Stream.unwrap(Effect.map(tag, (q) => q.logs)).pipe(Stream.map(toLogLine)),
        history: Effect.flatMap(tag, (q) => q.logHistory({ limit: 300 })).pipe(Effect.map((ls) => ls.map(toLogLine))),
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

/** Build (once per runtime+tag) the atom bundle for a process tag. @since 1.0.0 */
export const processBundle = <R, ER>(runtime: DashboardRuntime<R, ER>, tag: ProcessTag<R>): ProcessBundle => {
  const cache = cacheFor(processBundleCache, runtime);
  const existing = cache.get(tag.id);
  if (existing !== undefined) return existing;
  bumpLogIdFrom(`${tag.id}/logs`);
  const bundle: ProcessBundle = {
    status: runtime.atom(Stream.unwrap(Effect.map(tag, (p) => p.status))),
    logs: runtime.atom(
      cachedAccumulator({
        key: `${tag.id}/logs`,
        cap: 300,
        live: Stream.unwrap(Effect.map(tag, (p) => p.logs)).pipe(Stream.map(toLogLine)),
        history: Effect.flatMap(tag, (p) => p.logHistory({ limit: 300 })).pipe(Effect.map((ls) => ls.map(toLogLine))),
      }),
    ),
    start: runtime.fn(() => Effect.flatMap(tag, (p) => p.start)),
    stop: runtime.fn(() => Effect.flatMap(tag, (p) => p.stop)),
    runImmediately: runtime.fn(() => Effect.flatMap(tag, (p) => p.runImmediately)),
  };
  cache.set(tag.id, bundle);
  return bundle;
};

/** Walk a `Group.Tag` tree to its leaf resource tags (queues + processes), raw. @since 1.0.0 */
export const leafTags = (node: GroupNode): ReadonlyArray<unknown> =>
  Object.values(Group.members(node)).flatMap((m) => (Group.isGroup(m) ? leafTags(m as GroupNode) : [m]));

/** Only the queue leaves of a tree. @since 1.0.0 */
export const queueLeaves = (node: GroupNode): ReadonlyArray<QueueTag> =>
  leafTags(node).filter((m) => kindOf(m) === "queue") as ReadonlyArray<QueueTag>;

/** Only the process leaves of a tree. @since 1.0.0 */
export const processLeaves = (node: GroupNode): ReadonlyArray<ProcessTag> =>
  leafTags(node).filter((m) => kindOf(m) === "process") as ReadonlyArray<ProcessTag>;
