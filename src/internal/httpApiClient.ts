/**
 * HttpApiClient — gated typed HTTP API client (R4 Hyperlink Tag + legacy Service).
 *
 * Wraps Effect's `HttpApiClient.make` with a concurrency Semaphore (and optional
 * whole-client `rateLimit`) on the `HttpClient` transport via
 * `HttpClientGate.withRunner`.
 *
 * ## Preferred entry (R4)
 *
 * | Function | Purpose |
 * |----------|---------|
 * | {@link HttpApiClient} | Hyperlink Tag factory (no baked `.layer`) |
 * | {@link httpApiClientLayer} | App-owned layer — client + `metrics` nest |
 *
 * Nest fields: limiter `remaining` / `resetAfter` / `exceeded` plus absorbed
 * usage `usage` / `windows` (former ApiMetrics).
 *
 * ## Legacy Context.Service entry
 *
 * | Function | Purpose |
 * |----------|---------|
 * | `Service` / `make` | Tag + baked `.layer` (no nest) |
 * | `layerEffect` | Gate an existing client-building effect |
 * | `instrumentEndpoints` / `acceptJson` | Shared helpers |
 *
 * @module HttpApiClient
 */

import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiClient as EffectHttpApiClient,
} from "effect/unstable/httpapi";
import type { HttpApi as HttpApiType, HttpApiGroup } from "effect/unstable/httpapi";
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Metric,
  Option,
  Predicate,
  Ref,
  Scope,
  SubscriptionRef,
} from "effect";
import {
  RateLimitExceeded,
  RateLimiter as RateLimiterTag,
  RateLimiterError,
  RateLimiterStore,
  make as makeRateLimiter,
} from "effect/unstable/persistence/RateLimiter";
import type {
  ConsumeResult,
  RateLimiter as EffectRateLimiter,
} from "effect/unstable/persistence/RateLimiter";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../ApiUsageSchema";
import * as Hyperlink from "../Hyperlink";
import * as HttpClientGate from "../HttpClientGate";
import {
  ensureClientUsage,
  recordEndpointUsage as recordRegistryUsage,
  usageEnter,
  usageExit,
} from "./apiUsageRegistry";
import {
  gateRateLimiterLayer,
  makeRunnerFromConcurrency,
  type GateRateLimitOptions,
  type GateRunner,
} from "./gate";
import {
  assertNoMetricsKeyCollision,
  buildHttpApiClientSpec,
  httpApiMetricsNestSpec,
  MetricsKeyCollision,
} from "./httpApiClientSpec";
import { stampGateMetricsMetadata } from "./gateTagSchemas";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Configuration for {@link HttpApiClient.make} / {@link HttpApiClient.Service}.
 *
 * @category models
 * @public
 */
export interface HttpApiClientConfig<
  _ApiId extends string,
  _Groups extends HttpApiGroup.Constraint,
  Name extends string = string,
> {
  readonly name: Name;
  readonly baseUrl?: URL | string | undefined;
  readonly transformClient?:
    | ((client: HttpClient.HttpClient) => HttpClient.HttpClient)
    | undefined;
  readonly transformResponse?:
    | ((effect: Effect.Effect<unknown, unknown, unknown>) => Effect.Effect<unknown, unknown, unknown>)
    | undefined;
  readonly concurrency?: number;
}

/**
 * Configuration for {@link HttpApiClient.layerEffect}.
 *
 * @category models
 * @public
 */
export interface HttpApiClientLayerEffectConfig<
  ApiId extends string = string,
  Groups extends HttpApiGroup.Constraint = HttpApiGroup.Top,
> {
  readonly concurrency?: number;
  /**
   * When set, endpoint usage metrics and registry hooks are applied to the built client
   * (same as {@link instrumentEndpoints}).
   */
  readonly api?: HttpApiType.HttpApi<ApiId, Groups>;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * `Accept: application/json` header on every request.
 *
 * @category combinators
 * @public
 */
export const acceptJson = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
): HttpClient.HttpClient.With<E, R> =>
  client.pipe(
    HttpClient.mapRequest(HttpClientRequest.setHeader("Accept", "application/json")),
  );

type EndpointLabels = {
  readonly client: string;
  readonly group: string;
  readonly endpoint: string;
};

const failureLabel = (cause: Cause.Cause<unknown>): string => {
  const squashed = Cause.squash(cause);
  if (Predicate.hasProperty(squashed, "_tag") && typeof squashed._tag === "string") {
    return squashed._tag;
  }
  return "Failure";
};

// ============================================================================
// Metrics
// ============================================================================

const latencyBoundaries = Metric.exponentialBoundaries({ start: 1, factor: 2, count: 12 });

const makeEndpointMetrics = (clientId: string) => ({
  requests: Metric.counter("httpapi_endpoint_requests_total", {
    incremental: true,
    description: "HttpApi endpoint invocations by outcome",
    attributes: { client: clientId },
  }),
  errors: Metric.counter("httpapi_endpoint_errors_total", {
    incremental: true,
    description: "HttpApi endpoint failures by error tag",
    attributes: { client: clientId },
  }),
  duration: Metric.histogram("httpapi_endpoint_duration_ms", {
    description: "HttpApi endpoint call duration in milliseconds",
    attributes: { client: clientId },
    boundaries: latencyBoundaries,
  }),
});

const recordMetricUsage = (
  exit: Exit.Exit<unknown, unknown>,
  durationMs: number,
  labels: EndpointLabels,
  metrics: ReturnType<typeof makeEndpointMetrics>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const base = { group: labels.group, endpoint: labels.endpoint };
    const outcome = Exit.isFailure(exit) ? "error" : "success";
    yield* Metric.update(Metric.withAttributes(metrics.requests, { ...base, outcome }), 1);
    yield* Metric.update(Metric.withAttributes(metrics.duration, base), durationMs);
    if (Exit.isFailure(exit)) {
      yield* Metric.update(
        Metric.withAttributes(metrics.errors, { ...base, error: failureLabel(exit.cause) }),
        1,
      );
    }
  });

const wrapEndpointCall = <
  A,
  E,
  R,
  Fn extends (...args: Array<never>) => Effect.Effect<A, E, R>,
>(
  call: Fn,
  labels: EndpointLabels,
  metrics: ReturnType<typeof makeEndpointMetrics>,
): Fn => {
  const wrapped = (...args: Parameters<Fn>) =>
    Effect.gen(function* () {
      yield* usageEnter(labels.client);
      const start = yield* Clock.currentTimeMillis;
      const exit = yield* Effect.exit(call(...args));
      const duration = (yield* Clock.currentTimeMillis) - start;
      yield* usageExit(labels.client);
      yield* recordMetricUsage(exit, duration, labels, metrics);
      yield* recordRegistryUsage(labels.client, {
        group: labels.group,
        endpoint: labels.endpoint,
        outcome: Exit.isFailure(exit) ? "error" : "success",
        durationMs: duration,
        ...(Exit.isFailure(exit) ? { error: failureLabel(exit.cause) } : {}),
      });
      return yield* Exit.match(exit, {
        onFailure: Effect.failCause,
        onSuccess: Effect.succeed,
      });
    });
  return wrapped as Fn;
};

/**
 * Wrap every endpoint on a built HttpApi client with usage metrics and registry hooks.
 *
 * @category combinators
 * @public
 */
export const instrumentEndpoints = <
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApiType.HttpApi<ApiId, Groups>,
  client: EffectHttpApiClient.Client<Groups>,
  clientId: string,
): void => {
  const metrics = makeEndpointMetrics(clientId);
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint({ group, endpoint }) {
      const bucket: Record<string, unknown> | undefined = group.topLevel
        ? (client as Record<string, unknown>)
        : (client as Record<string, Record<string, unknown>>)[group.identifier];
      if (bucket === undefined) {
        return;
      }
      const original = bucket[endpoint.identifier];
      if (typeof original !== "function") {
        return;
      }
      bucket[endpoint.identifier] = wrapEndpointCall(
        original as (...args: Array<never>) => Effect.Effect<unknown, unknown, unknown>,
        { client: clientId, group: group.identifier, endpoint: endpoint.identifier },
        metrics,
      );
    },
  });
};

type InFlightTransform = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
) => HttpClient.HttpClient.With<E, R>;

const makeInFlightTransform = (
  clientId: string,
): Effect.Effect<InFlightTransform, never, never> =>
  Effect.gen(function* () {
    const inFlightRef = yield* Ref.make(0);
    const inFlightGauge = Metric.gauge("httpapi_in_flight", {
      description: "HTTP round-trips currently in flight for this client tag",
      attributes: { client: clientId },
    });

    return <E, R>(client: HttpClient.HttpClient.With<E, R>) =>
      HttpClient.transform(client, (effect, _request) =>
        Effect.gen(function* () {
          yield* Metric.update(
            inFlightGauge,
            yield* Ref.updateAndGet(inFlightRef, (n) => n + 1),
          );
          const exit = yield* Effect.exit(effect);
          yield* Metric.update(
            inFlightGauge,
            yield* Ref.updateAndGet(inFlightRef, (n) => Math.max(0, n - 1)),
          );
          return yield* Exit.match(exit, {
            onFailure: Effect.failCause,
            onSuccess: Effect.succeed,
          });
        }),
      );
  });

// ============================================================================
// Internal: build the runner from concurrency config
// ============================================================================

const applyTransportMiddleware = (
  client: HttpClient.HttpClient,
  options: {
    readonly runner: GateRunner;
    readonly withInFlight: InFlightTransform;
    readonly transformClient?: HttpApiClientConfig<string, HttpApiGroup.Top, string>["transformClient"];
  },
): HttpClient.HttpClient => {
  const userTransformed =
    options.transformClient !== undefined ? options.transformClient(client) : client;
  const gated = HttpClientGate.withRunner(options.runner)(userTransformed);
  return options.withInFlight(gated);
};

const maybeInstrumentEndpoints = <
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
  Service,
>(
  service: Service,
  clientId: string,
  api: HttpApiType.HttpApi<ApiId, Groups> | undefined,
): Service => {
  if (api !== undefined) {
    instrumentEndpoints(api, service as EffectHttpApiClient.Client<Groups>, clientId);
  }
  return service;
};

const buildLayer = <
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
  Name extends string,
  Self,
>(
  tag: Context.Key<Self, EffectHttpApiClient.Client<Groups>>,
  api: HttpApiType.HttpApi<ApiId, Groups>,
  config: HttpApiClientConfig<ApiId, Groups, Name>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const clientId = config.name;
      yield* ensureClientUsage(clientId);
      const runner = yield* makeRunnerFromConcurrency(config.concurrency);
      const withInFlight = yield* makeInFlightTransform(clientId);

      const client = yield* EffectHttpApiClient.make(api, {
        baseUrl: config.baseUrl,
        transformClient: (c) =>
          applyTransportMiddleware(c, {
            runner,
            withInFlight,
            transformClient: config.transformClient,
          }),
        transformResponse: config.transformResponse,
      });

      instrumentEndpoints(api, client, clientId);
      return Layer.succeed(tag, client);
    }),
  );

function makeHttpApiClient<
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
  Name extends string,
>(
  api: HttpApiType.HttpApi<ApiId, Groups>,
  config: HttpApiClientConfig<ApiId, Groups, Name>,
) {
  type ClientShape = EffectHttpApiClient.Client<Groups>;

  // @effect-diagnostics-next-line serviceNotAsClass:off
  const tag = Context.Service<ClientShape>(config.name);
  const layer = buildLayer(tag, api, config);

  return Object.assign(tag, { layer });
}

const httpApiResourceService = <Self>() =>
  <
    ApiId extends string,
    Groups extends HttpApiGroup.Constraint,
    const Name extends string,
  >(
    name: Name,
    api: HttpApiType.HttpApi<ApiId, Groups>,
    config?: Omit<HttpApiClientConfig<ApiId, Groups, Name>, "name">,
  ): Context.ServiceClass<Self, Name, EffectHttpApiClient.Client<Groups>> & {
    readonly layer: Layer.Layer<Self, never, HttpClient.HttpClient | Scope.Scope>;
  } => {
    type ClientShape = EffectHttpApiClient.Client<Groups>;
    const fullConfig = { ...config, name } as HttpApiClientConfig<ApiId, Groups, Name>;
    const Base = Context.Service<Self, ClientShape>()(name);
    const layer = buildLayer(Base, api, fullConfig);
    return class extends Base {
      static readonly layer = layer;
    } as Context.ServiceClass<Self, Name, ClientShape> & {
      readonly layer: Layer.Layer<Self, never, HttpClient.HttpClient | Scope.Scope>;
    };
  };

function layerEffect<
  Service,
  Identifier,
  Error,
  Requirements,
  ApiId extends string = string,
  Groups extends HttpApiGroup.Constraint = HttpApiGroup.Top,
>(
  tag: Context.Key<Identifier, Service>,
  effect: Effect.Effect<Service, Error, Requirements>,
  config: HttpApiClientLayerEffectConfig<ApiId, Groups> = {},
) {
  const clientId = String(tag.key);
  return Layer.unwrap(
    Effect.gen(function* () {
      yield* ensureClientUsage(clientId);
      const runner = yield* makeRunnerFromConcurrency(config.concurrency);
      const withInFlight = yield* makeInFlightTransform(clientId);
      const httpClient = yield* HttpClient.HttpClient;
      const instrumented = applyTransportMiddleware(httpClient, {
        runner,
        withInFlight,
      });
      const service = yield* effect.pipe(
        Effect.provideService(HttpClient.HttpClient, instrumented),
      );
      return Layer.succeed(tag, maybeInstrumentEndpoints(service, clientId, config.api));
    }),
  );
}

// ============================================================================
// Public API
// ============================================================================

// HttpApiClient namespace — typed HTTP API client with transport gating. The module
// is the namespace (`import * as HttpApiClient`): each entry point is a flat top-level
// export (`acceptJson` / `instrumentEndpoints` are declared above), so a partial import
// tree-shakes the unused builders out.

/**
 * Class factory: declare a typed HttpApi client with a baked-in `.layer`.
 *
 * @example
 * ```ts
 * class MyClient extends HttpApiClient.Service<MyClient>()("@app/MyClient", MyApi, {
 *   baseUrl: "https://api.example.com",
 *   concurrency: 5,
 * }) {}
 * const client = yield* MyClient
 * ```
 *
 * @category constructors
 * @public
 */
export const Service = httpApiResourceService;

/**
 * Functional equivalent of {@link Service} — returns a tag value with `.layer`.
 *
 * @category constructors
 * @public
 */
export const make = makeHttpApiClient;

export { layerEffect };

// ============================================================================
// R4 — Gate.HttpApiClient Tag (Hyperlink) + app-owned layer
// ============================================================================

/** Kind stamped on {@link HttpApiClient} Tags for dashboard classification. @public */
export const httpApiClientKind = "hyperlink-ts/Gate/HttpApiClient";

/**
 * Mint-time options for {@link HttpApiClient} (policy + nest key). Runtime URL /
 * transforms go on {@link httpApiClientLayer}.
 *
 * @category models
 * @public
 */
export interface HttpApiClientTagConfig {
  readonly concurrency?: number;
  readonly rateLimit?: GateRateLimitOptions;
  /** Const nest path — default `"metrics"`. Must not collide with an HttpApi group id. */
  readonly metricsKey?: string;
  readonly description?: string;
  /** Usage window cadence (absorbed ApiMetrics). @default 5 seconds */
  readonly windowMs?: Duration.Input;
}

/**
 * Runtime options for {@link httpApiClientLayer}.
 *
 * @category models
 * @public
 */
export interface HttpApiClientRuntimeConfig {
  readonly baseUrl?: URL | string | undefined;
  readonly transformClient?:
    | ((client: HttpClient.HttpClient) => HttpClient.HttpClient)
    | undefined;
  readonly transformResponse?:
    | ((effect: Effect.Effect<unknown, unknown, unknown>) => Effect.Effect<unknown, unknown, unknown>)
    | undefined;
  readonly windowMs?: Duration.Input;
}

/** Limiter + usage nest on an HttpApiClient handle. @public */
export interface HttpApiClientMetrics {
  readonly remaining: Hyperlink.Subscribable<number>;
  readonly resetAfter: Hyperlink.Subscribable<number>;
  readonly exceeded: Hyperlink.Subscribable<number>;
  readonly usage: Hyperlink.Subscribable<ApiUsageSnapshot>;
  readonly windows: import("effect").Stream.Stream<ApiUsageMetrics>;
}

type HttpApiClientShape<Groups extends HttpApiGroup.Constraint, MK extends string> =
  EffectHttpApiClient.Client<Groups> & { readonly [K in MK]: HttpApiClientMetrics };

/** Stamped mint config on an {@link HttpApiClient} Tag. @internal */
const tagConfigSym: unique symbol = Symbol.for(
  "hyperlink-ts/Gate/HttpApiClient/tagConfig",
);

type StampedHttpApiClientTag<
  Self,
  Groups extends HttpApiGroup.Constraint,
  MK extends string,
> = Hyperlink.HyperlinkTag<Self, Hyperlink.Spec, HttpApiClientShape<Groups, MK>> & {
  readonly [tagConfigSym]: {
    readonly api: HttpApiType.HttpApi<string, Groups>;
    readonly concurrency: number | undefined;
    readonly rateLimit: GateRateLimitOptions | undefined;
    readonly metricsKey: MK;
    readonly windowMs: Duration.Input | undefined;
  };
};

const isRateLimitExceededReason = (
  reason: RateLimiterError["reason"],
): reason is RateLimitExceeded => reason._tag === "RateLimitExceeded";

const resolveLimiter = (): Effect.Effect<
  EffectRateLimiter,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const limiterOpt = yield* Effect.serviceOption(RateLimiterTag);
    if (Option.isSome(limiterOpt)) return limiterOpt.value;
    const storeOpt = yield* Effect.serviceOption(RateLimiterStore);
    if (Option.isSome(storeOpt)) {
      return yield* makeRateLimiter.pipe(
        Effect.provideService(RateLimiterStore, storeOpt.value),
      );
    }
    const ctx = yield* Layer.build(gateRateLimiterLayer);
    return Context.get(ctx, RateLimiterTag);
  });

const makeLimiterPublisher = (
  remainingRef: SubscriptionRef.SubscriptionRef<number>,
  resetAfterRef: SubscriptionRef.SubscriptionRef<number>,
  exceededRef: SubscriptionRef.SubscriptionRef<number>,
) => ({
  publishConsume: (result: ConsumeResult) =>
    Effect.gen(function* () {
      yield* SubscriptionRef.set(remainingRef, result.remaining);
      yield* SubscriptionRef.set(
        resetAfterRef,
        Duration.toMillis(result.resetAfter),
      );
    }),
  publishExceeded: (remaining: number, resetAfterMs: number) =>
    Effect.gen(function* () {
      yield* SubscriptionRef.set(remainingRef, remaining);
      yield* SubscriptionRef.set(resetAfterRef, resetAfterMs);
      yield* SubscriptionRef.update(exceededRef, (n) => n + 1);
    }),
});

/**
 * Wrap a transport runner so each HTTP round-trip consumes the whole-client
 * rateLimit budget before the concurrency semaphore.
 */
const withRateLimitRunner = (
  runner: GateRunner,
  rateLimit: GateRateLimitOptions | undefined,
  resourceId: string,
  publisher: ReturnType<typeof makeLimiterPublisher>,
): Effect.Effect<GateRunner, never, Scope.Scope> => {
  if (rateLimit === undefined) return Effect.succeed(runner);
  return Effect.gen(function* () {
    const limiter = yield* resolveLimiter();
    const options = {
      ...rateLimit,
      key: rateLimit.key ?? resourceId,
      onExceeded: rateLimit.onExceeded ?? ("delay" as const),
    };
    // GateRunner erases RateLimiterError; it still surfaces on the HTTP execute channel.
    const gated = (<A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | RateLimiterError, R> => {
      const consume =
        options.onExceeded === "fail"
          ? limiter.consume(options).pipe(
              Effect.flatMap((result) => publisher.publishConsume(result)),
              Effect.catchTag("RateLimiterError", (error) =>
                Effect.gen(function* () {
                  if (isRateLimitExceededReason(error.reason)) {
                    yield* publisher.publishExceeded(
                      error.reason.remaining,
                      Duration.toMillis(error.reason.retryAfter),
                    );
                  }
                  return yield* error;
                }),
              ),
            )
          : Effect.gen(function* () {
              const result = yield* limiter.consume(options);
              yield* publisher.publishConsume(result);
              if (!Duration.isZero(result.delay)) {
                yield* publisher.publishExceeded(
                  result.remaining,
                  Duration.toMillis(result.resetAfter),
                );
                yield* Effect.sleep(result.delay);
              }
            });
      return consume.pipe(Effect.andThen(runner(effect)));
    }) as GateRunner;
    return gated;
  });
};

/**
 * Class factory: Hyperlink Tag for an HttpApi client — **no baked `.layer`**.
 * Pair with {@link httpApiClientLayer}.
 *
 * @category constructors
 * @public
 */
export const HttpApiClient = <Self>() =>
  <
    ApiId extends string,
    Groups extends HttpApiGroup.Constraint,
    const Name extends string,
    const MK extends string = "metrics",
  >(
    key: Name,
    api: HttpApiType.HttpApi<ApiId, Groups>,
    config: HttpApiClientTagConfig & { readonly metricsKey?: MK } = {},
  ): StampedHttpApiClientTag<Self, Groups, MK> => {
    const metricsKey = (config.metricsKey ?? "metrics") as MK;
    assertNoMetricsKeyCollision(api, metricsKey);
    const spec = buildHttpApiClientSpec(api, metricsKey);
    // Licensed boundary: reflect-built Spec matches Client locals + nest — see
    // test/gate-http-api-client.test-d.ts.
    const tag = Hyperlink.Tag<Self, HttpApiClientShape<Groups, MK>>()(
      key,
      spec as never,
      { kind: httpApiClientKind, description: config.description },
    );
    const stamped = stampGateMetricsMetadata(tag, {
      metricsKey,
      rateLimitKey:
        config.rateLimit === undefined
          ? undefined
          : (config.rateLimit.key ?? key),
    });
    return Object.assign(stamped, {
      [tagConfigSym]: {
        api,
        concurrency: config.concurrency,
        rateLimit: config.rateLimit,
        metricsKey,
        windowMs: config.windowMs,
      },
    }) as unknown as StampedHttpApiClientTag<Self, Groups, MK>;
  };

/**
 * App-owned layer for a {@link HttpApiClient} Tag — builds the gated client and
 * fills the metrics nest (limiter + absorbed usage).
 *
 * @category layers & serving
 * @public
 */
export const httpApiClientLayerForTag = <
  Self,
  Groups extends HttpApiGroup.Constraint,
  MK extends string,
>(
  tag: StampedHttpApiClientTag<Self, Groups, MK>,
  runtime: HttpApiClientRuntimeConfig = {},
): Layer.Layer<Self, never, HttpClient.HttpClient> => {
  const mint = tag[tagConfigSym];
  const clientId = String(tag.key);
  const metricsKey = mint.metricsKey;
  // Licensed boundary: reflect Spec + Client shape — see test/gate-http-api-client.test-d.ts.
  return Hyperlink.layer(
    tag as unknown as Hyperlink.HyperlinkTag<Self, Hyperlink.Spec>,
    Effect.gen(function* () {
      const windowMs = runtime.windowMs ?? mint.windowMs;
      const sink = yield* ensureClientUsage(
        clientId,
        windowMs === undefined
          ? undefined
          : { windowMs: Duration.fromInputUnsafe(windowMs) },
      );
      const initialRemaining =
        mint.rateLimit === undefined ? 0 : mint.rateLimit.limit;
      const remainingRef = yield* SubscriptionRef.make(initialRemaining);
      const resetAfterRef = yield* SubscriptionRef.make(0);
      const exceededRef = yield* SubscriptionRef.make(0);
      const publisher = makeLimiterPublisher(
        remainingRef,
        resetAfterRef,
        exceededRef,
      );

      const baseRunner = yield* makeRunnerFromConcurrency(mint.concurrency);
      const runner = yield* withRateLimitRunner(
        baseRunner,
        mint.rateLimit,
        clientId,
        publisher,
      );
      const withInFlight = yield* makeInFlightTransform(clientId);

      const client = yield* EffectHttpApiClient.make(mint.api, {
        baseUrl: runtime.baseUrl,
        transformClient: (c) =>
          applyTransportMiddleware(c, {
            runner,
            withInFlight,
            transformClient: runtime.transformClient,
          }),
        transformResponse: runtime.transformResponse,
      });
      instrumentEndpoints(mint.api, client, clientId);

      const metricsNest: HttpApiClientMetrics = {
        remaining: Hyperlink.subscribable(remainingRef),
        resetAfter: Hyperlink.subscribable(resetAfterRef),
        exceeded: Hyperlink.subscribable(exceededRef),
        usage: sink.usage,
        windows: sink.metrics,
      };

      return {
        ...(client as object),
        [metricsKey]: metricsNest,
      } as never;
    }),
  ) as unknown as Layer.Layer<Self, never, HttpClient.HttpClient>;
};

/** @alias {@link httpApiClientLayerForTag} — public Gate name. */
export const httpApiClientLayer = httpApiClientLayerForTag;

export { MetricsKeyCollision, httpApiMetricsNestSpec };
