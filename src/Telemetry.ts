/**
 * Telemetry — serve a node's whole Effect `Metric` registry as a Resource, for **custom** in-app use
 * (dashboards, TUIs, fleet pages, a `pm metrics` command). The thin counterpart to OTEL export: same
 * source (the per-node `Metric` registry), different sink. OTEL is the professional path — wire
 * `@effect/opentelemetry` and point OTLP at Sentry / Grafana / anything; Telemetry is for building
 * something custom without external infra.
 *
 * ## Fleet glass
 *
 * Leaf fields (`snapshot` / `live`) read **this** node's registry. Fleet fields
 * (`inFlightByNode` / `fleetInFlight`) fold peers' leaf snapshots via {@link Resource.peers} —
 * so a meshed pack gets one glass for the stadium board. Discharge the mesh with
 * {@link Resource.peersLayer} (or {@link alone} for a single node with no peers).
 *
 * See `docs/guides/telemetry.md`.
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
import { combineByNode, combineQuery, combineSum } from "./MultiNode";
import * as Resource from "./Resource";
import {
  Tag as resourceTag,
  layer as resourceLayer,
  serve as resourceServe,
  serveRemote as resourceServeRemote,
  effect,
  fleet,
  stream,
  type NodeBoundTag,
  type NodeKey,
  type PeersId,
  type ResourceTag,
  type SelfNodeId,
} from "./Resource";

// ============================================================================
// Wire schema — the served contract, shared with the dashboard/TUI. Each datum is one
// `Schema.TaggedClass`: value and type under a single name, so there is no interface /
// schema pair to keep in sync (Types & Naming → *Prefer a class schema*).
// ============================================================================

/** A metric's label set (from Effect `Metric` attributes). @public */
export type MetricLabels = Readonly<Record<string, string>>;
const metricLabels = Schema.Record(Schema.String, Schema.String);

/** A counter reading. @public */
export class CounterDatum extends Schema.TaggedClass<CounterDatum>()("Counter", {
  id: Schema.String,
  labels: metricLabels,
  count: Schema.Number,
}) {}

/** A gauge reading. @public */
export class GaugeDatum extends Schema.TaggedClass<GaugeDatum>()("Gauge", {
  id: Schema.String,
  labels: metricLabels,
  value: Schema.Number,
}) {}

/** One cumulative histogram bucket: observations `<= le`. @public */
export class HistogramBucket extends Schema.Class<HistogramBucket>("HistogramBucket")({
  le: Schema.Number,
  count: Schema.Number,
}) {}

/** A histogram reading (cumulative buckets). @public */
export class HistogramDatum extends Schema.TaggedClass<HistogramDatum>()("Histogram", {
  id: Schema.String,
  labels: metricLabels,
  buckets: Schema.Array(HistogramBucket),
  count: Schema.Number,
  sum: Schema.Number,
}) {}

/** One metric from a node's registry, tagged by kind. `Frequency`/`Summary` are deferred. @public */
export const metricDatum = Schema.Union([CounterDatum, GaugeDatum, HistogramDatum]);
/** The type of a single {@link metricDatum}. @public */
export type MetricDatum = typeof metricDatum.Type;

/** A node's whole `Metric` registry, point-in-time — the served wire envelope. @public */
export class MetricsSnapshot extends Schema.Class<MetricsSnapshot>("MetricsSnapshot")({
  ts: Schema.Number,
  metrics: Schema.Array(metricDatum),
}) {}

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
const toBucket = ([le, count]: readonly [number, number]): HistogramBucket =>
  HistogramBucket.make({ le, count });

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
      return [CounterDatum.make({ id, labels, count: Number(s.state.count) })];
    case "Gauge":
      return [GaugeDatum.make({ id, labels, value: Number(s.state.value) })];
    case "Histogram":
      return [
        HistogramDatum.make({
          id,
          labels,
          buckets: s.state.buckets.map(toBucket),
          count: s.state.count,
          sum: s.state.sum,
        }),
      ];
    default:
      return [];
  }
};

/** Encode a raw `Metric.snapshot` result + timestamp into the wire envelope. Pure. @internal */
const encodeSnapshot = (
  raw: ReadonlyArray<MetricSnapshotElem>,
  ts: number,
): MetricsSnapshot => MetricsSnapshot.make({ ts, metrics: raw.flatMap(encodeDatum) });

/**
 * The current registry snapshot, encoded — the **single source** of "take a snapshot" (the served
 * `snapshot` query and the `live` sampler both use it). Usable locally, without the resource.
 *
 * @public
 */
export const snapshotNow: Effect.Effect<MetricsSnapshot> = Effect.all([
  Clock.currentTimeMillis,
  Metric.snapshot,
]).pipe(Effect.map(([ts, raw]) => encodeSnapshot(raw, ts)));

// ============================================================================
// Contract (Tag)
// ============================================================================

/** Gauge id folded by {@link inFlightOf} / fleet fields — queue engines emit this. @public */
export const inFlightMetricId = "queue_in_flight";

/**
 * Read {@link inFlightMetricId} from a snapshot (missing ⇒ `0`). Used by fleet folds and demos.
 *
 * @public
 */
export const inFlightOf = (snap: MetricsSnapshot): number => {
  const hit = snap.metrics.find(
    (m): m is GaugeDatum => m._tag === "Gauge" && m.id === inFlightMetricId,
  );
  return hit?.value ?? 0;
};

const byNodeSchema = Schema.Record(Schema.String, Schema.Number);

const telemetrySpec = {
  snapshot: effect(MetricsSnapshot).annotate({
    description: "Point-in-time snapshot of this node's whole Metric registry.",
  }),
  live: stream(MetricsSnapshot).annotate({
    description: "Periodic push (~1s) of this node's Metric registry.",
  }),
  inFlightByNode: effect(byNodeSchema).pipe(fleet).annotate({
    description:
      "`queue_in_flight` gauge per node — peers' leaf snapshots + this node's own.",
  }),
  fleetInFlight: effect(Schema.Number).pipe(fleet).annotate({
    description: "Sum of `queue_in_flight` across this node and its peers.",
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

/**
 * Identity node for a **non-meshed** Telemetry instance (no peers). Used by {@link alone}.
 *
 * @internal
 */
class TelemetryAloneNode extends Resource.Node<TelemetryAloneNode>(
  "@nikscripts/effect-pm/Telemetry/alone",
) {}

/**
 * Discharge the mesh with **no peers** — this node's registry alone. Pair with {@link layer} /
 * {@link serve} when Telemetry is not distributed:
 *
 * ```ts
 * Telemetry.layer(FleetTelemetry).pipe(Layer.provide(Telemetry.alone(FleetTelemetry)))
 * ```
 *
 * For a fleet, provide {@link Resource.peersLayer} instead (bundled selfNode + peers).
 *
 * @public
 */
export const alone = <Self>(
  tag: TelemetryTag<Self>,
): Layer.Layer<PeersId<Self> | SelfNodeId<Self>> =>
  Layer.merge(
    Resource.peersFrom(tag, {}),
    Resource.selfNodeLayer(tag, TelemetryAloneNode),
  );

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

/**
 * The served impl: leaf `snapshot`/`live` plus fleet folds over peers' leaf snapshots.
 * Resolves {@link Resource.peers} / {@link Resource.selfNode} once; members close over them.
 *
 * @internal
 */
const buildImpl = <Self>(
  tag: TelemetryTag<Self>,
  options?: TelemetryOptions,
): Effect.Effect<
  {
    readonly snapshot: Effect.Effect<MetricsSnapshot>;
    readonly live: Stream.Stream<MetricsSnapshot>;
    readonly inFlightByNode: Effect.Effect<Readonly<Record<string, number>>>;
    readonly fleetInFlight: Effect.Effect<number>;
  },
  never,
  Scope.Scope | PeersId<Self> | SelfNodeId<Self>
> =>
  Effect.gen(function* () {
    const hub = yield* PubSub.sliding<MetricsSnapshot>(liveBufferSize);
    yield* Effect.forkScoped(sampleLoop(hub, options?.interval ?? defaultInterval));
    const peers = yield* Resource.peers(tag);
    const self = yield* Resource.selfNode(tag);
    const ownInFlight = snapshotNow.pipe(Effect.map(inFlightOf));
    return {
      snapshot: snapshotNow,
      live: Stream.fromPubSub(hub),
      inFlightByNode: Effect.gen(function* () {
        const byNode = yield* combineQuery(
          peers,
          (peer) => peer.snapshot.pipe(Effect.map(inFlightOf)),
          combineByNode,
        );
        const own = yield* ownInFlight;
        return { ...byNode, [self]: own };
      }),
      fleetInFlight: Effect.gen(function* () {
        const others = yield* combineQuery(
          peers,
          (peer) => peer.snapshot.pipe(Effect.map(inFlightOf)),
          combineSum,
        );
        return others + (yield* ownInFlight);
      }),
    };
  });

/**
 * Local layer for a Telemetry tag — forks one sampling fiber and wires leaf + fleet fields.
 * Requires the mesh capability ({@link alone} or {@link Resource.peersLayer}).
 *
 * @public
 */
export const layer = <Self>(
  tag: TelemetryTag<Self>,
  options?: TelemetryOptions,
): Layer.Layer<
  Self | Resource.Local<Self>,
  never,
  PeersId<Self> | SelfNodeId<Self>
> =>
  buildImpl(tag, options).pipe(
    Effect.map((impl) => resourceLayer(tag, impl)),
    Layer.unwrap,
  );

/**
 * Serve this Telemetry resource **remotely (served-only)** — the counterpart to
 * {@link Resource.serveRemote}. Mounts leaf + fleet RPC handlers **without** granting the local
 * instance. Requires the mesh capability ({@link alone} or {@link Resource.peersLayer}).
 *
 * @public
 */
export const serveRemote = <Self>(
  tag: TelemetryTag<Self>,
  options?: TelemetryOptions,
): Layer.Layer<never, never, PeersId<Self> | SelfNodeId<Self>> =>
  buildImpl(tag, options).pipe(
    Effect.map((impl) => resourceServeRemote(tag, impl)),
    Layer.unwrap,
  );

/**
 * Serve this Telemetry resource **and** grant its local instance from **one** materialization —
 * counterpart to {@link Resource.serve}. Forks one sampling fiber, mounts leaf + fleet handlers,
 * and grants `Self | Local<Self>`. Requires the mesh capability ({@link alone} or
 * {@link Resource.peersLayer}):
 *
 * ```ts
 * Telemetry.serve(FleetMetrics).pipe(
 *   Layer.provide(Resource.peersLayer(FleetMetrics, DropletEast)),
 * )
 * ```
 *
 * @public
 */
export const serve = <Self>(
  tag: TelemetryTag<Self>,
  options?: TelemetryOptions,
) => resourceServe(tag, buildImpl(tag, options));
