/**
 * **ApiMetrics** — observability contract for outbound API clients (HttpApi and future transports).
 *
 * Uses {@link Resource.tagFor} so many client instances share **one RPC group** on the wire;
 * instances are routed by their Resource `key` header. Link each metrics tag to an outbound
 * client via a shared **`clientId` string** (the {@link HttpApiResource.Service} Context key).
 *
 * @remarks
 * Browser-safe: import from `@nikscripts/effect-pm/ApiMetrics` only in tag files — never the
 * Service class. Declare tags with {@link ApiMetrics.Tag}:
 *
 * ```ts
 * export const NwslClientId = "@app/Nwsl" as const;
 *
 * class NwslMetrics extends ApiMetrics.Tag<NwslMetrics>()(NwslClientId) {}
 * ```
 *
 * Runtime wiring (server):
 *
 * ```ts
 * Layer.mergeAll(
 *   NwslClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
 *   ApiMetrics.layer(NwslMetrics),
 * )
 * ```
 *
 * @module ApiMetrics
 */
import { Context, Duration, Effect, Layer, Scope } from "effect";
import {
  apiUsageMetrics,
  apiUsageSnapshot,
  type ApiUsageMetrics,
  type ApiUsageSnapshot,
} from "./ApiUsageSchema";
import { ensureClientUsage } from "./internal/apiUsageRegistry";
import {
  Tag as resourceTag,
  layer as resourceLayer,
  effect,
  stream,
  type NodeBoundTag,
  type NodeKey,
  type ResourceTag,
  type ServeEntry,
} from "./Resource";

// ============================================================================
// Metadata
// ============================================================================

/**
 * Where the linked outbound client id is stored on an {@link ApiMetrics} tag.
 *
 * @public
 */
export const clientIdSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ApiMetrics/clientId",
);

/** Default suffix appended to `clientId` for the Resource instance key. @internal */
export const metricsKeySuffix = "/metrics";

/**
 * Default Resource key for a metrics tag bound to `clientId`.
 *
 * @public
 */
export const metricsKeyFor = (clientId: string): string =>
  `${clientId}${metricsKeySuffix}`;

/**
 * Options for {@link ApiMetrics.Tag} (second stage).
 *
 * @public
 */
export interface ApiMetricsTagOptions {
  /** Metrics window cadence. @default 5 seconds */
  readonly windowMs?: Duration.Duration | undefined;
  /** Resource-level description (dashboard panel title). */
  readonly description?: string | undefined;
}

/**
 * An {@link ApiMetrics} instance tag — a {@link ResourceTag} plus the linked client id.
 *
 * @public
 */
export type ApiMetricsTag<Self> = ResourceTag<Self, ApiMetricsSpec> & {
  readonly [clientIdSym]: string;
};

/**
 * A node-bound {@link ApiMetricsTag} — its `[nodeSym]` narrowed to the node (so `Resource.client`
 * resolves the transport). A **named** type so a consumer can `export` a node-bound metrics tag
 * without leaking the internal `clientIdSym` (TS4020). Returned by `ApiMetrics.Tag()(id, { node })`.
 *
 * @public
 */
export type ApiMetricsNodeTag<Self, HSelf> = NodeBoundTag<
  Self,
  ApiMetricsSpec,
  HSelf
> & {
  readonly [clientIdSym]: string;
};

/** @internal */
export type ApiMetricsSpec = {
  readonly metrics: ReturnType<typeof stream<typeof apiUsageMetrics>>;
  readonly usageNow: ReturnType<typeof effect<typeof apiUsageSnapshot>>;
};

const apiMetricsSpec = {
  metrics: stream(apiUsageMetrics).annotate({
    description:
      "Windowed API usage (requests, errors, throughput, per-endpoint breakdown) emitted once per window.",
  }),
  usageNow: effect(apiUsageSnapshot).annotate({
    description:
      "Point-in-time usage snapshot — cumulative totals and top endpoints.",
  }),
};

/** This contract's canonical kind — stamped on every tag so consumers (e.g. the dashboard) can
 *  classify it via {@link Resource.kindOf} without sniffing the spec. @since 1.0.0 */
export const kind = "@nikscripts/effect-pm/ApiMetrics";

/** The per-instance Resource key (wire group prefix) for a metrics tag. A node-bound tag prefixes by
 *  its node's key, so two nodes serving the **same** `clientId` (e.g. the same SDP client behind two
 *  league nodes) get distinct groups and never collide. @internal */
const keyFor = (clientId: string, node: NodeKey<unknown> | undefined): string =>
  node === undefined ? metricsKeyFor(clientId) : `${node.key}/${metricsKeyFor(clientId)}`;

/**
 * Read the linked outbound client id from an {@link ApiMetrics} tag.
 *
 * @public
 */
export const clientIdOf = <Self>(tag: ApiMetricsTag<Self>): string =>
  tag[clientIdSym];

const buildImpl = (
  clientId: string,
  options?: ApiMetricsTagOptions,
): Effect.Effect<
  {
    readonly metrics: import("effect").Stream.Stream<ApiUsageMetrics>;
    readonly usageNow: Effect.Effect<ApiUsageSnapshot>;
  },
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const sink = yield* ensureClientUsage(clientId, options);
    return {
      metrics: sink.metrics,
      usageNow: sink.snapshot,
    };
  });

/**
 * Local layer for one {@link ApiMetrics} tag — reads the in-process usage registry.
 *
 * @public
 */
export const layer = <Self>(
  tag: ApiMetricsTag<Self>,
  options?: ApiMetricsTagOptions,
): Layer.Layer<Self, never, Scope.Scope> =>
  Layer.unwrap(
    Effect.map(buildImpl(tag[clientIdSym], options), (impl) =>
      resourceLayer(tag, impl),
    ),
  );

export const layerFor = <
  Self,
  const ClientId extends string,
  Client extends Context.ServiceClass<any, ClientId, any>,
>(
  tag: ApiMetricsTag<Self> & { readonly [clientIdSym]: ClientId },
  _client: Client,
  options?: ApiMetricsTagOptions,
): Layer.Layer<Self, never, Scope.Scope> => layer(tag, options);

/** Tag-construction options for {@link ApiMetrics.Tag}: bind the metrics resource to a {@link
 *  Resource.Node} (so it's served + reached on that node) and/or set its dashboard panel title.
 *  @public */
export interface ApiMetricsConstructOptions<HSelf = never> {
  readonly node?: NodeKey<HSelf>;
  readonly description?: string;
}

/**
 * A serveAllHttp entry for one {@link ApiMetrics} tag — served like a queue/process, fed from the
 * in-process Metric registry ({@link ApiMetrics.layer} semantics, via `instrumentEndpoints`). Add
 * the tag to the served node's `Group` and drop this into `serveAllHttp([...])`. @public
 */
export const serverEntry = <Self>(
  tag: ApiMetricsTag<Self>,
  options?: ApiMetricsTagOptions,
): ServeEntry<Scope.Scope> => ({
  tag,
  impl: buildImpl(tag[clientIdSym], options),
});

/**
 * Class factory for an {@link ApiMetrics} instance tag — its own per-instance RPC group, so it
 * serves on a node alongside queues/processes via {@link ApiMetrics.serverEntry} and is reached with
 * `Resource.client`. Bind it to a node with `{ node }`.
 *
 * @example
 * ```ts
 * class NwslMetrics extends ApiMetrics.Tag<NwslMetrics>()(NwslClientId, { node: NwslNode }) {}
 * ```
 *
 * @public
 */
// `Context.Service`-shaped: `<Self>()(clientId, options?)`. Only `Self` is explicit; the client id's
// literal isn't carried on the tag (`clientIdSym` is `string`). The node-bearing call narrows the
// return so `Resource.client` resolves its transport (window cadence lives on the layer/serverEntry).
const tag = <Self>() => {
  function build(clientId: string): ApiMetricsTag<Self>;
  function build<HSelf>(
    clientId: string,
    options: { readonly node: NodeKey<HSelf>; readonly description?: string },
  ): ApiMetricsNodeTag<Self, HSelf>;
  function build(
    clientId: string,
    options?: ApiMetricsConstructOptions<unknown>,
  ): ApiMetricsTag<Self> {
    const node = options?.node;
    const key = keyFor(clientId, node);
    const base =
      node === undefined
        ? resourceTag<Self>()(key, apiMetricsSpec, { kind, description: options?.description })
        : resourceTag<Self>()(key, apiMetricsSpec, { kind, description: options?.description, node });
    return Object.assign(base, { [clientIdSym]: clientId });
  }
  return build;
};

/**
 * The ApiMetrics tag constructor — `class Clients extends ApiMetrics.Tag<Clients>()(SdpClient) {}`. Flat
 * exports (like {@link Telemetry}) so the whole module is a tree-shakeable `import * as ApiMetrics`
 * namespace: `Tag` is light, `layer` / `serverEntry` pull the aggregation only when used. @public
 */
export { tag as Tag };

/** Wire schemas, re-exported for widgets and RPC (they live in `./ApiUsageSchema`). @public */
export {
  apiUsageMetrics,
  apiUsageSnapshot,
} from "./ApiUsageSchema";
export type { ApiUsageMetrics, ApiUsageSnapshot };
