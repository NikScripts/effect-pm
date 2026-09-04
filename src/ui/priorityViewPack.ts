/**
 * WorkPool priority observe pack — pipeable recipes (named-lane status + start).
 * @internal
 */
import { Option, pipe, type Effect as EffectT, type Stream as StreamT } from "effect";
import * as Observe from "../Observe";
import { readCache, writeCache } from "./cache";
import type { PriorityStatus, QueueMetrics } from "./data";
import {
  queueControls,
  queueMetricsHistory,
  serviceLogs,
} from "./workPoolViewPack";

const TREND = 60;

type Priority = {
  readonly status: {
    readonly get: EffectT.Effect<PriorityStatus>;
    readonly changes: StreamT.Stream<PriorityStatus>;
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
  readonly start: EffectT.Effect<void>;
  readonly pause: EffectT.Effect<void>;
  readonly resume: EffectT.Effect<void>;
  readonly clear: EffectT.Effect<void>;
  readonly stop: EffectT.Effect<void>;
};

const pendingOf = (s: PriorityStatus): number =>
  Object.values(s.sizes).reduce((sum, n) => sum + n, 0);

const listCache = {
  read: <A>(key: string): ReadonlyArray<A> | undefined => readCache<A>(key)?.items,
  write: <A>(key: string, items: ReadonlyArray<A>): void => {
    writeCache(key, items);
  },
};

type StatusTrend = {
  readonly latest: Option.Option<PriorityStatus>;
  readonly trend: ReadonlyArray<number>;
};

const statusTrend = Observe.fold(
  (q: Priority) => q.status,
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
    channel: (tag) => `${tag.key}/priority-status-trend`,
  },
);

const priorityStart = Observe.struct({
  start: Observe.fn((q: { readonly start: EffectT.Effect<void> }) => q.start),
});

/**
 * Full WorkPool priority UI pack.
 *
 * @public
 */
export const pack = Observe.named(
  "workpool/priority",
  pipe(
    Observe.struct({
      status: Observe.map(statusTrend, (a) => a.latest),
      trend: Observe.map(statusTrend, (a) => a.trend),
      lifecycle: Observe.atom((q: Priority) => q.lifecycle),
    }),
    Observe.and(priorityStart),
    Observe.and(queueControls),
    Observe.and(queueMetricsHistory),
    Observe.and(serviceLogs),
  ),
);
