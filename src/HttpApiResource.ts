/**
 * HttpApiResource — typed HTTP API client with transport-level concurrency gating.
 *
 * Wraps Effect's `HttpApiClient.make` with a `Semaphore`-based concurrency gate
 * on the `HttpClient` transport layer (via `HttpClient.transform`). This limits
 * how many concurrent HTTP requests can be in-flight through this client.
 *
 * ## Entry points
 *
 * | Function | Purpose |
 * |----------|---------|
 * | `HttpApiResource.make` | Build a tag + `.layer` from an HttpApi schema |
 * | `HttpApiResource.layerEffect` | Gate an existing client-building effect |
 * | `HttpApiResource.acceptJson` | `Accept: application/json` header helper |
 *
 * ## Usage
 *
 * ```ts
 * import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/unstable/httpapi"
 * import { HttpApiResource } from "@nikscripts/effect-pm"
 * import { Schema } from "effect"
 *
 * // Define your API schema
 * const myEndpoint = HttpApiEndpoint.get("getUser", "/users/:id", {
 *   success: Schema.Struct({ name: Schema.String }),
 * })
 * const MyApi = HttpApi.make("my-api").add(HttpApiGroup.make("users").add(myEndpoint))
 *
 * // Create a gated client (max 5 concurrent requests)
 * const MyClient = HttpApiResource.make(MyApi, {
 *   name: "@app/MyClient",
 *   baseUrl: "https://api.example.com",
 *   concurrency: 5,
 * })
 *
 * // Use in program
 * const user = yield* MyClient
 * const result = yield* user.users.getUser({ path: { id: "123" } })
 * ```
 *
 * @module HttpApiResource
 */

import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import type { HttpApi as HttpApiType, HttpApiGroup } from "effect/unstable/httpapi";
import { Context, Effect, Layer, Semaphore } from "effect";
import { HttpClientRunGate } from "./HttpClientRunGate";
import type { RunResourceRunner } from "./RunResourceModule";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Configuration for {@link HttpApiResource.make}.
 *
 * Flat config — no nested objects. `concurrency` controls max in-flight requests.
 *
 * @typeParam ApiId - The HttpApi identifier string
 * @typeParam Groups - The HttpApiGroup types in the API
 * @typeParam Name - String literal service key
 *
 * @public
 */
export interface HttpApiResourceConfig<
  _ApiId extends string,
  _Groups extends HttpApiGroup.Any,
  Name extends string = string,
> {
  /** Context tag id (service key). Use a stable, namespaced string. */
  readonly name: Name;
  /** Base URL for all requests. */
  readonly baseUrl?: URL | string | undefined;
  /**
   * Transform the `HttpClient` before requests. Applied BEFORE the concurrency gate.
   * Use for custom headers, auth injection, request signing, etc.
   */
  readonly transformClient?:
    | ((client: HttpClient.HttpClient) => HttpClient.HttpClient)
    | undefined;
  /**
   * Transform the response effect. Applied after decode.
   * Use for response-level middleware (caching, retry, etc.).
   */
  readonly transformResponse?:
    | ((effect: Effect.Effect<unknown, unknown, unknown>) => Effect.Effect<unknown, unknown, unknown>)
    | undefined;
  /**
   * Max concurrent HTTP requests through this client.
   * When omitted, no concurrency limit is applied (pass-through).
   */
  readonly concurrency?: number;
}

/**
 * Configuration for {@link HttpApiResource.layerEffect}.
 *
 * @public
 */
export interface HttpApiResourceLayerEffectConfig {
  /**
   * Max concurrent HTTP requests. When omitted, no limit.
   */
  readonly concurrency?: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * `Accept: application/json` header on every request.
 * Pipe-friendly: `client.pipe(acceptJson)` or use in `transformClient`.
 *
 * @public
 */
export const acceptJson = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
): HttpClient.HttpClient.With<E, R> =>
  // Apply Accept header to all outgoing requests
  client.pipe(
    HttpClient.mapRequest(HttpClientRequest.setHeader("Accept", "application/json")),
  );

// ============================================================================
// Internal: build the runner from concurrency config
// ============================================================================

/**
 * Build a RunResourceRunner (semaphore gate) from concurrency config.
 * When concurrency is undefined, returns an identity wrapper (no gating).
 */
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

// ============================================================================
// Core: build the HttpApiClient with transport gate
// ============================================================================

/**
 * Internal factory: creates the Context tag and gated Layer for an HttpApi.
 *
 * Pipeline:
 * 1. Allocate concurrency semaphore (if configured)
 * 2. Acquire HttpClient from context
 * 3. Apply user's transformClient (auth, headers, etc.)
 * 4. Apply concurrency gate via HttpClientRunGate
 * 5. Build typed HttpApiClient with the gated transport
 */
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

  const layer = Layer.effect(tag)(
    Effect.gen(function* () {
      // Build the concurrency gate (identity if no limit)
      const runner = yield* makeRunnerFromConcurrency(config.concurrency);

      // Build the typed client with gated transport
      return yield* HttpApiClient.make(api, {
        baseUrl: config.baseUrl,
        transformClient: (c) => {
          // User transform first (auth, headers), then gate wraps the full request
          const userTransformed = config.transformClient !== undefined ? config.transformClient(c) : c;
          return HttpClientRunGate.withRunner(runner)(userTransformed);
        },
        transformResponse: config.transformResponse,
      });
    }),
  );

  return Object.assign(tag, { layer });
}

/**
 * Layer helper: wrap an existing client-building effect with a transport gate.
 *
 * Acquires `HttpClient` from context, applies the concurrency gate, then
 * provides the gated client to `effect` so the resulting typed client
 * uses the shared gate for all requests.
 *
 * @public
 */
function layerEffect<
  Service,
  Identifier,
  Error,
  Requirements,
>(
  tag: Context.Key<Identifier, Service>,
  effect: Effect.Effect<Service, Error, Requirements>,
  config: HttpApiResourceLayerEffectConfig = {},
) {
  return Layer.effect(tag)(
    Effect.gen(function* () {
      // Allocate concurrency gate
      const runner = yield* makeRunnerFromConcurrency(config.concurrency);
      // Get platform HttpClient and wrap with gate
      const httpClient = yield* HttpClient.HttpClient;
      const gatedHttpClient = HttpClientRunGate.withRunner(runner)(httpClient);
      // Run the user's client-building effect with the gated transport
      return yield* effect.pipe(
        Effect.provideService(HttpClient.HttpClient, gatedHttpClient),
      );
    }),
  );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * HttpApiResource namespace — typed HTTP API client with transport gating.
 *
 * @public
 */
export const HttpApiResource = {
  /**
   * Build a typed HttpApiClient tag with `.layer`.
   *
   * The layer requires `HttpClient.HttpClient` in context (provide via
   * `FetchHttpClient.layer` or a test mock).
   *
   * @example
   * ```ts
   * const MyClient = HttpApiResource.make(MyApi, {
   *   name: "@app/MyClient",
   *   baseUrl: "https://api.example.com",
   *   concurrency: 5,
   * })
   * const client = yield* MyClient
   * yield* client.users.getUser({ path: { id: "123" } })
   * ```
   */
  make: makeHttpApiResource,

  /**
   * Wrap an existing client-building effect with a shared transport gate.
   * Useful when you already have a custom `HttpApiClient.make` pipeline.
   *
   * @example
   * ```ts
   * class MyClient extends Context.Service<MyClient, ClientShape>()("@app/MyClient") {}
   * const MyClientLive = HttpApiResource.layerEffect(MyClient, myCustomMakeEffect, {
   *   concurrency: 10,
   * })
   * ```
   */
  layerEffect,

  /**
   * `Accept: application/json` header helper.
   * Use in `transformClient` or pipe directly: `client.pipe(acceptJson)`.
   */
  acceptJson,
} as const;

