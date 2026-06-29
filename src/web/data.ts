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
import { DateTime, Duration, Effect, Layer, type Schema, Stream } from "effect";
import { Atom, type AsyncResult } from "effect/unstable/reactivity";
import { RpcClient } from "effect/unstable/rpc";
import * as Group from "../Group";
import { client, hostOf, kindOf as resourceKindOf, specOf, type HostKey } from "../Resource";
import * as HostStatus from "../HostStatus";
import { kind as queueKind, queueMetrics, queueStatus } from "../QueueContract";
import { kind as processKind, processScheduleEntry, processStatus } from "../ScheduledProcess";
import { kind as apiKind } from "../ApiMetrics";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../ApiUsageSchema";
import { FRESH_MS, readCache, writeCache } from "./cache";
import { now } from "./now";

/** Live queue status (from the contract schema). @since 1.0.0 */
export type QueueStatus = Schema.Schema.Type<typeof queueStatus>;
/** Live queue metrics (from the contract schema). @since 1.0.0 */
export type QueueMetrics = Schema.Schema.Type<typeof queueMetrics>;
/** Live process status (from the contract schema). @since 1.0.0 */
export type ProcessStatus = Schema.Schema.Type<typeof processStatus>;
/** One scheduled run window (from the contract schema): `{ id?, startAt, stopAt? }`. @since 1.0.0 */
export type ScheduleEntry = Schema.Schema.Type<typeof processScheduleEntry>;

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
/** A windowed API-usage sample for the API chart. @since 1.0.0 */
export interface ApiPoint {
  readonly t: number;
  readonly throughput: number;
  readonly errors: number;
  readonly inFlight: number;
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
  readonly schedule: Effect.Effect<ReadonlyArray<ScheduleEntry>>;
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly runImmediately: Effect.Effect<void>;
  readonly setSchedule: (entries: ReadonlyArray<ScheduleEntry>) => Effect.Effect<void>;
  readonly clearSchedule: Effect.Effect<void>;
}
/** The structural shape of an API-metrics resource's live service (read-only). */
interface ApiService {
  readonly metrics: Stream.Stream<ApiUsageMetrics>;
  readonly usageNow: Effect.Effect<ApiUsageSnapshot>;
}

/** A queue tag — yieldable for its live service. Requirement `R` is provided by the runtime. @since 1.0.0 */
export type QueueTag<R = never> = Effect.Effect<QueueService, never, R> & { readonly key: string };
/** A process tag — yieldable for its live service. @since 1.0.0 */
export type ProcessTag<R = never> = Effect.Effect<ProcessService, never, R> & { readonly key: string };
/** An API-metrics tag — yieldable for its live service. @since 1.0.0 */
export type ApiTag<R = never> = Effect.Effect<ApiService, never, R> & { readonly key: string };

/** A node in a `Group.Tag` tree. @since 1.0.0 */
export interface GroupNode {
  readonly key: string;
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
  /** The current schedule entries (run windows), read once on open. @since 1.0.0 */
  readonly schedule: ValueAtom<ReadonlyArray<ScheduleEntry>>;
  readonly start: CommandAtom;
  readonly stop: CommandAtom;
  readonly runImmediately: CommandAtom;
  /** Replace all schedule entries. @since 1.0.0 */
  readonly setSchedule: Atom.AtomResultFn<ReadonlyArray<ScheduleEntry>, void, unknown>;
  /** Remove all schedule entries. @since 1.0.0 */
  readonly clearSchedule: CommandAtom;
}
/** The atoms one host dot/detail needs — its live status (up, readiness rollup, per-resource).
 *  Read-only. @since 1.0.0 */
export interface HostBundle {
  readonly id: string;
  readonly status: ValueAtom<HostStatus.Status | undefined>;
}
/** The atoms one API-metrics card needs — read-only (no commands). @since 1.0.0 */
export interface ApiBundle {
  /** Cumulative usage snapshot (totals + top endpoints), polled. @since 1.0.0 */
  readonly status: ValueAtom<ApiUsageSnapshot | undefined>;
  /** The latest usage window. @since 1.0.0 */
  readonly metrics: ValueAtom<ApiUsageMetrics | undefined>;
  /** Accumulated chart points (throughput / errors / in-flight per window). @since 1.0.0 */
  readonly history: ValueAtom<ReadonlyArray<ApiPoint>>;
}

/** A host that backs one or more of a group's resources — its id (the `Resource.Host` key) plus the
 *  transport key itself. Read straight off the tags (`hostOf`), so the dashboard's host list is the
 *  distinct hosts its resources are bound to — no separate registry. @since 1.0.0 */
export interface HostRef {
  readonly id: string;
  readonly host: HostKey<unknown>;
}

/** Walk a group tree and collect the distinct hosts its resources are bound to. A hostless
 *  (local/in-process) group yields `[]` — host dots appear only when resources name a host. @since 1.0.0 */
export const hostsOf = (group: unknown): ReadonlyArray<HostRef> => {
  const seen = new Map<string, HostRef>();
  const walk = (node: unknown): void => {
    if (Group.isGroup(node)) {
      for (const member of Object.values(Group.members(node))) walk(member);
      return;
    }
    const host = hostOf(node);
    if (host !== undefined && !seen.has(host.key)) {
      seen.set(host.key, { id: host.key, host });
    }
  };
  walk(group);
  return [...seen.values()];
};

/** Which kind of leaf a tag is — by the contract's stamped kind. @since 1.0.0 */
export const kindOf = (member: unknown): "queue" | "process" | "api" => {
  // Prefer the contract's stamped kind (set by each `.Tag` factory); fall back to sniffing the spec
  // for a bare `Resource.Tag` (or an older tag without a stamped kind).
  const stamped = resourceKindOf(member);
  if (stamped === queueKind) return "queue";
  if (stamped === processKind) return "process";
  if (stamped === apiKind) return "api";
  const spec = specOf(member as Parameters<typeof specOf>[0]);
  return "enqueue" in spec || "sizes" in spec ? "queue" : "process";
};

// one combined metrics stream carries both backfill points and live raw metrics
type MetricsItem = { readonly point: MetricPoint } | { readonly metric: QueueMetrics };

// Retain a deep metrics history (server keeps up to ~10k) so the chart's time-window control can
// show real backfill up to ~1 hour; the localStorage cache keeps only a small recent slice for
// instant first paint (the server query refills the rest, since the metrics atom always backfills).
const HISTORY = 1800;
const HISTORY_CACHE = 120;
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
const apiBundleCache = new WeakMap<object, Map<string, ApiBundle>>();
const hostBundleCache = new WeakMap<object, Map<string, HostBundle>>();
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
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;

  const statusStream = Stream.unwrap(Effect.map(tag, (q) => q.status));
  const metricsStream = Stream.unwrap(Effect.map(tag, (q) => q.metrics));
  // Stamp the point with the metric's own window-end (real server time), not the client's receive
  // time — so backfilled points land at their true position on the time axis (the window filter).
  const toPoint = (m: QueueMetrics): MetricPoint => ({
    t: DateTime.toEpochMillis(m.windowEnd),
    throughput: m.throughputPerSec,
    latency: m.avgTotalMillis ?? 0,
  });
  const trendValue = (s: QueueStatus): number => s.sizes.high + s.sizes.normal + s.sizes.low;
  bumpLogIdFrom(`${tag.key}/logs`);

  // Dedup the wire streams: ONE status stream feeds status + trend, ONE metrics stream feeds
  // metrics + history (derived via Atom.mapResult) — keeps concurrent streams under the
  // browser's ~6-connection limit. trend/history seed from the localStorage cache.
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
        Effect.flatMap(tag, (q) => q.metricsHistory({ limit: HISTORY })).pipe(
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
      Stream.tap((acc) =>
        Effect.sync(() => writeCache(`${tag.key}/history`, acc.history.slice(-HISTORY_CACHE))),
      ),
    ),
  );

  const bundle: QueueBundle = {
    status: Atom.mapResult(statusTrend, (a) => a.latest),
    metrics: Atom.mapResult(metricsHistory, (a) => a.latest),
    history: Atom.mapResult(metricsHistory, (a) => a.history),
    trend: Atom.mapResult(statusTrend, (a) => a.trend),
    logs: runtime.atom(
      cachedAccumulator({
        key: `${tag.key}/logs`,
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
  cache.set(tag.key, bundle);
  return bundle;
};

/** Build (once per runtime+tag) the atom bundle for a process tag. @since 1.0.0 */
export const processBundle = <R, ER>(runtime: DashboardRuntime<R, ER>, tag: ProcessTag<R>): ProcessBundle => {
  const cache = cacheFor(processBundleCache, runtime);
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;
  bumpLogIdFrom(`${tag.key}/logs`);
  const bundle: ProcessBundle = {
    status: runtime.atom(Stream.unwrap(Effect.map(tag, (p) => p.status))),
    logs: runtime.atom(
      cachedAccumulator({
        key: `${tag.key}/logs`,
        cap: 300,
        live: Stream.unwrap(Effect.map(tag, (p) => p.logs)).pipe(Stream.map(toLogLine)),
        history: Effect.flatMap(tag, (p) => p.logHistory({ limit: 300 })).pipe(Effect.map((ls) => ls.map(toLogLine))),
      }),
    ),
    // Poll the schedule so a read-only inline view reflects edits made on the fullscreen page (and
    // any external changes) — the contract exposes `schedule` as a query, not a live stream.
    schedule: runtime.atom(
      Stream.tick(Duration.seconds(3)).pipe(Stream.mapEffect(() => Effect.flatMap(tag, (p) => p.schedule))),
    ),
    start: runtime.fn(() => Effect.flatMap(tag, (p) => p.start)),
    stop: runtime.fn(() => Effect.flatMap(tag, (p) => p.stop)),
    runImmediately: runtime.fn(() => Effect.flatMap(tag, (p) => p.runImmediately)),
    setSchedule: runtime.fn((entries: ReadonlyArray<ScheduleEntry>) =>
      Effect.flatMap(tag, (p) => p.setSchedule(entries)),
    ),
    clearSchedule: runtime.fn(() => Effect.flatMap(tag, (p) => p.clearSchedule)),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

/** Build (once per runtime+tag) the atom bundle for an API-metrics tag — read-only. @since 1.0.0 */
export const apiBundle = <R, ER>(runtime: DashboardRuntime<R, ER>, tag: ApiTag<R>): ApiBundle => {
  const cache = cacheFor(apiBundleCache, runtime);
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;
  const toApiPoint = (m: ApiUsageMetrics): ApiPoint => ({
    t: DateTime.toEpochMillis(m.windowEnd),
    throughput: m.throughputPerSec,
    errors: m.errors,
    inFlight: m.inFlight,
  });
  // One metrics stream feeds the latest window + the accumulated chart history (no server backfill
  // for API — there's no history query — so seed from the localStorage cache and accumulate live).
  const metricsHistory = runtime.atom(
    Stream.unwrap(Effect.map(tag, (a) => a.metrics)).pipe(
      Stream.scan(
        {
          latest: undefined as ApiUsageMetrics | undefined,
          history: readCache<ApiPoint>(`${tag.key}/api-history`)?.items ?? [],
        },
        (acc, m) => ({ latest: m, history: [...acc.history, toApiPoint(m)].slice(-HISTORY) }),
      ),
      Stream.tap((acc) =>
        Effect.sync(() => writeCache(`${tag.key}/api-history`, acc.history.slice(-HISTORY_CACHE))),
      ),
    ),
  );
  const bundle: ApiBundle = {
    // usageNow is a query (not a stream), so poll it for a live-ish snapshot.
    status: runtime.atom(
      Stream.tick(Duration.seconds(3)).pipe(Stream.mapEffect(() => Effect.flatMap(tag, (a) => a.usageNow))),
    ),
    metrics: Atom.mapResult(metricsHistory, (a) => a.latest),
    history: Atom.mapResult(metricsHistory, (a) => a.history),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

// A HostStatus client over a specific host's transport: a HostKey's *value* is the RPC `Protocol`,
// so provide it as the ambient `RpcClient.Protocol`. The tag-walk (`hostsOf`) erases the host's
// identity, and the runtime supplies its transport via `connect`, so we restate the resolved
// requirement — the same contained boundary assertion `Resource.client` makes for host-bearing tags.
const hostStatusClient = (host: HostKey<unknown>) =>
  client(HostStatus.Tag).pipe(
    Layer.provide(Layer.effect(RpcClient.Protocol, host as HostKey<never>)),
  );

/** Build (once per runtime+host) the atom bundle for a host's live status — read straight from the
 *  reserved `HostStatus` resource over that host's transport. @since 1.0.0 */
export const hostStatusBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  ref: HostRef,
): HostBundle => {
  const cache = cacheFor(hostBundleCache, runtime);
  const existing = cache.get(ref.id);
  if (existing !== undefined) return existing;
  const bundle: HostBundle = {
    id: ref.id,
    status: runtime.atom(
      Stream.unwrap(
        Effect.map(HostStatus.Tag, (h) => h.status).pipe(
          // The atom owns this per-host client's scope (it lives as long as the atom is mounted),
          // so providing it here is the entry point — not a mid-pipeline provide that leaks scope.
          // @effect-diagnostics-next-line strictEffectProvide:off
          Effect.provide(hostStatusClient(ref.host)),
        ),
      ),
    ),
  };
  cache.set(ref.id, bundle);
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
