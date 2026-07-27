/**
 * **ApiMetrics** — observability contract for outbound API clients (HttpApi and future transports).
 *
 * Each metrics tag is its own solo {@link Hyperlink.Tag} (wire key = instance key). Link each
 * metrics tag to an outbound client via a shared **`clientId` string** (the
 * {@link Gate.httpApiClientService} Context key).
 *
 * Kind-keyed shared Spec is available on Hyperlink as
 * `Hyperlink.Tag(wireKey, spec)` → `Factory<Self>()(instanceKey)` (see
 * `examples/forms/resource/shared-tag-wire.ts`). ApiMetrics has **not** migrated yet — metrics
 * product shape (handle nest vs sibling tag) is still open.
 *
 * @remarks
 * Browser-safe: import from `hyperlink-ts/ApiMetrics` only in tag files — never the
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
  serve as resourceServe,
  serveRemote as resourceServeRemote,
  ref,
  stream,
  type NodeBoundTag,
  type HyperlinkTag,
  type Subscribable,
} from "./Hyperlink";
import type { NodeKey } from "./Node";

// ============================================================================
// Metadata
// ============================================================================

/**
 * Where the linked outbound client id is stored on an {@link ApiMetrics} tag.
 *
 * @category utils
 * @public
 */
export const clientIdSym: unique symbol = Symbol.for(
  "hyperlink-ts/ApiMetrics/clientId",
);

/** Default suffix appended to `clientId` for the Hyperlink instance key. @internal */
export const metricsKeySuffix = "/metrics";

/**
 * Default Hyperlink key for a metrics tag bound to `clientId`.
 *
 * @category utils
 * @public
 */
export const metricsKeyFor = (clientId: string): string =>
  `${clientId}${metricsKeySuffix}`;

/**
 * Options for {@link ApiMetrics.Tag} (second stage).
 *
 * @category models
 * @public
 */
export interface ApiMetricsTagOptions {
  /** Metrics window cadence. @default 5 seconds */
  readonly windowMs?: Duration.Duration | undefined;
  /** Hyperlink-level description (dashboard panel title). */
  readonly description?: string | undefined;
}

/**
 * An {@link ApiMetrics} instance tag — a {@link HyperlinkTag} plus the linked client id.
 *
 * @category models
 * @public
 */
export type ApiMetricsTag<Self> = HyperlinkTag<Self, ApiMetricsSpec> & {
  readonly [clientIdSym]: string;
};

/**
 * A node-bound {@link ApiMetricsTag} — its `[nodeSym]` narrowed to the node (so `Hyperlink.client`
 * resolves the transport). A **named** type so a consumer can `export` a node-bound metrics tag
 * without leaking the internal `clientIdSym` (TS4020). Returned by `ApiMetrics.Tag()(id, { node })`.
 *
 * @category models
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
  readonly usage: ReturnType<typeof ref<typeof apiUsageSnapshot>>;
};

const apiMetricsSpec = {
  metrics: stream(apiUsageMetrics).annotate({
    description:
      "Windowed API usage (requests, errors, throughput, per-endpoint breakdown) emitted once per window.",
  }),
  usage: ref(apiUsageSnapshot).annotate({
    description:
      "Cumulative usage snapshot — totals and top endpoints (`usage.get` one-shot, `usage.changes` on each update).",
  }),
};

/** This contract's canonical kind — stamped on every tag so consumers (e.g. the dashboard) can
 *  classify it via {@link Hyperlink.kindOf} without sniffing the spec. @public
 *
 * @category utils
 */
export const kind = "hyperlink-ts/ApiMetrics";

/** The per-instance Hyperlink key (wire group prefix) for a metrics tag. A node-bound tag prefixes by
 *  its node's key, so two nodes serving the **same** `clientId` (e.g. the same SDP client behind two
 *  league nodes) get distinct groups and never collide. @internal */
const keyFor = (clientId: string, node: NodeKey<unknown> | undefined): string =>
  node === undefined ? metricsKeyFor(clientId) : `${node.key}/${metricsKeyFor(clientId)}`;

/**
 * Read the linked outbound client id from an {@link ApiMetrics} tag.
 *
 * @category utils
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
    readonly usage: Subscribable<ApiUsageSnapshot>;
  },
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const sink = yield* ensureClientUsage(clientId, options);
    return {
      metrics: sink.metrics,
      usage: sink.usage,
    };
  });

/**
 * Local layer for one {@link ApiMetrics} tag — reads the in-process usage registry.
 *
 * @category layers & serving
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

/**
 * Like {@link layer}, but takes the outbound client's Service class as a witness so the compiler
 * proves the metrics tag's `clientId` matches that client's Context key (correct by construction).
 * `_client` is type-only — erased at runtime; the layer is exactly `layer(tag, options)`.
 *
 * @category layers & serving
 * @public
 */
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
 *  Node.Tag} (so it's served + reached on that node) and/or set its dashboard panel title.
 * @category models
 *  @public */
export interface ApiMetricsConstructOptions<HSelf = never> {
  readonly node?: NodeKey<HSelf>;
  readonly description?: string;
}

/**
 * Serve this metrics resource **remotely (served-only)** — the counterpart to
 * {@link Hyperlink.serveRemote}. Mounts the metrics RPC handlers and registers into
 * {@link Hyperlink.servedHyperlinksLayer} **without** granting the local instance. For a pure
 * gateway/edge; use {@link serve} when the serving node also reads the metrics in-process.
 *
 * @category layers & serving
 * @public
 */
export const serveRemote = <Self>(
  tag: ApiMetricsTag<Self>,
  options?: ApiMetricsTagOptions,
) =>
  Layer.unwrap(
    Effect.map(buildImpl(tag[clientIdSym], options), (impl) =>
      resourceServeRemote(tag, impl),
    ),
  );

/**
 * Serve this metrics resource **and** grant its local instance from **one** materialization — the
 * counterpart to {@link Hyperlink.serve}, fed from the in-process usage registry
 * ({@link ApiMetrics.layer} semantics, via `instrumentEndpoints`). Add the tag to the served node's
 * `Group` and drop this into {@link Node.httpServer}; a served-**only** edge uses {@link serveRemote}.
 *
 * @category layers & serving
 * @public
 */
export const serve = <Self>(
  tag: ApiMetricsTag<Self>,
  options?: ApiMetricsTagOptions,
) => resourceServe(tag, buildImpl(tag[clientIdSym], options));

/**
 * Class factory for an {@link ApiMetrics} instance tag — its own per-instance RPC group, so it
 * serves on a node alongside queues/daemons via {@link ApiMetrics.serve} and is reached with
 * `Hyperlink.client`. Bind it to a node with `{ node }`.
 *
 * @example
 * ```ts
 * class NwslMetrics extends ApiMetrics.Tag<NwslMetrics>()(NwslClientId, { node: NwslNode }) {}
 * ```
 *
 * @category constructors
 * @public
 */
// `Context.Service`-shaped: `<Self>()(clientId, options?)`. Only `Self` is explicit; the client id's
// literal isn't carried on the tag (`clientIdSym` is `string`). The node-bearing call narrows the
// return so `Hyperlink.client` resolves its transport (window cadence lives on the layer/serve).
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
 * namespace: `Tag` is light, `layer` / `serve` / `serveRemote` pull the aggregation only when used. @public
 */
export { tag as Tag };

/** Wire schemas, re-exported for widgets and RPC (they live in `./ApiUsageSchema`). @public */
export {
  apiUsageMetrics,
  apiUsageSnapshot,
} from "./ApiUsageSchema";
export type { ApiUsageMetrics, ApiUsageSnapshot };
