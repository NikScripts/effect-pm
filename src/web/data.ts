/**
 * @module web/data
 *
 * Tag-driven data layer for the dashboard. Each resource **tag** is the source of truth;
 * `queueBundle` / `processBundle` build the atom bundle the widgets read (status /
 * metrics+history / trend / logs + controls) straight from the tag's live service over the
 * consumer's reactive `runtime` (an `Atom.runtime(layer)` that provides the tags — local
 * engine or `Hyperlink.client` over http; the widgets don't care which).
 *
 */
import { DateTime, Duration, Effect, Option, type Schema, Stream } from "effect";
import { Atom, type AsyncResult } from "effect/unstable/reactivity";
import * as Group from "../Group";
import { client, nodeOf, kindOf as hyperlinkKindOf, type Subscribable } from "../Hyperlink";
import type { NodeKey } from "../Node";
import * as LogEntry from "../LogEntry";
import * as NodeStatus from "../NodeStatus";
import { kind as queueKind, queueMetrics, queueStatus } from "../QueueHyperlink";
import { kind as customQueueKind, customQueueStatus } from "../CustomQueueHyperlink";
import { kind as fleetHealthKind, type FleetStatus, type NodeReport } from "../FleetHealth";
import { kind as telemetryKind, MetricsSnapshot, type MetricDatum } from "../Telemetry";
import { kind as shardMapKind } from "../ShardMap";
import { kind as runKind, type RunGateStatus } from "../RunHyperlink";
import { kind as processKind, processScheduleEntry, processStatus } from "../Process";
import { kind as apiKind } from "../ApiMetrics";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../ApiUsageSchema";
import { FRESH_MS, readCache, writeCache } from "./cache";
import { now } from "./now";

/** Live queue status (from the contract schema). */
export type QueueStatus = Schema.Schema.Type<typeof queueStatus>;
/** A custom-queue's live status — like a queue's, but `sizes` is a **named-lane** record (not the
 *  fixed high/normal/low), and `phase` is `running | draining | off`. @public */
export type CustomQueueStatus = Schema.Schema.Type<typeof customQueueStatus>;
/** Live queue metrics (from the contract schema). */
export type QueueMetrics = Schema.Schema.Type<typeof queueMetrics>;
/** Live process status (from the contract schema). */
export type ProcessStatus = Schema.Schema.Type<typeof processStatus>;
/** One scheduled run window (from the contract schema): `{ id?, startAt, stopAt? }`. */
export type ScheduleEntry = Schema.Schema.Type<typeof processScheduleEntry>;

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
/** A windowed API-usage sample for the API chart. */
export interface ApiPoint {
  readonly t: number;
  readonly throughput: number;
  readonly errors: number;
  readonly inFlight: number;
}

/** The structural shape of a queue's live service the widgets consume. `status`/`size`/`isEmpty` are
 *  reactive `ref`s (`Subscribable`: `.get` / `.changes`); `metrics`/`logs` are `{ stream, query }`. */
interface QueueService {
  readonly status: Subscribable<QueueStatus>;
  readonly size: Subscribable<number>;
  readonly isEmpty: Subscribable<boolean>;
  readonly metrics: {
    readonly stream: Stream.Stream<QueueMetrics>;
    readonly query: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<QueueMetrics>>;
  };
  readonly logs: {
    readonly stream: Stream.Stream<{ readonly level: string; readonly message: string }>;
    readonly query: (o: {
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<{ readonly level: string; readonly message: string }>>;
  };
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
}
/** A reactive `ref` field on the wire: read once (`get`) or subscribe (`changes`). */
interface RefLike<A> {
  readonly get: Effect.Effect<A>;
  readonly changes: Stream.Stream<A>;
}
/** The structural shape of a process's live service (the base `Process.Tag` contract). The inline
 *  `schedule` verb group is present only on a process that owns an inline schedule
 *  (`Process.schedule([...])`), so it is optional here. */
interface ProcessService {
  readonly status: RefLike<ProcessStatus>;
  readonly logs: {
    readonly stream: Stream.Stream<{ readonly level: string; readonly message: string }>;
    readonly query: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<{ readonly level: string; readonly message: string }>>;
  };
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly run: Effect.Effect<void>;
  readonly schedule?: {
    readonly entries: RefLike<ReadonlyArray<ScheduleEntry>>;
    readonly set: (entries: ReadonlyArray<ScheduleEntry>) => Effect.Effect<void>;
    readonly add: (entry: ScheduleEntry) => Effect.Effect<void>;
    readonly clear: Effect.Effect<void>;
  };
}
/** The structural shape of an API-metrics resource's live service (read-only). */
interface ApiService {
  readonly metrics: Stream.Stream<ApiUsageMetrics>;
  readonly usage: Subscribable<ApiUsageSnapshot>;
}

/** The structural shape of a **custom** queue's live service — like {@link QueueService} but with a
 *  named-lane `status`, an extra `levelSizes`, and a `start` command. Metrics/logs are identical. */
interface CustomQueueService {
  readonly status: Subscribable<CustomQueueStatus>;
  readonly size: Subscribable<number>;
  readonly isEmpty: Subscribable<boolean>;
  readonly levelSizes: Effect.Effect<ReadonlyArray<number>>;
  readonly metrics: {
    readonly stream: Stream.Stream<QueueMetrics>;
    readonly query: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<QueueMetrics>>;
  };
  readonly logs: {
    readonly stream: Stream.Stream<{ readonly level: string; readonly message: string }>;
    readonly query: (o: {
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<{ readonly level: string; readonly message: string }>>;
  };
  readonly start: Effect.Effect<void>;
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
}

/** A queue tag — yieldable for its live service. Requirement `R` is provided by the runtime. */
export type QueueTag<R = never> = Effect.Effect<QueueService, never, R> & { readonly key: string };
/** A custom-queue tag — yieldable for its live service. @public */
export type CustomQueueTag<R = never> = Effect.Effect<CustomQueueService, never, R> & { readonly key: string };

/** The structural shape of a **fleet-health** resource's live service — a per-node health map + a
 *  rollup status, both `fleet` effect fields (read-once, polled — no reactive ref). */
interface FleetHealthService {
  readonly byNode: Effect.Effect<Record<string, NodeReport>>;
  readonly status: Effect.Effect<FleetStatus>;
}
/** A fleet-health tag — yieldable for its live service. @public */
export type FleetHealthTag<R = never> = Effect.Effect<FleetHealthService, never, R> & { readonly key: string };

/** The structural shape of a **telemetry** resource's live service — this node's metric `snapshot`
 *  (leaf) plus the fleet folds `inFlightByNode` / `fleetInFlight`. All effect fields (polled). */
interface TelemetryService {
  readonly snapshot: Effect.Effect<typeof MetricsSnapshot.Type>;
  readonly inFlightByNode: Effect.Effect<Record<string, number>>;
  readonly fleetInFlight: Effect.Effect<number>;
}
/** A telemetry tag — yieldable for its live service. @public */
export type TelemetryTag<R = never> = Effect.Effect<TelemetryService, never, R> & { readonly key: string };

/** The structural shape of a **shard-map** resource's live service — `sizeLocal` (this node's entry
 *  count, leaf) plus the fleet folds `sizeByNode` / `size`. All effect fields (polled). */
interface ShardMapService {
  readonly sizeLocal: Effect.Effect<number>;
  readonly sizeByNode: Effect.Effect<Readonly<Record<string, number>>>;
  readonly size: Effect.Effect<number>;
}
/** A shard-map tag — yieldable for its live service. @public */
export type ShardMapTag<R = never> = Effect.Effect<ShardMapService, never, R> & { readonly key: string };

/** The structural shape of a **run-gate** resource's live service — a reactive `status` ref carrying
 *  the live concurrency counters (waiting / in-flight / completed / failed / interrupted / duration). */
interface RunService {
  readonly status: Subscribable<RunGateStatus>;
}
/** A run-gate tag — yieldable for its live service. @public */
export type RunTag<R = never> = Effect.Effect<RunService, never, R> & { readonly key: string };
/** A process tag — yieldable for its live service. */
export type ProcessTag<R = never> = Effect.Effect<ProcessService, never, R> & { readonly key: string };
/** An API-metrics tag — yieldable for its live service. */
export type ApiTag<R = never> = Effect.Effect<ApiService, never, R> & { readonly key: string };

/** A node in a `Group.Tag` tree. */
export interface GroupNode {
  readonly key: string;
  readonly members: Record<string, unknown>;
}

/** A read/stream value atom (error channel erased — widgets only read success). */
export type ValueAtom<A> = Atom.Atom<AsyncResult.AsyncResult<A, unknown>>;
/** A no-arg command trigger. */
export type CommandAtom = Atom.AtomResultFn<void, unknown, unknown>;

/** Any reactive runtime that provides the dashboard's tags. */
export type DashboardRuntime<R = never, ER = never> = Atom.AtomRuntime<R, ER>;

/** The atoms + controls one queue card needs — all derived from the tag. */
export interface QueueBundle {
  readonly status: ValueAtom<Option.Option<QueueStatus>>;
  readonly metrics: ValueAtom<Option.Option<QueueMetrics>>;
  readonly history: ValueAtom<ReadonlyArray<MetricPoint>>;
  readonly trend: ValueAtom<ReadonlyArray<number>>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  readonly pause: CommandAtom;
  readonly resume: CommandAtom;
  readonly clear: CommandAtom;
  readonly shutdown: CommandAtom;
}
/** The atoms + controls one **custom-queue** card needs — like {@link QueueBundle} (named-lane status)
 *  plus a `start` command. @public */
export interface CustomQueueBundle {
  readonly status: ValueAtom<Option.Option<CustomQueueStatus>>;
  readonly metrics: ValueAtom<Option.Option<QueueMetrics>>;
  readonly history: ValueAtom<ReadonlyArray<MetricPoint>>;
  readonly trend: ValueAtom<ReadonlyArray<number>>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  readonly start: CommandAtom;
  readonly pause: CommandAtom;
  readonly resume: CommandAtom;
  readonly clear: CommandAtom;
  readonly shutdown: CommandAtom;
}
/** The atoms one **fleet-health** card needs — a polled per-node health map + rollup status. @public */
export interface FleetHealthBundle {
  readonly byNode: ValueAtom<Record<string, NodeReport>>;
  readonly status: ValueAtom<FleetStatus>;
}
/** The atoms one **telemetry** card needs — the polled fleet in-flight total + per-node map, plus this
 *  node's metric count (from the snapshot). Read-only. @public */
export interface TelemetryBundle {
  readonly metricCount: ValueAtom<number>;
  readonly inFlightByNode: ValueAtom<Record<string, number>>;
  readonly fleetInFlight: ValueAtom<number>;
  /** This node's full metric registry (id + kind + reading) — the detail page's per-metric list. */
  readonly metrics: ValueAtom<ReadonlyArray<MetricDatum>>;
}
/** The atoms one **shard-map** card needs — polled fleet size total + per-node entry map + this node's
 *  local count. Read-only. @public */
export interface ShardMapBundle {
  readonly size: ValueAtom<number>;
  readonly sizeByNode: ValueAtom<Record<string, number>>;
  readonly sizeLocal: ValueAtom<number>;
}
/** The atoms one **run-gate** card needs — the live status (concurrency counters) streamed from the
 *  reactive `status` ref. Read-only. @public */
export interface RunBundle {
  readonly status: ValueAtom<RunGateStatus>;
}
/** The atoms + controls one process card needs — derived from the tag. */
export interface ProcessBundle {
  readonly status: ValueAtom<ProcessStatus>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  /** The current schedule entries (run windows), read once on open. */
  readonly schedule: ValueAtom<ReadonlyArray<ScheduleEntry>>;
  readonly start: CommandAtom;
  readonly stop: CommandAtom;
  readonly run: CommandAtom;
  /** Replace all schedule entries. */
  readonly setSchedule: Atom.AtomResultFn<ReadonlyArray<ScheduleEntry>, void, unknown>;
  /** Remove all schedule entries. */
  readonly clearSchedule: CommandAtom;
}
/** The atoms one node dot/detail needs — its live status (up, readiness rollup, per-resource).
 *  Read-only. */
export interface NodeBundle {
  readonly id: string;
  readonly status: ValueAtom<NodeStatus.Status>;
  /** The node's runtime-wide log stream (recent tail, then live). */
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  /** Ready-resource count over time (one point per status tick) — a readiness sparkline that dips
   *  when a resource (or its dependency) degrades. */
  readonly health: ValueAtom<ReadonlyArray<number>>;
}
/** The atoms one API-metrics card needs — read-only (no commands). */
export interface ApiBundle {
  /** Cumulative usage snapshot (totals + top endpoints), via `usage.changes`. */
  readonly status: ValueAtom<ApiUsageSnapshot>;
  /** The latest usage window. */
  readonly metrics: ValueAtom<Option.Option<ApiUsageMetrics>>;
  /** Accumulated chart points (throughput / errors / in-flight per window). */
  readonly history: ValueAtom<ReadonlyArray<ApiPoint>>;
}

/** A node that backs one or more of a group's resources — its id (the `Node.Tag` key) plus the
 *  transport key itself. Read straight off the tags (`nodeOf`), so the dashboard's node list is the
 *  distinct nodes its resources are bound to — no separate registry. */
export interface NodeRef {
  readonly id: string;
  readonly node: NodeKey<unknown>;
}

/** Walk a group tree and collect the distinct nodes its resources are bound to. A nodeless
 *  (local/in-process) group yields `[]` — node dots appear only when resources name a node. */
export const nodesOf = (group: unknown): ReadonlyArray<NodeRef> => {
  const seen = new Map<string, NodeRef>();
  const walk = (member: unknown): void => {
    if (Group.isGroup(member)) {
      for (const child of Object.values(Group.members(member))) walk(child);
      return;
    }
    const node = nodeOf(member);
    if (node !== undefined && !seen.has(node.key)) {
      seen.set(node.key, { id: node.key, node });
    }
  };
  walk(group);
  return [...seen.values()];
};

/** A tag's wire identity (its `groupId`, falling back to `key`) — what a node's `NodeStatus`
 *  reports for each served resource. */
export const tagWireKey = (member: unknown): string | undefined => {
  if ((typeof member !== "object" && typeof member !== "function") || member === null) {
    return undefined;
  }
  if ("groupId" in member && typeof member.groupId === "string") return member.groupId;
  if ("key" in member && typeof member.key === "string") return member.key;
  return undefined;
};

/** The {@link NodeRef} a resource tag is bound to (its `Node.Tag`), or `undefined` for a nodeless
 *  tag — lets a resource page read its own readiness from its node's `NodeStatus`. */
export const resourceNodeRef = (tag: unknown): NodeRef | undefined => {
  const node = nodeOf(tag);
  return node === undefined ? undefined : { id: node.key, node };
};

/** The leaf resource tag in a group tree whose wire key is `key` (as reported by a node's
 *  `NodeStatus.resources[].key`), or `undefined` if not found. Lets the node page open a served
 *  resource's detail directly (without round-tripping through the group route). */
export const leafByKey = (group: unknown, key: string): unknown => {
  const walk = (node: unknown): unknown => {
    if (!Group.isGroup(node)) return undefined;
    for (const member of Object.values(Group.members(node))) {
      if (Group.isGroup(member)) {
        const found = walk(member);
        if (found !== undefined) return found;
      } else if (tagWireKey(member) === key) {
        return member;
      }
    }
    return undefined;
  };
  return walk(group);
};

/** Which kind of leaf a tag is — purely by its **stamped** kind (every tag carries one; a bare
 *  `Hyperlink.Tag` is `"resource"`). No spec-sniffing: the kind key is the single source of truth. */
export const kindOf = (member: unknown): "queue" | "process" | "api" | "hyperlink" => {
  const stamped = hyperlinkKindOf(member);
  if (stamped === queueKind) return "queue";
  if (stamped === processKind) return "process";
  if (stamped === apiKind) return "api";
  return "hyperlink";
};

/** Group-member type-guards, keyed off the same stamped `kind` as {@link kindOf}. @public */
export const isQueueTag = (m: unknown): m is QueueTag => kindOf(m) === "queue";
/** @public */
export const isProcessTag = (m: unknown): m is ProcessTag => kindOf(m) === "process";
/** @public */
export const isApiTag = (m: unknown): m is ApiTag => kindOf(m) === "api";
/** Custom-queue guard — its own stamped kind (not folded into {@link kindOf}, which stays the four
 *  primary kinds; a custom queue dispatches by its exact kind key). @public */
export const isCustomQueueTag = (m: unknown): m is CustomQueueTag =>
  hyperlinkKindOf(m) === customQueueKind;
/** Fleet-health guard — its own stamped kind (a mesh factory, dispatched by exact kind key). @public */
export const isFleetHealthTag = (m: unknown): m is FleetHealthTag =>
  hyperlinkKindOf(m) === fleetHealthKind;
/** Telemetry guard — its own stamped kind (a mesh factory, dispatched by exact kind key). @public */
export const isTelemetryTag = (m: unknown): m is TelemetryTag =>
  hyperlinkKindOf(m) === telemetryKind;
/** Shard-map guard — its own stamped kind (a mesh factory, dispatched by exact kind key). @public */
export const isShardMapTag = (m: unknown): m is ShardMapTag =>
  hyperlinkKindOf(m) === shardMapKind;
/** Run-gate guard — its own stamped kind (dispatched by exact kind key). @public */
export const isRunTag = (m: unknown): m is RunTag =>
  hyperlinkKindOf(m) === runKind;

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
  readonly stream: Stream.Stream<A, never, R>;
  readonly query?: Effect.Effect<ReadonlyArray<A>, never, R>;
}): Stream.Stream<ReadonlyArray<A>, never, R> => {
  const entry = readCache<A>(opts.key);
  const fresh = entry !== undefined && now() - entry.at < FRESH_MS;
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

// bundles are runtime-specific (their atoms close over the runtime), so cache per runtime+tag
const bundleCache = new WeakMap<object, Map<string, QueueBundle>>();
const processBundleCache = new WeakMap<object, Map<string, ProcessBundle>>();
const apiBundleCache = new WeakMap<object, Map<string, ApiBundle>>();
const nodeBundleCache = new WeakMap<object, Map<string, NodeBundle>>();
const cacheFor = <V>(map: WeakMap<object, Map<string, V>>, runtime: object): Map<string, V> => {
  let m = map.get(runtime);
  if (m === undefined) {
    m = new Map<string, V>();
    map.set(runtime, m);
  }
  return m;
};

const hyperlinkLogsAtom = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  resourceKey: string,
  node: NodeKey<unknown>,
) =>
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
    }).pipe(Stream.provide(nodeStatusClient(node))),
  );

/** Build (once per runtime+tag) the atom bundle for a queue tag. */
export const queueBundle = <R, ER>(runtime: DashboardRuntime<R, ER>, tag: QueueTag<R>): QueueBundle => {
  const cache = cacheFor(bundleCache, runtime);
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;

  const node = nodeOf(tag);
  if (node === undefined) {
    throw new Error(`queue tag ${tag.key} is missing a node`);
  }

  // `status` is a reactive `ref` — subscribe via `.changes`; `metrics` is nested `{ stream, query }`.
  const statusStream = Stream.unwrap(
    Effect.map(tag, (q) => q.status.changes),
  );
  const metricsStream = Stream.unwrap(Effect.map(tag, (q) => q.metrics.stream));
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
          latest: Option.none<QueueStatus>(),
          trend: readCache<number>(`${tag.key}/trend`)?.items ?? [],
        },
        (acc, s) => ({ latest: Option.some(s), trend: [...acc.trend, trendValue(s)].slice(-TREND) }),
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
          latest: Option.none<QueueMetrics>(),
          history: readCache<MetricPoint>(`${tag.key}/history`)?.items ?? [],
        },
        (acc, item) =>
          "metric" in item
            ? { latest: Option.some(item.metric), history: [...acc.history, toPoint(item.metric)].slice(-HISTORY) }
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
    logs: hyperlinkLogsAtom(runtime, tag.key, node),
    pause: runtime.fn(() => Effect.flatMap(tag, (q) => q.pause)),
    resume: runtime.fn(() => Effect.flatMap(tag, (q) => q.resume)),
    clear: runtime.fn(() => Effect.flatMap(tag, (q) => q.clear)),
    shutdown: runtime.fn(() => Effect.flatMap(tag, (q) => q.shutdown)),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

const customQueueBundleCache = new WeakMap<object, Map<string, CustomQueueBundle>>();

/** Build (once per runtime+tag) the atom bundle for a **custom-queue** tag — the {@link queueBundle}
 *  parallel: same metrics/logs wire, a named-lane status, and a `start` command. @public */
export const customQueueBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: CustomQueueTag<R>,
): CustomQueueBundle => {
  const cache = cacheFor(customQueueBundleCache, runtime);
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;

  const node = nodeOf(tag);
  if (node === undefined) {
    throw new Error(`custom-queue tag ${tag.key} is missing a node`);
  }

  const statusStream = Stream.unwrap(Effect.map(tag, (q) => q.status.changes));
  const metricsStream = Stream.unwrap(Effect.map(tag, (q) => q.metrics.stream));
  const toPoint = (m: QueueMetrics): MetricPoint => ({
    t: DateTime.toEpochMillis(m.windowEnd),
    throughput: m.throughputPerSec,
    latency: m.avgTotalMillis ?? 0,
  });
  // total pending across all named lanes (the fixed high/normal/low sum has no meaning here)
  const trendValue = (s: CustomQueueStatus): number =>
    Object.values(s.sizes).reduce((sum, n) => sum + n, 0);
  bumpLogIdFrom(`${tag.key}/logs`);

  const statusTrend = runtime.atom(
    statusStream.pipe(
      Stream.scan(
        {
          latest: Option.none<CustomQueueStatus>(),
          trend: readCache<number>(`${tag.key}/trend`)?.items ?? [],
        },
        (acc, s) => ({ latest: Option.some(s), trend: [...acc.trend, trendValue(s)].slice(-TREND) }),
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
          latest: Option.none<QueueMetrics>(),
          history: readCache<MetricPoint>(`${tag.key}/history`)?.items ?? [],
        },
        (acc, item) =>
          "metric" in item
            ? { latest: Option.some(item.metric), history: [...acc.history, toPoint(item.metric)].slice(-HISTORY) }
            : { latest: acc.latest, history: [...acc.history, item.point].slice(-HISTORY) },
      ),
      Stream.tap((acc) =>
        Effect.sync(() => writeCache(`${tag.key}/history`, acc.history.slice(-HISTORY_CACHE))),
      ),
    ),
  );

  const bundle: CustomQueueBundle = {
    status: Atom.mapResult(statusTrend, (a) => a.latest),
    metrics: Atom.mapResult(metricsHistory, (a) => a.latest),
    history: Atom.mapResult(metricsHistory, (a) => a.history),
    trend: Atom.mapResult(statusTrend, (a) => a.trend),
    logs: hyperlinkLogsAtom(runtime, tag.key, node),
    start: runtime.fn(() => Effect.flatMap(tag, (q) => q.start)),
    pause: runtime.fn(() => Effect.flatMap(tag, (q) => q.pause)),
    resume: runtime.fn(() => Effect.flatMap(tag, (q) => q.resume)),
    clear: runtime.fn(() => Effect.flatMap(tag, (q) => q.clear)),
    shutdown: runtime.fn(() => Effect.flatMap(tag, (q) => q.shutdown)),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

const fleetHealthBundleCache = new WeakMap<object, Map<string, FleetHealthBundle>>();

/** Build (once per runtime+tag) the atom bundle for a **fleet-health** tag. `byNode` / `status` are
 *  `fleet` effect fields (a server-side peer fold, no reactive ref), so they're **polled** on a tick —
 *  the first read fires immediately, then every ~2s. @public */
export const fleetHealthBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: FleetHealthTag<R>,
): FleetHealthBundle => {
  const cache = cacheFor(fleetHealthBundleCache, runtime);
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;

  const read = Effect.flatMap(tag, (h) => Effect.all({ byNode: h.byNode, status: h.status }));
  const poll = runtime.atom(
    Stream.fromEffect(read).pipe(
      Stream.concat(Stream.tick(Duration.seconds(2)).pipe(Stream.mapEffect(() => read))),
    ),
  );
  const bundle: FleetHealthBundle = {
    byNode: Atom.mapResult(poll, (a) => a.byNode),
    status: Atom.mapResult(poll, (a) => a.status),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

const telemetryBundleCache = new WeakMap<object, Map<string, TelemetryBundle>>();

/** Build (once per runtime+tag) the atom bundle for a **telemetry** tag. `snapshot` (leaf) +
 *  `inFlightByNode` / `fleetInFlight` (fleet folds) are effect fields — **polled** on a tick (first
 *  read immediate, then ~2s). @public */
export const telemetryBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: TelemetryTag<R>,
): TelemetryBundle => {
  const cache = cacheFor(telemetryBundleCache, runtime);
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;

  const read = Effect.flatMap(tag, (t) =>
    Effect.all({ snapshot: t.snapshot, inFlightByNode: t.inFlightByNode, fleetInFlight: t.fleetInFlight }),
  );
  const poll = runtime.atom(
    Stream.fromEffect(read).pipe(
      Stream.concat(Stream.tick(Duration.seconds(2)).pipe(Stream.mapEffect(() => read))),
    ),
  );
  const bundle: TelemetryBundle = {
    metricCount: Atom.mapResult(poll, (a) => a.snapshot.metrics.length),
    inFlightByNode: Atom.mapResult(poll, (a) => a.inFlightByNode),
    fleetInFlight: Atom.mapResult(poll, (a) => a.fleetInFlight),
    metrics: Atom.mapResult(poll, (a) => a.snapshot.metrics),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

const shardMapBundleCache = new WeakMap<object, Map<string, ShardMapBundle>>();

/** Build (once per runtime+tag) the atom bundle for a **shard-map** tag. `size` / `sizeByNode` (fleet
 *  folds) + `sizeLocal` (leaf) are effect fields — **polled** on a tick (first read immediate, then
 *  ~2s). @public */
export const shardMapBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: ShardMapTag<R>,
): ShardMapBundle => {
  const cache = cacheFor(shardMapBundleCache, runtime);
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;

  const read = Effect.flatMap(tag, (m) =>
    Effect.all({ size: m.size, sizeByNode: m.sizeByNode, sizeLocal: m.sizeLocal }),
  );
  const poll = runtime.atom(
    Stream.fromEffect(read).pipe(
      Stream.concat(Stream.tick(Duration.seconds(2)).pipe(Stream.mapEffect(() => read))),
    ),
  );
  const bundle: ShardMapBundle = {
    size: Atom.mapResult(poll, (a) => a.size),
    sizeByNode: Atom.mapResult(poll, (a) => ({ ...a.sizeByNode })),
    sizeLocal: Atom.mapResult(poll, (a) => a.sizeLocal),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

const runBundleCache = new WeakMap<object, Map<string, RunBundle>>();

/** Build (once per runtime+tag) the atom bundle for a **run-gate** tag — subscribes to the reactive
 *  `status` ref (streamed, like the queue/process cards). @public */
export const runBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: RunTag<R>,
): RunBundle => {
  const cache = cacheFor(runBundleCache, runtime);
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;

  const bundle: RunBundle = {
    status: runtime.atom(Stream.unwrap(Effect.map(tag, (r) => r.status.changes))),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

/** Build (once per runtime+tag) the atom bundle for a process tag. */
export const processBundle = <R, ER>(runtime: DashboardRuntime<R, ER>, tag: ProcessTag<R>): ProcessBundle => {
  const cache = cacheFor(processBundleCache, runtime);
  const existing = cache.get(tag.key);
  if (existing !== undefined) return existing;
  const node = nodeOf(tag);
  if (node === undefined) {
    throw new Error(`process tag ${tag.key} is missing a node`);
  }
  bumpLogIdFrom(`${tag.key}/logs`);
  // The inline `schedule` group is optional (only processes that own an inline schedule have it),
  // so the schedule read/mutations degrade to empty / no-op when a process is schedule-less.
  const scheduleEntries = Effect.flatMap(tag, (p) =>
    p.schedule === undefined
      ? Effect.succeed<ReadonlyArray<ScheduleEntry>>([])
      : p.schedule.entries.get,
  );
  const bundle: ProcessBundle = {
    status: runtime.atom(Stream.unwrap(Effect.map(tag, (p) => p.status.changes))),
    logs: hyperlinkLogsAtom(runtime, tag.key, node),
    // Poll the schedule so a read-only inline view reflects edits made on the fullscreen page (and
    // any external changes) — the contract exposes `schedule.entries` as a reactive ref, read here.
    schedule: runtime.atom(
      Stream.tick(Duration.seconds(3)).pipe(Stream.mapEffect(() => scheduleEntries)),
    ),
    start: runtime.fn(() => Effect.flatMap(tag, (p) => p.start)),
    stop: runtime.fn(() => Effect.flatMap(tag, (p) => p.stop)),
    run: runtime.fn(() => Effect.flatMap(tag, (p) => p.run)),
    setSchedule: runtime.fn((entries: ReadonlyArray<ScheduleEntry>) =>
      Effect.flatMap(tag, (p) => (p.schedule === undefined ? Effect.void : p.schedule.set(entries))),
    ),
    clearSchedule: runtime.fn(() => Effect.flatMap(tag, (p) => (p.schedule === undefined ? Effect.void : p.schedule.clear))),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

/** Build (once per runtime+tag) the atom bundle for an API-metrics tag — read-only. */
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
          latest: Option.none<ApiUsageMetrics>(),
          history: readCache<ApiPoint>(`${tag.key}/api-history`)?.items ?? [],
        },
        (acc, m) => ({ latest: Option.some(m), history: [...acc.history, toApiPoint(m)].slice(-HISTORY) }),
      ),
      Stream.tap((acc) =>
        Effect.sync(() => writeCache(`${tag.key}/api-history`, acc.history.slice(-HISTORY_CACHE))),
      ),
    ),
  );
  const bundle: ApiBundle = {
    status: runtime.atom(Stream.unwrap(Effect.map(tag, (a) => a.usage.changes))),
    metrics: Atom.mapResult(metricsHistory, (a) => a.latest),
    history: Atom.mapResult(metricsHistory, (a) => a.history),
  };
  cache.set(tag.key, bundle);
  return bundle;
};

// A NodeStatus client over a specific node's transport: a NodeKey's *value* is the RPC `Protocol`,
// so provide it as the ambient `RpcClient.Protocol`. The tag-walk (`nodesOf`) erases the node's
// identity, and the runtime supplies its transport via `connect`, so we restate the resolved
// requirement — the same contained boundary assertion `Hyperlink.client` makes for node-bearing tags.
// The 2-arg `client(tag, node)` form reads the node's value and unwraps its transport — the sanctioned
// way to point a nodeless tag (NodeStatus) at a specific node. (The node is exposed at runtime via
// `connect`, so we erase its identity to `never` — the same contained boundary assertion Hyperlink.client
// makes for node-bearing tags.)
const nodeStatusClient = (node: NodeKey<unknown>) =>
  client(NodeStatus.Tag, node as NodeKey<never>);

/** Build (once per runtime+node) the atom bundle for a node's live status — read straight from the
 *  reserved `NodeStatus` resource over that node's transport. */
export const nodeStatusBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  ref: NodeRef,
): NodeBundle => {
  const cache = cacheFor(nodeBundleCache, runtime);
  const existing = cache.get(ref.id);
  if (existing !== undefined) return existing;
  const logsKey = `${ref.id}/logs`;
  bumpLogIdFrom(logsKey);
  const bundle: NodeBundle = {
    id: ref.id,
    status: runtime.atom(
      // Provide the per-node client at the STREAM level so its scope spans the whole subscription.
      // (Providing it to the producing Effect tore the scoped RPC client down as soon as that effect
      // returned the stream, interrupting it — "all fibers interrupted".)
      Stream.unwrap(Effect.map(NodeStatus.Tag, (h) => h.status.changes)).pipe(
        Stream.provide(nodeStatusClient(ref.node)),
      ),
    ),
    logs: runtime.atom(
      // `cachedAccumulator`'s live + history both require `NodeStatus.Tag`; provide the per-node
      // client once over the combined stream (same stream-scoped provide as `status`).
      cachedAccumulator({
        key: logsKey,
        cap: 300,
        stream: Stream.unwrap(Effect.map(NodeStatus.Tag, (h) => h.logs.stream)).pipe(Stream.map(toLogLine)),
        query: Effect.flatMap(NodeStatus.Tag, (h) => h.logs.query({ limit: 300 })).pipe(
          Effect.map((entries) => entries.map(toLogLine)),
        ),
      }).pipe(Stream.provide(nodeStatusClient(ref.node))),
    ),
    // Ready-count over time, accumulated client-side from the status stream — a compact readiness
    // sparkline (no server change). Dips when a resource degrades (e.g. a dependency blips).
    health: runtime.atom(
      cachedAccumulator({
        key: `${ref.id}/health`,
        cap: 120,
        stream: Stream.unwrap(Effect.map(NodeStatus.Tag, (h) => h.status.changes)).pipe(
          Stream.map((st) => st.resources.filter((x) => x.ready).length),
        ),
      }).pipe(Stream.provide(nodeStatusClient(ref.node))),
    ),
  };
  cache.set(ref.id, bundle);
  return bundle;
};

/** Walk a `Group.Tag` tree to its leaf resource tags (queues + processes), raw. */
export const leafTags = (node: GroupNode): ReadonlyArray<unknown> =>
  Object.values(Group.members(node)).flatMap((m) => (Group.isGroup(m) ? leafTags(m) : [m]));

/** Only the queue leaves of a tree. */
export const queueLeaves = (node: GroupNode): ReadonlyArray<QueueTag> =>
  leafTags(node).filter(isQueueTag);

/** Only the process leaves of a tree. */
export const processLeaves = (node: GroupNode): ReadonlyArray<ProcessTag> =>
  leafTags(node).filter(isProcessTag);
