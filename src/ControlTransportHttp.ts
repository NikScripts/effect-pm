/**
 * HTTP adapter for the transport-neutral control protocol.
 *
 * @module ControlTransportHttp
 */

import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import {
  ControlRouter,
  ControlResponseSchema,
  ControlTransportClient,
  ControlTransportError,
  ControlTransportServer,
  errorResponse,
  type ControlProtocolRequest,
  type ControlProtocolResponse,
  type ControlTransportClientShape,
  type ControlTransportServerShape,
} from "./ControlProtocol";
import { responseBodyJson } from "./internal/json";

/**
 * HTTP transport client configuration.
 *
 * @public
 */
export interface ControlTransportHttpClientConfig {
  readonly baseUrl: string;
}

/**
 * HTTP transport server configuration.
 *
 * @public
 */
export interface ControlTransportHttpServerConfig {
  readonly port?: number;
}

/** Minimal surface used from Node’s `ServerResponse` (avoids `node:http` type imports). */
interface JsonResponse {
  writeHead(statusCode: number, headers?: { readonly [k: string]: string }): void;
  end(chunk?: string): void;
}

/** Minimal surface used from Node’s `IncomingMessage` (avoids `node:http` type imports). */
interface JsonRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
}

interface RouteResponse {
  readonly status: number;
  readonly body: unknown;
}

type HttpRoute =
  | {
      readonly _tag: "Protocol";
      readonly request: ControlProtocolRequest;
    }
  | {
      readonly _tag: "Response";
      readonly response: RouteResponse;
    }
  | {
      readonly _tag: "NotFound";
    };

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

const writeJson = (
  res: JsonResponse,
  status: number,
  body: unknown,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const json = yield* Schema.encodeUnknownEffect(responseBodyJson)(body).pipe(
      Effect.catch(() =>
        Effect.succeed("{\"success\":false,\"error\":\"Unable to encode JSON response\"}")
      ),
    );
    yield* Effect.sync(() => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(json);
    });
  });

const decodePathSegment = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

const pathSegments = (url: URL): ReadonlyArray<string> | undefined => {
  const rawSegments = url.pathname.split("/").filter((segment) => segment !== "");
  const decoded: string[] = [];
  for (const segment of rawSegments) {
    const value = decodePathSegment(segment);
    if (value === undefined) {
      return undefined;
    }
    decoded.push(value);
  }
  return decoded;
};

const routeResponseFromProtocol = (
  response: ControlProtocolResponse,
): RouteResponse => ({
  status: response.status,
  body: response.body,
});

const requestFromRestRoute = (
  method: string | undefined,
  url: URL,
): HttpRoute => {
  const segments = pathSegments(url);
  if (segments === undefined) {
    return {
      _tag: "Response",
      response: {
        status: 400,
        body: errorResponse("Malformed URL path"),
      },
    };
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "contract") {
    return { _tag: "Protocol", request: { _tag: "GetContract" } };
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "status") {
    return { _tag: "Protocol", request: { _tag: "ReadGroupStatus" } };
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "processes") {
    return { _tag: "Protocol", request: { _tag: "ListProcesses" } };
  }
  if (segments[0] === "processes" && segments.length >= 2) {
    const processId = segments[1];
    if (processId === undefined) {
      return {
        _tag: "Response",
        response: {
          status: 400,
          body: errorResponse("Missing process name"),
        },
      };
    }
    if (method === "GET" && segments.length === 2) {
      return {
        _tag: "Protocol",
        request: { _tag: "ReadProcessStatus", processId },
      };
    }
    if (method === "POST" && segments.length === 3) {
      const operation = segments[2];
      if (operation === "start") {
        return {
          _tag: "Protocol",
          request: { _tag: "StartProcess", processId },
        };
      }
      if (operation === "stop") {
        return {
          _tag: "Protocol",
          request: { _tag: "StopProcess", processId },
        };
      }
      if (operation === "restart") {
        return {
          _tag: "Protocol",
          request: { _tag: "RestartProcess", processId },
        };
      }
      if (operation === "now") {
        return {
          _tag: "Protocol",
          request: { _tag: "RunProcessImmediately", processId },
        };
      }
    }
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "queues") {
    return { _tag: "Protocol", request: { _tag: "ListQueues" } };
  }
  if (segments[0] === "queues" && segments.length >= 2) {
    const queueId = segments[1];
    if (queueId === undefined) {
      return {
        _tag: "Response",
        response: {
          status: 400,
          body: errorResponse("Missing queue name"),
        },
      };
    }
    if (method === "GET" && segments.length === 2) {
      return {
        _tag: "Protocol",
        request: { _tag: "ReadQueueStatus", queueId },
      };
    }
    if (method === "POST" && segments.length === 3) {
      const operation = segments[2];
      if (operation === "pause") {
        return {
          _tag: "Protocol",
          request: { _tag: "PauseQueue", queueId },
        };
      }
      if (operation === "resume") {
        return {
          _tag: "Protocol",
          request: { _tag: "ResumeQueue", queueId },
        };
      }
      if (operation === "clear") {
        return {
          _tag: "Protocol",
          request: { _tag: "ClearQueue", queueId },
        };
      }
    }
  }

  return { _tag: "NotFound" };
};

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
 * Build an HTTP server transport for the control protocol.
 *
 * @public
 */
export const makeControlTransportHttpServer = (
  config: ControlTransportHttpServerConfig = {},
): ControlTransportServerShape => ({
  serve: Effect.asVoid(
    Effect.acquireRelease(
      Effect.gen(function* () {
        const port = config.port ?? 3001;
        const router = yield* ControlRouter;
        const services = yield* Effect.context<never>();
        const runWithServices = Effect.runForkWith(services);
        const nodeHttp = yield* Effect.tryPromise({
          try: () => import("node:http"),
          catch: (cause) => transportError(String(cause)),
        });

        const handler = (req: JsonRequest, res: JsonResponse) => {
          const program = Effect.gen(function* () {
            if (req.method === "OPTIONS") {
              yield* writeJson(res, 200, {});
              return;
            }

            const url = new URL(req.url ?? "/", `http://localhost:${port}`);

            if (url.pathname === "/health") {
              yield* writeJson(res, 200, { status: "ok" });
              return;
            }

            const route = requestFromRestRoute(req.method, url);
            if (route._tag === "Response") {
              yield* writeJson(res, route.response.status, route.response.body);
              return;
            }
            if (route._tag === "Protocol") {
              const protocolResponse = yield* router.handle(route.request);
              const restResponse = routeResponseFromProtocol(protocolResponse);
              yield* writeJson(res, restResponse.status, restResponse.body);
              return;
            }

            yield* writeJson(res, 404, { error: "Not found" });
          });

          runWithServices(program);
        };

        const server = nodeHttp.createServer(handler);
        const connections = new Set<{ destroy(): void }>();
        server.on("connection", (conn) => {
          connections.add(conn);
          conn.on("close", () => connections.delete(conn));
        });

        yield* Effect.callback<void, ControlTransportError>(
          (resume) => {
            const onError = (error: Error) => {
              resume(Effect.fail(transportError(error.message)));
            };
            server.once("error", onError);
            server.listen(port, "127.0.0.1", () => {
              server.off("error", onError);
              resume(Effect.void);
            });
          },
        );

        return { server, connections };
      }),
      ({ server, connections }) =>
        Effect.gen(function* () {
          yield* Effect.logInfo("Stopping control service...");
          for (const conn of connections) {
            conn.destroy();
          }
          yield* Effect.callback<void>((resume) => {
            server.close((err) => {
              resume(
                err !== undefined
                  ? Effect.logError(`Error closing server: ${String(err)}`)
                  : Effect.logInfo("Control service stopped"),
              );
            });
          });
        }),
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
  server: makeControlTransportHttpServer,
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
  serverLayer: (
    config: ControlTransportHttpServerConfig = {},
  ): Layer.Layer<ControlTransportServer> =>
    Layer.succeed(
      ControlTransportServer,
      makeControlTransportHttpServer(config),
    ),
} as const;
