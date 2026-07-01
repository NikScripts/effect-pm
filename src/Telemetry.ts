/**
 * Telemetry — serve a host's whole Effect `Metric` registry as a Resource, for **custom** in-app use
 * (dashboards, TUIs, fleet pages, a `pm metrics` command). The thin counterpart to OTEL export: same
 * source (the per-host `Metric` registry), different sink. OTEL is the professional path — wire
 * `@effect/opentelemetry` and point OTLP at Sentry / Grafana / anything; Telemetry is for building
 * something custom without external infra. See `docs/guides/telemetry.md`.
 *
 * @module Telemetry
 */
import {
  Clock,
  Duration,
  Effect,
  Layer,
  Metric,
  PubSub,
  Schema,
  Scope,
  Stream,
} from "effect";
import {
  Tag as resourceTag,
  layer as resourceLayer,
  query,
  stream,
  type HostBoundTag,
  type HostKey,
  type ResourceTag,
  type ServeEntry,
} from "./Resource";

// ============================================================================
// Public types (explicit interfaces — the schema below is checked against them)
// ============================================================================

/** A metric's label set (from Effect `Metric` attributes). @public */
export type MetricLabels = Readonly<Record<string, string>>;

/** A counter reading. @public */
export interface CounterDatum {
  readonly _tag: "counter";
  readonly id: string;
  readonly labels: MetricLabels;
  readonly count: number;
}

/** A gauge reading. @public */
export interface GaugeDatum {
  readonly _tag: "gauge";
  readonly id: string;
  readonly labels: MetricLabels;
  readonly value: number;
}

/** One cumulative histogram bucket: observations `<= le`. @public */
export interface HistogramBucket {
  readonly le: number;
  readonly count: number;
}

/** A histogram reading (cumulative buckets). @public */
export interface HistogramDatum {
  readonly _tag: "histogram";
  readonly id: string;
  readonly labels: MetricLabels;
  readonly buckets: ReadonlyArray<HistogramBucket>;
  readonly count: number;
  readonly sum: number;
}

/** One metric from a host's registry, tagged by kind. `Frequency`/`Summary` are deferred. @public */
export type MetricDatum = CounterDatum | GaugeDatum | HistogramDatum;

/** A host's whole `Metric` registry, point-in-time. @public */
export interface MetricsSnapshot {
  readonly ts: number;
  readonly metrics: ReadonlyArray<MetricDatum>;
}

// ============================================================================
// Wire schema (THE contract — shared with the dashboard/TUI). The `Schema.Codec<T>`
// annotations fail to compile if the schema and the public interfaces above ever drift.
// ============================================================================

const metricLabels = Schema.Record(Schema.String, Schema.String);

const counterDatum = Schema.TaggedStruct("counter", {
  id: Schema.String,
  labels: metricLabels,
  count: Schema.Number,
});

const gaugeDatum = Schema.TaggedStruct("gauge", {
  id: Schema.String,
  labels: metricLabels,
  value: Schema.Number,
});

const histogramBucket = Schema.Struct({
  le: Schema.Number,
  count: Schema.Number,
});

const histogramDatum = Schema.TaggedStruct("histogram", {
  id: Schema.String,
  labels: metricLabels,
  buckets: Schema.Array(histogramBucket),
  count: Schema.Number,
  sum: Schema.Number,
});

/** Schema for {@link MetricDatum}. @public */
export const metricDatum: Schema.Codec<MetricDatum> = Schema.Union([
  counterDatum,
  gaugeDatum,
  histogramDatum,
]);

/** Schema for {@link MetricsSnapshot} — the served wire envelope. @public */
export const metricsSnapshot: Schema.Codec<MetricsSnapshot> = Schema.Struct({
  ts: Schema.Number,
  metrics: Schema.Array(metricDatum),
});

// ============================================================================
// Encode: Effect `Metric.snapshot` → the wire envelope
// ============================================================================

type MetricSnapshotElem =
  typeof Metric.snapshot extends Effect.Effect<ReadonlyArray<infer A>, infer _E, infer _R>
    ? A
    : never;

const encode = (
  snapshot: ReadonlyArray<MetricSnapshotElem>,
  ts: number,
): MetricsSnapshot => ({
  ts,
  metrics: snapshot.flatMap((s): ReadonlyArray<MetricDatum> => {
    const id = s.id;
    const labels = s.attributes ?? {};
    switch (s.type) {
      case "Counter":
        return [{ _tag: "counter", id, labels, count: Number(s.state.count) }];
      case "Gauge":
        return [{ _tag: "gauge", id, labels, value: Number(s.state.value) }];
      case "Histogram":
        return [
          {
            _tag: "histogram",
            id,
            labels,
            buckets: s.state.buckets.map(([le, count]) => ({ le, count })),
            count: s.state.count,
            sum: s.state.sum,
          },
        ];
      default:
        return []; // Frequency / Summary — deferred (add additively)
    }
  }),
});

// ============================================================================
// Contract (Tag)
// ============================================================================

const telemetrySpec = {
  snapshot: query(metricsSnapshot).annotate({
    description: "Point-in-time snapshot of this host's whole Metric registry.",
  }),
  live: stream(metricsSnapshot).annotate({
    description: "Periodic push (~1s) of this host's Metric registry.",
  }),
};

/** @internal */
export type TelemetrySpec = typeof telemetrySpec;

/** This contract's canonical kind (stamped on every tag; read via `Resource.kindOf`). @public */
export const kind = "@nikscripts/effect-pm/Telemetry";

/** A Telemetry instance tag. @public */
export type TelemetryTag<Self> = ResourceTag<Self, TelemetrySpec>;

/** A host-bound {@link TelemetryTag} — served + reached on that host. @public */
export type TelemetryHostTag<Self, HSelf> = HostBoundTag<Self, TelemetrySpec, HSelf>;

/** Tag-construction options for {@link Tag}. @public */
export interface TelemetryConstructOptions<HSelf = never> {
  readonly host?: HostKey<HSelf>;
  readonly description?: string;
}

const defaultKey = "telemetry";
const keyFor = (host: HostKey<unknown> | undefined): string =>
  host === undefined ? defaultKey : `${host.key}/${defaultKey}`;

/**
 * Declare a Telemetry tag: `class FleetTelemetry extends Telemetry.Tag<FleetTelemetry>()() {}` (hostless
 * — the dashboard reaches each host via `Resource.client(FleetTelemetry, host)`), or
 * `…Tag<FleetTelemetry>()({ host: MiniHost })` to bind + serve it on a specific host.
 *
 * @public
 */
export const Tag = <Self>() => {
  function build(): TelemetryTag<Self>;
  function build<HSelf>(options: {
    readonly host: HostKey<HSelf>;
    readonly description?: string;
  }): TelemetryHostTag<Self, HSelf>;
  function build(
    options?: TelemetryConstructOptions<unknown>,
  ): TelemetryTag<Self> {
    const host = options?.host;
    const key = keyFor(host);
    return host === undefined
      ? resourceTag<Self>()(key, telemetrySpec, {
          kind,
          description: options?.description,
        })
      : resourceTag<Self>()(key, telemetrySpec, {
          kind,
          description: options?.description,
          host,
        });
  }
  return build;
};

// ============================================================================
// Engine (sampler + layer + serverEntry)
// ============================================================================

/** Options for {@link layer} / {@link serverEntry}. @public */
export interface TelemetryOptions {
  /** Live-stream sampling cadence. @default 1 second */
  readonly interval?: Duration.Duration;
}

const buildImpl = (
  options?: TelemetryOptions,
): Effect.Effect<
  {
    readonly snapshot: Effect.Effect<MetricsSnapshot>;
    readonly live: Stream.Stream<MetricsSnapshot>;
  },
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const interval = options?.interval ?? Duration.seconds(1);
    // sliding so a slow subscriber can't backpressure the sampling fiber
    const hub = yield* PubSub.sliding<MetricsSnapshot>(8);
    const sample = Effect.gen(function* () {
      const ts = yield* Clock.currentTimeMillis;
      const raw = yield* Metric.snapshot;
      return encode(raw, ts);
    });
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* PubSub.publish(hub, yield* sample);
          yield* Effect.sleep(interval);
        }),
      ),
    );
    return {
      snapshot: sample,
      live: Stream.fromPubSub(hub),
    };
  });

/**
 * Local layer for a Telemetry tag — forks one sampling fiber into scope and wires `snapshot`/`live`.
 *
 * @public
 */
export const layer = <Self>(
  tag: TelemetryTag<Self>,
  options?: TelemetryOptions,
): Layer.Layer<Self, never, Scope.Scope> =>
  Layer.unwrap(
    Effect.map(buildImpl(options), (impl) => resourceLayer(tag, impl)),
  );

/**
 * A `serveAllHttp` entry for a Telemetry tag — serve it on a host like a queue/process, then reach it
 * with `Resource.client`.
 *
 * @public
 */
export const serverEntry = <Self>(
  tag: TelemetryTag<Self>,
  options?: TelemetryOptions,
): ServeEntry<Scope.Scope> => ({
  tag,
  impl: buildImpl(options),
});
