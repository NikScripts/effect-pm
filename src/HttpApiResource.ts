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
> = {
  /** Context tag id used for the service key. */
  readonly name: string;
  readonly client: HttpApiResourceClientOptions;
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

function makeHttpApiResource<ApiId extends string, Groups extends HttpApiGroup.Any>(
  api: HttpApiType.HttpApi<ApiId, Groups>,
  config: HttpApiResourceMakeConfig<ApiId, Groups>
) {
  const tagId = config.name;

  type ClientType = HttpApiClient.Client<Groups>;

  const tag = Context.Service<ClientType & { _brand: typeof tagId }, ClientType>(
    tagId
  );

  const layer = Layer.effect(
    tag,
    Effect.gen(function* () {
      const wrap = yield* makeRunResourceWrap(config.limits);
      const runner = wrap as unknown as RunResourceRunner;
      const userTc = config.client.transformClient;
      return (yield* HttpApiClient.make(api, {
        baseUrl: config.client.baseUrl,
        transformClient: (c) =>
          HttpClientRunGate.withRunner(runner)(userTc ? userTc(c) : c),
        transformResponse: config.client.transformResponse,
      })) as ClientType;
    })
  );

  return Object.assign(tag, { layer });
}

/**
 * @public
 */
export const HttpApiResource = {
  make: makeHttpApiResource,
  acceptJson,
} as const;
