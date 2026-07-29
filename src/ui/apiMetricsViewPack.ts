/**
 * ApiMetrics observe pack — usage snapshot + window history.
 * @internal
 */
import { DateTime, Option, type Effect as EffectT, type Stream as StreamT } from "effect";
import * as Observe from "../Observe";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../ApiUsageSchema";
import { readCache, writeCache } from "./cache";
import type { ApiPoint } from "./data";

const HISTORY = 1800;
const HISTORY_CACHE = 120;

type Api = {
  readonly metrics: {
    readonly usage: {
      readonly get: EffectT.Effect<ApiUsageSnapshot>;
      readonly changes: StreamT.Stream<ApiUsageSnapshot>;
    };
    readonly windows: StreamT.Stream<ApiUsageMetrics>;
    readonly remaining: {
      readonly get: EffectT.Effect<number>;
      readonly changes: StreamT.Stream<number>;
    };
    readonly resetAfter: {
      readonly get: EffectT.Effect<number>;
      readonly changes: StreamT.Stream<number>;
    };
    readonly exceeded: {
      readonly get: EffectT.Effect<number>;
      readonly changes: StreamT.Stream<number>;
    };
  };
};

const toApiPoint = (m: ApiUsageMetrics): ApiPoint => ({
  t: DateTime.toEpochMillis(m.windowEnd),
  throughput: m.throughputPerSec,
  errors: m.errors,
  inFlight: m.inFlight,
});

const listCache = {
  read: <A>(key: string): ReadonlyArray<A> | undefined => readCache<A>(key)?.items,
  write: <A>(key: string, items: ReadonlyArray<A>): void => {
    writeCache(key, items);
  },
};

type MetricsHistory = {
  readonly latest: Option.Option<ApiUsageMetrics>;
  readonly history: ReadonlyArray<ApiPoint>;
};

const metricsHistory = Observe.fold(
  (a: Api) => a.metrics.windows,
  {
    initial: (tag): MetricsHistory => ({
      latest: Option.none(),
      history: listCache.read<ApiPoint>(`${tag.key}/api-history`) ?? [],
    }),
    step: (acc, m): MetricsHistory => ({
      latest: Option.some(m),
      history: [...acc.history, toApiPoint(m)].slice(-HISTORY),
    }),
    tap: (acc, tag) => {
      listCache.write(`${tag.key}/api-history`, acc.history.slice(-HISTORY_CACHE));
    },
    channel: (tag) => `${tag.key}/api-metrics-history`,
  },
);

/**
 * Full API-metrics UI pack.
 *
 * @public
 */
export const pack = Observe.named(
  "api",
  Observe.struct({
    status: Observe.atom((a: Api) => a.metrics.usage),
    remaining: Observe.atom((a: Api) => a.metrics.remaining),
    resetAfter: Observe.atom((a: Api) => a.metrics.resetAfter),
    exceeded: Observe.atom((a: Api) => a.metrics.exceeded),
    metrics: Observe.map(metricsHistory, (a) => a.latest),
    history: Observe.map(metricsHistory, (a) => a.history),
  }),
);
