/**
 * Telemetry — serve a node's whole Effect `Metric` registry as a Resource, for **custom** in-app use
 * (dashboards, TUIs, fleet pages, a `pm metrics` command). The thin counterpart to OTEL export: same
 * source (the per-node `Metric` registry), different sink. OTEL is the professional path — wire
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
  serve as resourceServe,
  serveRemote as resourceServeRemote,
  effect,
  stream,
  type NodeBoundTag,
  type NodeKey,
  type ResourceTag,
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

/** One metric from a node's registry, tagged by kind. `Frequency`/`Summary` are deferred. @public */
export type MetricDatum = CounterDatum | GaugeDatum | HistogramDatum;

/** A node's whole `Metric` registry, point-in-time. @public */
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

/** Effect `Metric` attributes → wire labels (absent = none). @internal */
const labelsOf = (attributes: MetricLabels | undefined): MetricLabels =>
  attributes ?? {};

/** One raw `[boundary, count]` histogram bucket → the wire shape. @internal */
const toBucket = ([le, count]: readonly [number, number]): HistogramBucket => ({
  le,
  count,
});

/**
 * Encode one registry metric → zero-or-one {@link MetricDatum} — `Frequency`/`Summary` encode to none
 * (deferred), so this returns an array a `flatMap` folds away.
 *
 * @internal
 */
const encodeDatum = (s: MetricSnapshotElem): ReadonlyArray<MetricDatum> => {
  const { id } = s;
  const labels = labelsOf(s.attributes);
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
          buckets: s.state.buckets.map(toBucket),
          count: s.state.count,
          sum: s.state.sum,
        },
      ];
    default:
      return [];
  }
};

/** Encode a raw `Metric.snapshot` result + timestamp into the wire envelope. Pure. @internal */
const encodeSnapshot = (
  raw: ReadonlyArray<MetricSnapshotElem>,
  ts: number,
): MetricsSnapshot => ({ ts, metrics: raw.flatMap(encodeDatum) });

/**
 * The current registry snapshot, encoded — the **single source** of "take a snapshot" (the served
 * `snapshot` query and the `live` sampler both use it). Usable locally, without the resource.
 *
 * @public
 */
export const snapshotNow: Effect.Effect<MetricsSnapshot> = Effect.map(
  Effect.all([Clock.currentTimeMillis, Metric.snapshot]),
  ([ts, raw]) => encodeSnapshot(raw, ts),
);

// ============================================================================
// Contract (Tag)
// ============================================================================

const telemetrySpec = {
  snapshot: effect(metricsSnapshot).annotate({
    description: "Point-in-time snapshot of this node's whole Metric registry.",
  }),
  live: stream(metricsSnapshot).annotate({
    description: "Periodic push (~1s) of this node's Metric registry.",
  }),
};

/** @internal */
export type TelemetrySpec = typeof telemetrySpec;

/** This contract's canonical kind (stamped on every tag; read via `Resource.kindOf`). @public */
export const kind = "@nikscripts/effect-pm/Telemetry";

/** A Telemetry instance tag. @public */
export type TelemetryTag<Self> = ResourceTag<Self, TelemetrySpec>;

/** A node-bound {@link TelemetryTag} — served + reached on that node. @public */
export type TelemetryNodeTag<Self, HSelf> = NodeBoundTag<Self, TelemetrySpec, HSelf>;

/** Tag-construction options for {@link Tag}. @public */
export interface TelemetryConstructOptions<HSelf = never> {
  readonly node?: NodeKey<HSelf>;
  readonly description?: string;
}

const defaultKey = "telemetry";
const keyFor = (node: NodeKey<unknown> | undefined): string =>
  node === undefined ? defaultKey : `${node.key}/${defaultKey}`;

/**
 * Declare a Telemetry tag: `class FleetTelemetry extends Telemetry.Tag<FleetTelemetry>()() {}` (nodeless
 * — the dashboard reaches each node via `Resource.client(FleetTelemetry, node)`), or
 * `…Tag<FleetTelemetry>()({ node: MiniNode })` to bind + serve it on a specific node.
 *
 * @public
 */
export const Tag = <Self>() => {
  function build(): TelemetryTag<Self>;
  function build<HSelf>(options: {
    readonly node: NodeKey<HSelf>;
    readonly description?: string;
  }): TelemetryNodeTag<Self, HSelf>;
  function build(
    options?: TelemetryConstructOptions<unknown>,
  ): TelemetryTag<Self> {
    const node = options?.node;
    const key = keyFor(node);
    return node === undefined
      ? resourceTag<Self>()(key, telemetrySpec, {
          kind,
          description: options?.description,
        })
      : resourceTag<Self>()(key, telemetrySpec, {
          kind,
          description: options?.description,
          node,
        });
  }
  return build;
};

// ============================================================================
// Engine (sampler + layer + serve/serveRemote)
// ============================================================================

/** Options for {@link layer} / {@link serve} / {@link serveRemote}. @public */
export interface TelemetryOptions {
  /** Live-stream sampling cadence. @default 1 second */
  readonly interval?: Duration.Duration;
}

/** Default live-stream sampling cadence. @internal */
const defaultInterval = Duration.seconds(1);
/** `live` buffer depth — sliding, so a slow subscriber drops old frames instead of backpressuring. @internal */
const liveBufferSize = 8;

/** The sampling fiber body: publish {@link snapshotNow} every `interval`, forever. @internal */
const sampleLoop = (
  hub: PubSub.PubSub<MetricsSnapshot>,
  interval: Duration.Duration,
): Effect.Effect<never> =>
  Effect.forever(
    snapshotNow.pipe(
      Effect.flatMap((snap) => PubSub.publish(hub, snap)),
      Effect.andThen(Effect.sleep(interval)),
    ),
  );

/** The served impl: `snapshot` (fresh sample on demand) + `live` (the sampled stream). @internal */
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
    const hub = yield* PubSub.sliding<MetricsSnapshot>(liveBufferSize);
    yield* Effect.forkScoped(sampleLoop(hub, options?.interval ?? defaultInterval));
    return {
      snapshot: snapshotNow,
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
 * Serve this Telemetry resource **remotely (served-only)** — the counterpart to
 * {@link Resource.serveRemote}. Mounts the `snapshot`/`live` RPC handlers and registers into
 * {@link Resource.servedResourcesLayer} **without** granting the local instance. For a pure
 * gateway/edge; use {@link serve} when the serving node also reads telemetry in-process.
 *
 * @public
 */
export const serveRemote = <Self>(
  tag: TelemetryTag<Self>,
  options?: TelemetryOptions,
) =>
  Layer.unwrap(
    Effect.map(buildImpl(options), (impl) => resourceServeRemote(tag, impl)),
  );

/**
 * Serve this Telemetry resource **and** grant its local instance from **one** materialization — the
 * counterpart to {@link Resource.serve}. Forks one sampling fiber, mounts the `snapshot`/`live` RPC
 * handlers, and grants `Self | Local<Self>` so co-located code can `yield* Tag`. Reach it
 * remotely with `Resource.client`; a served-**only** edge uses {@link serveRemote}.
 *
 * @public
 */
export const serve = <Self>(
  tag: TelemetryTag<Self>,
  options?: TelemetryOptions,
) => resourceServe(tag, buildImpl(options));
