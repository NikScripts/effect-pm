/**
 * HttpApiResource — typed HTTP API client with transport-level concurrency gating.
 *
 * Wraps Effect's `HttpApiClient.make` with a `Semaphore`-based concurrency gate
 * on the `HttpClient` transport layer (via `HttpClientRunGate.withRunner` applied to
 * `HttpClient.transform`).
 *
 * ## Node usage metrics
 *
 * Each schema endpoint is wrapped via `HttpApi.reflect` after the client is built.
 * Labels use stable schema names (not raw URLs):
 *
 * | Metric | Type | Labels | What it measures |
 * |--------|------|--------|------------------|
 * | `httpapi_endpoint_requests_total` | counter | `client`, `group`, `endpoint`, `outcome` | Invocations (`outcome`: `success` \| `error`) |
 * | `httpapi_endpoint_errors_total` | counter | `client`, `group`, `endpoint`, `error` | Failures by tagged error (`_tag` or `Failure`) |
 * | `httpapi_endpoint_duration_ms` | histogram (ms) | `client`, `group`, `endpoint` | Wall time per endpoint call |
 *
 * Usage windows for {@link ApiMetrics} are fed from the same dispatch hook.
 *
 * ### Transport (secondary)
 *
 * `httpapi_in_flight` (gauge, label `client`) — concurrent HTTP round-trips.
 *
 * ## Entry points
 *
 * | Function | Purpose |
 * |----------|---------|
 * | `HttpApiResource.Service` | Class factory: tag + baked-in `.layer` |
 * | `HttpApiResource.make` | Functional tag + `.layer` from an HttpApi schema |
 * | `HttpApiResource.layerEffect` | Gate an existing client-building effect |
 * | `HttpApiResource.instrumentEndpoints` | Wrap client after custom build |
 * | `HttpApiResource.acceptJson` | `Accept: application/json` header helper |
 *
 * @module HttpApiResource
 */

import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApi, HttpApiClient } from "effect/unstable/httpapi";
import type { HttpApi as HttpApiType, HttpApiGroup } from "effect/unstable/httpapi";
import { Cause, Clock, Context, Effect, Exit, Layer, Metric, Predicate, Ref, Scope, Semaphore } from "effect";
import * as HttpClientRunGate from "./HttpClientRunGate";
import {
  ensureClientUsage,
  recordEndpointUsage as recordRegistryUsage,
  usageEnter,
  usageExit,
} from "./internal/apiUsageRegistry";
import type { RunResourceRunner } from "./RunResource";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Configuration for {@link HttpApiResource.make} / {@link HttpApiResource.Service}.
 *
 * @public
 */
export interface HttpApiResourceConfig<
  _ApiId extends string,
  _Groups extends HttpApiGroup.Any,
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
 * Configuration for {@link HttpApiResource.layerEffect}.
 *
 * @public
 */
export interface HttpApiResourceLayerEffectConfig<
  ApiId extends string = string,
  Groups extends HttpApiGroup.Any = HttpApiGroup.Any,
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

const wrapEndpointCall = <Fn extends (...args: Array<never>) => Effect.Effect<unknown, unknown, unknown>>(
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
 * @public
 */
export const instrumentEndpoints = <
  ApiId extends string,
  Groups extends HttpApiGroup.Any,
>(
  api: HttpApiType.HttpApi<ApiId, Groups>,
  client: HttpApiClient.Client<Groups>,
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
      const original = bucket[endpoint.name];
      if (typeof original !== "function") {
        return;
      }
      bucket[endpoint.name] = wrapEndpointCall(
        original as (...args: Array<never>) => Effect.Effect<unknown, unknown, unknown>,
        { client: clientId, group: group.identifier, endpoint: endpoint.name },
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

const makeRunnerFromConcurrency = (
  concurrency: number | undefined,
): Effect.Effect<RunResourceRunner, never, never> =>
  concurrency === undefined
    ? Effect.succeed(<A, E, R>(effect: Effect.Effect<A, E, R>) => effect)
    : Effect.map(
        Semaphore.make(concurrency),
        (sem): RunResourceRunner =>
          <A, E, R>(effect: Effect.Effect<A, E, R>) => sem.withPermits(1)(effect),
      );

const applyTransportMiddleware = (
  client: HttpClient.HttpClient,
  options: {
    readonly runner: RunResourceRunner;
    readonly withInFlight: InFlightTransform;
    readonly transformClient?: HttpApiResourceConfig<string, HttpApiGroup.Any, string>["transformClient"];
  },
): HttpClient.HttpClient => {
  const userTransformed =
    options.transformClient !== undefined ? options.transformClient(client) : client;
  const gated = HttpClientRunGate.withRunner(options.runner)(userTransformed);
  return options.withInFlight(gated);
};

const maybeInstrumentEndpoints = <
  ApiId extends string,
  Groups extends HttpApiGroup.Any,
  Service,
>(
  service: Service,
  clientId: string,
  api: HttpApiType.HttpApi<ApiId, Groups> | undefined,
): Service => {
  if (api !== undefined) {
    instrumentEndpoints(api, service as HttpApiClient.Client<Groups>, clientId);
  }
  return service;
};

const buildLayer = <
  ApiId extends string,
  Groups extends HttpApiGroup.Any,
  Name extends string,
  Self,
>(
  tag: Context.Key<Self, HttpApiClient.Client<Groups>>,
  api: HttpApiType.HttpApi<ApiId, Groups>,
  config: HttpApiResourceConfig<ApiId, Groups, Name>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const clientId = config.name;
      yield* ensureClientUsage(clientId);
      const runner = yield* makeRunnerFromConcurrency(config.concurrency);
      const withInFlight = yield* makeInFlightTransform(clientId);

      const client = yield* HttpApiClient.make(api, {
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

function makeHttpApiResource<
  ApiId extends string,
  Groups extends HttpApiGroup.Any,
  Name extends string,
>(
  api: HttpApiType.HttpApi<ApiId, Groups>,
  config: HttpApiResourceConfig<ApiId, Groups, Name>,
) {
  type ClientShape = HttpApiClient.Client<Groups>;

  const tag = Context.Service<ClientShape>(config.name);
  const layer = buildLayer(tag, api, config);

  return Object.assign(tag, { layer });
}

const httpApiResourceService = <Self>() =>
  <
    ApiId extends string,
    Groups extends HttpApiGroup.Any,
    const Name extends string,
  >(
    name: Name,
    api: HttpApiType.HttpApi<ApiId, Groups>,
    config?: Omit<HttpApiResourceConfig<ApiId, Groups, Name>, "name">,
  ): Context.ServiceClass<Self, Name, HttpApiClient.Client<Groups>> & {
    readonly layer: Layer.Layer<Self, never, HttpClient.HttpClient | Scope.Scope>;
  } => {
    type ClientShape = HttpApiClient.Client<Groups>;
    const fullConfig = { ...config, name } as HttpApiResourceConfig<ApiId, Groups, Name>;
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
  Groups extends HttpApiGroup.Any = HttpApiGroup.Any,
>(
  tag: Context.Key<Identifier, Service>,
  effect: Effect.Effect<Service, Error, Requirements>,
  config: HttpApiResourceLayerEffectConfig<ApiId, Groups> = {},
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

// HttpApiResource namespace — typed HTTP API client with transport gating. The module
// is the namespace (`import * as HttpApiResource`): each entry point is a flat top-level
// export (`acceptJson` / `instrumentEndpoints` are declared above), so a partial import
// tree-shakes the unused builders out.

/**
 * Class factory: declare a typed HttpApi client with a baked-in `.layer`.
 *
 * @example
 * ```ts
 * class MyClient extends HttpApiResource.Service<MyClient>()("@app/MyClient", MyApi, {
 *   baseUrl: "https://api.example.com",
 *   concurrency: 5,
 * }) {}
 * const client = yield* MyClient
 * ```
 *
 * @public
 */
export const Service = httpApiResourceService;

/**
 * Functional equivalent of {@link Service} — returns a tag value with `.layer`.
 *
 * @public
 */
export const make = makeHttpApiResource;

export { layerEffect };
