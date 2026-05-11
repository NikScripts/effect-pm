/**
 * **HttpApiResource** — {@link HttpApiClient.make} with the same **transport gate** as
 * {@link RunResource} (concurrency + optional start throttle on every `execute`).
 *
 * @remarks
 * - **Why a gate on the client** — `HttpClient.transform` wraps the full request effect,
 *   unlike `transformResponse`, which only sees decode steps after the wire call.
 * - **Tag shape** — {@link HttpApiResource.make} returns a {@link Context.Service} tag for
 *   `HttpApiClient.Client<Groups>` plus a `.layer` built under `HttpClient.HttpClient` in
 *   context.
 * - **Existing clients** — {@link HttpApiResource.layerEffect} reuses that pipeline for any
 *   effect that already produces your API client type.
 *
 * @module HttpApiResource
 */

import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import type { HttpApi as HttpApiType, HttpApiGroup } from "effect/unstable/httpapi";
import { Context, Effect, Layer } from "effect";
import type { RunResourceLimits, RunResourceRunner } from "./RunResource";
import { makeRunResourceWrap } from "./RunResource";
import { HttpClientRunGate } from "./HttpClientRunGate";

/**
 * Client options passed through to {@link HttpApiClient.make} (except `httpClient`, which
 * comes from context).
 *
 * @public
 */
export type HttpApiResourceClientOptions = {
  readonly baseUrl?: URL | string | undefined;
  readonly transformClient?:
    | ((client: HttpClient.HttpClient) => HttpClient.HttpClient)
    | undefined;
  readonly transformResponse?:
    | ((
        effect: Effect.Effect<unknown, unknown, unknown>
      ) => Effect.Effect<unknown, unknown, unknown>)
    | undefined;
};

/**
 * Options for {@link HttpApiResource.make} (stable service key + client options + limits).
 *
 * @public
 */
export type HttpApiResourceMakeConfig<
  _ApiId extends string,
  _Groups extends HttpApiGroup.Any,
  Name extends string = string,
> = {
  /**
   * Context tag id (service key). Required because `HttpApi`’s runtime `identifier`
   * may be unset in some builds; use a stable string (often derived from your API name).
   */
  readonly name: Name;
  readonly client: HttpApiResourceClientOptions;
  readonly limits?: RunResourceLimits;
};

/**
 * Config for wrapping an existing client-building effect with the same transport gate
 * used by {@link HttpApiResource.make}.
 *
 * @public
 */
export type HttpApiResourceLayerEffectConfig = {
  readonly limits?: RunResourceLimits;
};

/**
 * `Accept: application/json` on every request. Use inside `transformClient` or pipe a client.
 *
 * @public
 */
export const acceptJson = <E, R>(
  client: HttpClient.HttpClient.With<E, R>
): HttpClient.HttpClient.With<E, R> =>
  client.pipe(
    HttpClient.mapRequest(HttpClientRequest.setHeader("Accept", "application/json"))
  );

const makeRunner = (
  limits: RunResourceLimits | undefined
): Effect.Effect<RunResourceRunner, never, never> =>
  Effect.map(makeRunResourceWrap(limits), (wrap) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) => wrap(effect)
  );

/**
 * Layer helper: acquire `HttpClient`, wrap it with the runner from `config.limits`, then run
 * `effect` with the gated client provided as `HttpClient.HttpClient`.
 *
 * @internal
 */
function layerEffect<
  Service,
  Identifier,
  Error,
  Requirements,
>(
  tag: Context.Key<Identifier, Service>,
  effect: Effect.Effect<Service, Error, Requirements>,
  config: HttpApiResourceLayerEffectConfig = {}
){
  return Layer.effect(tag)(
    Effect.gen(function* () {
      const runner = yield* makeRunner(config.limits);
      const httpClient = yield* HttpClient.HttpClient;
      const gatedHttpClient = HttpClientRunGate.withRunner(runner)(httpClient);
      return yield* effect.pipe(
        Effect.provideService(HttpClient.HttpClient, gatedHttpClient)
      );
    })
  );
}

/**
 * Construct a {@link Context.Service} tag and `Layer.effect` for `HttpApiClient.make`.
 *
 * @internal
 */
function makeHttpApiResource<
  ApiId extends string,
  Groups extends HttpApiGroup.Any,
  Name extends string,
>(api: HttpApiType.HttpApi<ApiId, Groups>, config: HttpApiResourceMakeConfig<ApiId, Groups, Name>) {
  const tagId = config.name;

  type ClientShape = HttpApiClient.Client<Groups>;

  const HttpApiResourceTag = Context.Service<ClientShape>(tagId);

  const layer = layerEffect(
    HttpApiResourceTag,
    Effect.gen(function* () {
      const runner = yield* makeRunner(config.limits);
      const userTc = config.client.transformClient;
      return yield* HttpApiClient.make(api, {
        baseUrl: config.client.baseUrl,
        transformClient: (c) => {
          const client = userTc === undefined ? c : userTc(c);
          return HttpClientRunGate.withRunner(runner)(client);
        },
        transformResponse: config.client.transformResponse,
      });
    })
  );

  return Object.assign(HttpApiResourceTag, { layer });
}

/**
 * Factories for typed HTTP API clients with optional {@link RunResourceLimits}.
 *
 * @public
 */
export const HttpApiResource = {
  /** Typed `HttpApiClient` tag + `.layer` (see {@link makeHttpApiResource}). */
  make: makeHttpApiResource,
  /** Apply the same transport gate to an arbitrary client-producing effect. */
  layerEffect,
  /** Request header helper for JSON APIs. */
  acceptJson,
} as const;
