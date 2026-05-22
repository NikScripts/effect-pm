/**
 * HTTP adapter for the transport-neutral control protocol.
 *
 * @module ControlTransportHttp
 */

import { Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import {
  ControlRouter,
  ControlProtocolRequestEnvelopeSchema,
  ControlProtocolResponseEnvelopeSchema,
  ControlTransportClient,
  ControlTransportError,
  ControlTransportServer,
  errorResponse,
  makeControlProtocolResponseEnvelope,
  type ControlProtocolRequest,
  type ControlProtocolRequestEnvelope,
  type ControlProtocolResponse,
  type ControlProtocolResponseEnvelope,
  type ControlTransportClientShape,
  type ControlTransportServerShape,
} from "./ControlProtocol";
import { responseBodyJson } from "./internal/json.js";
import { encodeProcessManagerLogEntryNdjson } from "./processManagerLogEntry.js";
import { ProcessManagerLogRelay } from "./processManagerLogRelay.js";

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
  write(chunk: string): void;
  end(chunk?: string): void;
}

/** Minimal surface used from Node’s `IncomingMessage` (avoids `node:http` type imports). */
interface JsonRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  on(event: "data", listener: (chunk: Uint8Array | string) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
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

const readRequestText = (req: JsonRequest): Effect.Effect<string, ControlTransportError> =>
  Effect.callback((resume) => {
    const chunks: string[] = [];
    req.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    });
    req.on("end", () => {
      resume(Effect.succeed(chunks.join("")));
    });
    req.on("error", (error) => {
      resume(Effect.fail(transportError(error.message)));
    });
  });

const readControlEnvelope = (req: JsonRequest): Effect.Effect<ControlProtocolRequestEnvelope, ControlTransportError> =>
  Effect.gen(function* () {
    const text = yield* readRequestText(req);
    const parsed = yield* Schema.decodeUnknownEffect(responseBodyJson)(text).pipe(
      Effect.mapError((cause) => transportError(`Malformed JSON request: ${String(cause)}`, 400)),
    );
    return yield* Schema.decodeUnknownEffect(ControlProtocolRequestEnvelopeSchema)(parsed).pipe(
      Effect.mapError((cause) => transportError(`Malformed control envelope: ${String(cause)}`, 400)),
    );
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
      if (operation === "start") {
        return {
          _tag: "Protocol",
          request: { _tag: "StartQueue", queueId },
        };
      }
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

const decodeEnvelopeResponse = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<ControlProtocolResponseEnvelope, ControlTransportError> =>
  HttpClientResponse.schemaBodyJson(ControlProtocolResponseEnvelopeSchema)(response).pipe(
    Effect.mapError((cause) =>
      transportError(`Malformed control envelope response: ${String(cause)}`, response.status)
    ),
  );

/**
 * Build an HTTP client for the control protocol.
 *
 * @public
 */
export const makeControlTransportHttpClient = (
  config: ControlTransportHttpClientConfig,
): ControlTransportClientShape<HttpClient.HttpClient> => ({
  request: (envelope) =>
    HttpClientRequest.post(joinUrl(config.baseUrl, "/control")).pipe(
      (request) => HttpClientRequest.bodyJson(request, envelope),
      Effect.mapError(transportErrorFromCause),
      Effect.flatMap((request) =>
        HttpClient.execute(request).pipe(
          Effect.mapError(transportErrorFromCause),
          Effect.flatMap(decodeEnvelopeResponse),
        ),
      ),
    )
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

            if (req.method === "GET" && url.pathname === "/logs/stream") {
              const follow =
                url.searchParams.get("follow") === "true" ||
                url.searchParams.get("follow") === "1";
              const relayOption = yield* Effect.serviceOption(ProcessManagerLogRelay);
              if (Option.isNone(relayOption)) {
                yield* writeJson(res, 503, errorResponse("Log relay is not available"));
                return;
              }
              const relay = relayOption.value;
              res.writeHead(200, {
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "Cache-Control": "no-cache",
                Connection: follow ? "keep-alive" : "close",
              });
              const snapshot = yield* relay.snapshot;
              const linesParam = url.searchParams.get("lines");
              const preludeLimit =
                linesParam !== null && linesParam.length > 0
                  ? Math.max(0, Math.min(500, Number.parseInt(linesParam, 10) || 0))
                  : snapshot.length;
              const prelude =
                preludeLimit < snapshot.length
                  ? snapshot.slice(snapshot.length - preludeLimit)
                  : snapshot;
              for (const entry of prelude) {
                const line = yield* encodeProcessManagerLogEntryNdjson(entry);
                res.write(`${line}
`);
              }
              if (!follow) {
                res.end();
                return;
              }
              yield* relay.stream.pipe(
                Stream.runForEach((entry) =>
                  Effect.gen(function* () {
                    const line = yield* encodeProcessManagerLogEntryNdjson(entry);
                    yield* Effect.sync(() => {
                      res.write(`${line}
`);
                    });
                  }),
                ),
                Effect.ensuring(Effect.sync(() => res.end())),
              );
              return;
            }


            if (req.method === "POST" && url.pathname === "/control") {
              const envelope = yield* readControlEnvelope(req).pipe(
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    yield* writeJson(res, error.status ?? 400, errorResponse(error.reason));
                    return undefined;
                  })
                ),
              );
              if (envelope === undefined) {
                return;
              }
              const protocolResponse = yield* router.handle(envelope.request);
              const responseEnvelope = yield* makeControlProtocolResponseEnvelope(
                envelope,
                protocolResponse,
              );
              yield* writeJson(res, protocolResponse.status, responseEnvelope);
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
          request: (envelope: ControlProtocolRequestEnvelope) =>
            client.request(envelope).pipe(
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
