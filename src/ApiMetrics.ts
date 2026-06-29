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
 * class NwslMetrics extends ApiMetrics.Tag<NwslMetrics>(NwslClientId)() {}
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
  clientInstances,
  instance,
  layer as resourceLayer,
  query,
  serveInstances,
  stream,
  tagFor,
  type ResourceInstance,
  type ResourceTag,
  type ServiceOf,
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

/** @internal */
export type ApiMetricsSpec = {
  readonly metrics: ReturnType<typeof stream<typeof apiUsageMetrics>>;
  readonly usageNow: ReturnType<typeof query<typeof apiUsageSnapshot>>;
};

const apiMetricsSpec = {
  metrics: stream(apiUsageMetrics).annotate({
    description:
      "Windowed API usage (requests, errors, throughput, per-endpoint breakdown) emitted once per window.",
  }),
  usageNow: query(apiUsageSnapshot).annotate({
    description:
      "Point-in-time usage snapshot — cumulative totals and top endpoints.",
  }),
};

/** Shared RPC family — one group for all ApiMetrics instances. @internal */
/** This contract's canonical kind — stamped on every tag so consumers (e.g. the dashboard) can
 *  classify it via {@link Resource.kindOf} without sniffing the spec. @since 1.0.0 */
export const kind = "@nikscripts/effect-pm/ApiMetrics";

const apiMetricsFactory = tagFor("apiMetrics", apiMetricsSpec, { kind });

const resolveTagArgs = (
  clientId: string,
  idOrOpts?: string | ApiMetricsTagOptions,
): { readonly key: string; readonly options: ApiMetricsTagOptions } => {
  if (idOrOpts === undefined) {
    return { key: metricsKeyFor(clientId), options: {} };
  }
  if (typeof idOrOpts === "string") {
    return { key: idOrOpts, options: {} };
  }
  return { key: metricsKeyFor(clientId), options: idOrOpts };
};

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
const layer = <Self>(
  tag: ApiMetricsTag<Self>,
  options?: ApiMetricsTagOptions,
): Layer.Layer<Self, never, Scope.Scope> =>
  Layer.unwrap(
    Effect.map(buildImpl(tag[clientIdSym], options), (impl) =>
      resourceLayer(tag, impl),
    ),
  );

const layerFor = <
  Self,
  const ClientId extends string,
  Client extends Context.ServiceClass<any, ClientId, any>,
>(
  tag: ApiMetricsTag<Self> & { readonly [clientIdSym]: ClientId },
  _client: Client,
  options?: ApiMetricsTagOptions,
): Layer.Layer<Self, never, Scope.Scope> => layer(tag, options);

/**
 * Class factory for an {@link ApiMetrics} instance tag.
 *
 * @example
 * ```ts
 * class NwslMetrics extends ApiMetrics.Tag<NwslMetrics>(NwslClientId)() {}
 * ```
 *
 * @public
 */
// Only `Self` is an explicit type argument — `class X extends ApiMetrics.Tag<X>(clientId)() {}`.
// The client id's literal type isn't carried on the tag (`clientIdSym` is `string`), so a second
// `ClientId` generic would only force callers to pass it too (TS can't partially infer).
const tag = <Self>(clientId: string) =>
  (idOrOpts?: string | ApiMetricsTagOptions): ApiMetricsTag<Self> => {
    const { key } = resolveTagArgs(clientId, idOrOpts);
    return Object.assign(apiMetricsFactory<Self>(key), {
      [clientIdSym]: clientId,
    }) as ApiMetricsTag<Self>;
  };

/**
 * ApiMetrics toolkit — shared observability contract for outbound API clients.
 *
 * @public
 */
export const ApiMetrics = {
  /** @see {@link tag} */
  Tag: tag,
  /** This contract's canonical kind (stamped on every tag; read via {@link Resource.kindOf}). */
  kind,
  /** Suffix appended to `clientId` for the default Resource key. */
  metricsKeySuffix,
  metricsKeyFor,
  clientIdOf,
  layer,
  layerFor,
  /** Serve many instances behind one shared RPC group. */
  serveInstances: (
    ...instances: ReadonlyArray<ResourceInstance<ApiMetricsSpec>>
  ) => serveInstances(apiMetricsFactory, ...instances),
  /** One RPC client for many factory instances (dashboard). */
  clientInstances: <const Tags extends ReadonlyArray<ApiMetricsTag<unknown>>>(
    ...tags: Tags
  ) =>
    clientInstances(
      apiMetricsFactory,
      ...(tags as ReadonlyArray<ResourceTag<unknown, ApiMetricsSpec>>),
    ),
  /** Pair an instance tag with its implementation for {@link serveInstances}. */
  instance: <Self>(
    tag: ApiMetricsTag<Self>,
    impl: ServiceOf<ApiMetricsSpec>,
  ) => instance(tag, impl),
  /** Wire schemas re-exported for widgets and RPC. */
  apiUsageMetrics,
  apiUsageSnapshot,
} as const;

export type { ApiUsageMetrics, ApiUsageSnapshot };
