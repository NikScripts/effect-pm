/**
 * WorkPool queue observe pack — pipeable recipes for cards/details.
 * @internal
 */
import { DateTime, Effect, Option, pipe, Stream, type Effect as EffectT, type Stream as StreamT } from "effect";
import { nodeOf } from "../Hyperlink";
import * as Observe from "../Observe";
import { readCache, writeCache } from "./cache";
import type {
  MetricPoint,
  QueueMetrics,
  QueueStatus,
} from "./data";
import { serviceLogsAtom } from "./observeSupport";

const HISTORY = 1800;
const HISTORY_CACHE = 120;
const TREND = 60;

/** Structural command surface for queue controls. */
type QueueControls = {
  readonly pause: EffectT.Effect<void>;
  readonly resume: EffectT.Effect<void>;
  readonly clear: EffectT.Effect<void>;
  readonly stop: EffectT.Effect<void>;
};

/** Structural queue service — select against this, not a concrete Tag class. */
type Queue = QueueControls & {
  readonly status: {
    readonly get: EffectT.Effect<QueueStatus>;
    readonly changes: StreamT.Stream<QueueStatus>;
  };
  readonly lifecycle: {
    readonly get: EffectT.Effect<{ readonly _tag: string }>;
    readonly changes: StreamT.Stream<{ readonly _tag: string }>;
  };
  readonly metrics: {
    readonly stream: StreamT.Stream<QueueMetrics>;
    readonly query: (o: {
      readonly limit: number;
    }) => EffectT.Effect<ReadonlyArray<QueueMetrics>>;
  };
};

const toPoint = (m: QueueMetrics): MetricPoint => ({
  t: DateTime.toEpochMillis(m.windowEnd),
  throughput: m.throughputPerSec,
  latency: m.avgTotalMillis ?? 0,
});

const pendingOf = (s: QueueStatus): number => s.sizes.high + s.sizes.normal + s.sizes.low;

const listCache = {
  read: <A>(key: string): ReadonlyArray<A> | undefined => readCache<A>(key)?.items,
  write: <A>(key: string, items: ReadonlyArray<A>): void => {
    writeCache(key, items);
  },
};

type StatusTrend = {
  readonly latest: Option.Option<QueueStatus>;
  readonly trend: ReadonlyArray<number>;
};

type MetricsHistory = {
  readonly latest: Option.Option<QueueMetrics>;
  readonly history: ReadonlyArray<MetricPoint>;
};

type MetricsItem =
  | { readonly metric: QueueMetrics }
  | { readonly point: MetricPoint };

const statusTrend = Observe.fold(
  (q: Queue) => q.status,
  {
    initial: (tag): StatusTrend => ({
      latest: Option.none(),
      trend: listCache.read<number>(`${tag.key}/trend`) ?? [],
    }),
    step: (acc, s): StatusTrend => ({
      latest: Option.some(s),
      trend: [...acc.trend, pendingOf(s)].slice(-TREND),
    }),
    tap: (acc, tag) => {
      listCache.write(`${tag.key}/trend`, acc.trend);
    },
    channel: (tag) => `${tag.key}/status-trend`,
  },
);

const metricsHistory = Observe.fold(
  (q: Queue) => q.metrics.stream.pipe(Stream.map((m): MetricsItem => ({ metric: m }))),
  {
    initial: (tag): MetricsHistory => ({
      latest: Option.none(),
      history: listCache.read<MetricPoint>(`${tag.key}/history`) ?? [],
    }),
    step: (acc, item): MetricsHistory =>
      "metric" in item
        ? {
            latest: Option.some(item.metric),
            history: [...acc.history, toPoint(item.metric)].slice(-HISTORY),
          }
        : {
            latest: acc.latest,
            history: [...acc.history, item.point].slice(-HISTORY),
          },
    tap: (acc, tag) => {
      listCache.write(`${tag.key}/history`, acc.history.slice(-HISTORY_CACHE));
    },
    seed: (q) =>
      q.metrics.query({ limit: HISTORY }).pipe(
        // Seed rows are history points only (no "latest" metric) — match queueBundle.
        Effect.map((ms) => ms.map((m): MetricsItem => ({ point: toPoint(m) }))),
      ),
    channel: (tag) => `${tag.key}/metrics-history`,
  },
);

/**
 * Pause / resume / clear / stop commands.
 *
 * @public
 */
export const queueControls = Observe.struct({
  pause: Observe.fn((q: QueueControls) => q.pause),
  resume: Observe.fn((q: QueueControls) => q.resume),
  clear: Observe.fn((q: QueueControls) => q.clear),
  stop: Observe.fn((q: QueueControls) => q.stop),
});

/**
 * Metrics stream + capped history (localStorage-backed).
 *
 * @public
 */
export const queueMetricsHistory = Observe.struct({
  metrics: Observe.map(metricsHistory, (a) => a.latest),
  history: Observe.map(metricsHistory, (a) => a.history),
});

/**
 * Node-scoped service logs for the bound tag (any Hyperlink Tag with `nodeOf`).
 *
 * @public
 */
export const serviceLogs = Observe.struct({
  logs: Observe.recipe((ctx) => {
    const tag = ctx.tag;
    const node = nodeOf(tag);
    if (node === undefined) {
      throw new Error(`tag ${tag.key} is missing a node`);
    }
    return serviceLogsAtom(ctx.runtime, tag.key, node);
  }),
});

/** @public @deprecated Prefer {@link serviceLogs}. */
export const queueLogs = serviceLogs;

/**
 * Full WorkPool queue UI pack — card + detail observe surface.
 *
 * @public
 */
export const pack = Observe.named(
  "workpool/queue",
  pipe(
    Observe.struct({
      status: Observe.map(statusTrend, (a) => a.latest),
      trend: Observe.map(statusTrend, (a) => a.trend),
      lifecycle: Observe.atom((q: Queue) => q.lifecycle),
    }),
    Observe.and(queueControls),
    Observe.and(queueMetricsHistory),
    Observe.and(serviceLogs),
  ),
);
