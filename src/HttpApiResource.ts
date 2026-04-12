/**
 * Typed {@link HttpApiClient.make} with optional concurrency / throttle on the transport
 * (`HttpClient.transform`), same limits model as {@link RunResource}.
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

function makeHttpApiResource<
  ApiId extends string,
  Groups extends HttpApiGroup.Any,
  Name extends string,
>(
  api: HttpApiType.HttpApi<ApiId, Groups>,
  config: HttpApiResourceMakeConfig<ApiId, Groups, Name>
): Context.Service<
  HttpApiClient.Client<Groups> & { _brand: Name },
  HttpApiClient.Client<Groups>
> & {
  readonly layer: Layer.Layer<
    HttpApiClient.Client<Groups> & { _brand: Name },
    never,
    HttpClient.HttpClient | HttpApiGroup.MiddlewareClient<Groups>
  >;
} {
  const tagId = config.name;

  type ClientShape = HttpApiClient.Client<Groups>;

  const tag = Context.Service<ClientShape & { _brand: Name }, ClientShape>(tagId);

  const layer = layerEffect(
    tag,
    Effect.gen(function* () {
      const runner = yield* makeRunner(config.limits);
      const userTc = config.client.transformClient;
      return yield* HttpApiClient.make(api, {
        baseUrl: config.client.baseUrl,
        transformClient: (c) =>
          HttpClientRunGate.withRunner(runner)(userTc ? userTc(c) : c),
        transformResponse: config.client.transformResponse,
      });
    })
  );

  return Object.assign(tag, { layer });
}

/**
 * @public
 */
export const HttpApiResource = {
  make: makeHttpApiResource,
  layerEffect,
  acceptJson,
} as const;
