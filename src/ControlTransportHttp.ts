/**
 * HTTP adapter for the transport-neutral control protocol.
 *
 * @module ControlTransportHttp
 */

import { Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import {
  ControlResponseSchema,
  ControlTransportClient,
  ControlTransportError,
  type ControlProtocolRequest,
  type ControlProtocolResponse,
  type ControlTransportClientShape,
} from "./ControlProtocol";

/**
 * HTTP transport client configuration.
 *
 * @public
 */
export interface ControlTransportHttpClientConfig {
  readonly baseUrl: string;
}

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}${path}`;

const transportError = (
  reason: string,
  status?: number,
): ControlTransportError =>
  new ControlTransportError({
    reason,
    ...(status === undefined ? {} : { status }),
  });

const transportErrorFromCause = (
  cause: unknown,
  status?: number,
): ControlTransportError => transportError(String(cause), status);

const decodeControlResponse = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<ControlProtocolResponse, ControlTransportError> =>
  HttpClientResponse.schemaBodyJson(ControlResponseSchema)(response).pipe(
    Effect.map(
      (body): ControlProtocolResponse => ({
        _tag: "Control",
        status: response.status,
        body,
      }),
    ),
    Effect.mapError(
      (cause) =>
        transportError(
          `Malformed control response: ${String(cause)}`,
          response.status,
        ),
    ),
  );

const decodeContractResponse = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<ControlProtocolResponse, ControlTransportError> => {
  if (response.status < 200 || response.status >= 300) {
    return Effect.fail(transportError(`HTTP ${response.status}`, response.status));
  }
  return response.json.pipe(
    Effect.map(
      (body): ControlProtocolResponse => ({
        _tag: "Contract",
        status: response.status,
        body,
      }),
    ),
    Effect.mapError(
      (cause) =>
        transportError(
          `Malformed JSON response: ${String(cause)}`,
          response.status,
        ),
    ),
  );
};

interface HttpControlRoute {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly response: "contract" | "control";
}

const routeFor = (request: ControlProtocolRequest): HttpControlRoute => {
  switch (request._tag) {
    case "GetContract":
      return { method: "GET", path: "/contract", response: "contract" };
    case "ReadGroupStatus":
      return { method: "GET", path: "/status", response: "control" };
    case "ListProcesses":
      return { method: "GET", path: "/processes", response: "control" };
    case "ReadProcessStatus":
      return {
        method: "GET",
        path: `/processes/${encodeURIComponent(request.processId)}`,
        response: "control",
      };
    case "StartProcess":
      return {
        method: "POST",
        path: `/processes/${encodeURIComponent(request.processId)}/start`,
        response: "control",
      };
    case "StopProcess":
      return {
        method: "POST",
        path: `/processes/${encodeURIComponent(request.processId)}/stop`,
        response: "control",
      };
    case "RestartProcess":
      return {
        method: "POST",
        path: `/processes/${encodeURIComponent(request.processId)}/restart`,
        response: "control",
      };
    case "RunProcessImmediately":
      return {
        method: "POST",
        path: `/processes/${encodeURIComponent(request.processId)}/now`,
        response: "control",
      };
    case "ListQueues":
      return { method: "GET", path: "/queues", response: "control" };
    case "ReadQueueStatus":
      return {
        method: "GET",
        path: `/queues/${encodeURIComponent(request.queueId)}`,
        response: "control",
      };
    case "PauseQueue":
      return {
        method: "POST",
        path: `/queues/${encodeURIComponent(request.queueId)}/pause`,
        response: "control",
      };
    case "ResumeQueue":
      return {
        method: "POST",
        path: `/queues/${encodeURIComponent(request.queueId)}/resume`,
        response: "control",
      };
    case "ClearQueue":
      return {
        method: "POST",
        path: `/queues/${encodeURIComponent(request.queueId)}/clear`,
        response: "control",
      };
  }
};

const httpRequest = (
  baseUrl: string,
  route: HttpControlRoute,
) =>
  route.method === "GET"
    ? HttpClientRequest.get(joinUrl(baseUrl, route.path))
    : HttpClientRequest.post(joinUrl(baseUrl, route.path));

const decodeResponse = (
  route: HttpControlRoute,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<ControlProtocolResponse, ControlTransportError> =>
  route.response === "contract"
    ? decodeContractResponse(response)
    : decodeControlResponse(response);

/**
 * Build an HTTP client for the control protocol.
 *
 * @public
 */
export const makeControlTransportHttpClient = (
  config: ControlTransportHttpClientConfig,
): ControlTransportClientShape<HttpClient.HttpClient> => ({
  request: (request) =>
    Effect.succeed(routeFor(request)).pipe(
      Effect.flatMap((route) =>
        HttpClient.execute(httpRequest(config.baseUrl, route)).pipe(
          Effect.mapError(transportErrorFromCause),
          Effect.flatMap((response) => decodeResponse(route, response)),
        )
      ),
    ),
});

/**
 * HTTP control transport helpers.
 *
 * @public
 */
export const ControlTransportHttp = {
  client: makeControlTransportHttpClient,
  clientLayer: (
    config: ControlTransportHttpClientConfig,
  ): Layer.Layer<ControlTransportClient, never, HttpClient.HttpClient> =>
    Layer.effect(
      ControlTransportClient,
      Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient;
        const client = makeControlTransportHttpClient(config);
        return {
          request: (request: ControlProtocolRequest) =>
            client.request(request).pipe(
              Effect.provideService(HttpClient.HttpClient, httpClient),
            ),
        };
      }),
    ),
} as const;
