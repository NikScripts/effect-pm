/**
 * **ControlService** — localhost JSON control plane for a {@link ProcessGroup}.
 *
 * @remarks
 * - **Binding** — `127.0.0.1` only (not exposed on LAN interfaces).
 * - **Transport** — Contract-aligned REST routes; responses use
 *   {@link ControlResponse}. `GET /health` for probes.
 * - **Payloads** — Request bodies are validated with **Effect Schema**; responses are
 *   JSON-encoded safely from plain objects.
 * - **Contract** — `GET /contract` is always available because the service is
 *   built from a typed {@link ProcessGroup}.
 *
 * The namespace also re-exports {@link createCli} and {@link runCli} so operators can
 * depend on a single import when wiring tooling.
 *
 * @module ControlService
 */

import { Effect, Schema, Scope } from "effect";
import type {
  ProcessGroupEntry,
  ProcessGroupEntryRequirements,
  TypedProcessGroup,
} from "./ProcessGroup";
import type { ProcessStore } from "./ProcessStore";
import {
  errorResponse,
  makeControlProtocolRouter,
  type ControlProtocolRequest,
  type ControlProtocolResponse,
} from "./ControlProtocol";
export type { ControlResponse } from "./ControlProtocol";
import { createCli, runCli } from "./cli";
import { responseBodyJson } from "./internal/json";

/** Minimal surface used from Node’s `ServerResponse` (avoids `node:http` type imports). */
interface JsonResponse {
  writeHead(statusCode: number, headers?: { readonly [k: string]: string }): void;
  end(chunk?: string): void;
}

/** Minimal surface used from Node’s `IncomingMessage` (avoids `node:http` type imports). */
interface JsonRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly on: (event: string, listener: (...args: ReadonlyArray<unknown>) => void) => void;
}

type TypedControlServiceOptions<
  Id extends string,
  Entries extends readonly ProcessGroupEntry[],
  Error = unknown,
> = {
  readonly port?: number;
  readonly group: TypedProcessGroup<Id, Entries, Error>;
};

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

/**
 * Start the HTTP control service
 * 
 * @remarks
 * Starts a localhost-only HTTP server for controlling and monitoring a typed
 * {@link ProcessGroup}. The server provides contract-aligned JSON routes for CLI
 * tools and remote {@link ProcessManager} clients.
 * 
 * **Security:**
 * - Listens on 127.0.0.1 (localhost) only
 * - Not accessible from external networks
 * - No authentication (relies on localhost security)
 * 
 * **Lifecycle:**
 * - Automatically starts HTTP server
 * - Keeps running until scope is closed
 * - Gracefully shuts down on scope closure
 * - Destroys active connections on shutdown
 * 
 * **API Endpoints:**
 * - `GET /contract` - Schema-backed typed group contract when available
 * - `GET /status` - Combined process/queue status
 * - `GET /processes` / `GET /processes/:id` - Process listings and status
 * - `POST /processes/:id/start|stop|restart|now` - Process controls
 * - `GET /queues` / `GET /queues/:id` - Queue listings and status
 * - `POST /queues/:id/pause|resume|clear` - Queue controls
 * - `GET /health` - Health check
 * 
 * @typeParam R - ProcessGroup requirements type
 * 
 * @param options - Configuration object
 * @param options.port - HTTP port to listen on (default: 3001)
 * @param options.group - ProcessGroup instance to control
 * 
 * @returns Scoped effect that runs the control service
 * 
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const group = yield* ProcessGroup.make("@app/Group", [EmailQueue, EmailProcess] as const);
 *   
 *   // Start control service on port 3001
 *   yield* ControlService.make({
 *     port: 3001,
 *     group
 *   });
 *   
 *   // Service runs until program ends
 *   yield* Effect.never;
 * }).pipe(Effect.scoped);
 * 
 * // Provide dependencies and run
 * program.pipe(
 *   Effect.provide(EmailQueue.layer),
 *   Effect.runPromise
 * );
 * ```
 * 
 * @example
 * ```typescript
 * // With custom port
 * yield* ControlService.make({
 *   port: 8080,
 *   group
 * });
 * 
 * // Now accessible at http://localhost:8080/status
 * ```
 * 
 * @public
 */
function startControlService<
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  Error,
>(
  options: TypedControlServiceOptions<Id, Entries, Error>,
): Effect.Effect<
  void,
  never,
  Scope.Scope | ProcessGroupEntryRequirements<Entries> | ProcessStore
>;
function startControlService(
  options: TypedControlServiceOptions<string, readonly ProcessGroupEntry[], unknown>,
): Effect.Effect<void, never, Scope.Scope | unknown | ProcessStore> {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const port = options.port ?? 3001;
      const group = options.group;

      // Capture context (services) with all dependencies already provided
      const services = yield* Effect.context<unknown | ProcessStore>();
      const runWithServices = Effect.runForkWith(services);
      const router = makeControlProtocolRouter(group);

      const nodeHttp = yield* Effect.promise(() => import("node:http"));

      // Create HTTP request handler
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

        // Run the program with the captured context (all dependencies).
        runWithServices(program);
      };

      const server = nodeHttp.createServer(handler);

      // Track active connections for cleanup
      const connections = new Set<{ destroy(): void }>();
      server.on("connection", (conn) => {
        connections.add(conn);
        conn.on("close", () => connections.delete(conn));
      });

      // Start listening
      yield* Effect.callback<void>(
        (resume: (effect: Effect.Effect<void>) => void) => {
          server.listen(port, "127.0.0.1", () => {
            resume(Effect.void);
          });
          server.on("error", (error) => {
            runWithServices(Effect.logError(`Control service error: ${String(error)}`));
          });
        },
      );

      return { server, connections, runWithServices };
    }),
    ({ server, connections, runWithServices }) =>
      Effect.callback<void>(
        (resume: (effect: Effect.Effect<void>) => void) => {
          runWithServices(Effect.logInfo("Stopping control service..."));

          // Destroy all active connections
          for (const conn of connections) {
            conn.destroy();
          }

          server.close((err) => {
            if (err !== undefined) {
              runWithServices(Effect.logError(`Error closing server: ${String(err)}`));
            } else {
              runWithServices(Effect.logInfo("Control service stopped"));
            }
            resume(Effect.void);
          });
        },
      ),
  );
}

interface ControlServiceApi {
  readonly make: typeof startControlService;
  readonly createCli: typeof createCli;
  readonly runCli: typeof runCli;
}

/**
 * Control plane entrypoints.
 *
 * @public
 */
export const ControlService: ControlServiceApi = {
  /**
   * Acquire a localhost HTTP listener for contract-aligned REST routes until the scope ends.
   */
  make: startControlService,
  /** Build an `@effect/cli` application targeting this service’s port. */
  createCli,
  /** `Effect` that runs {@link createCli} against `process.argv` (or a passed argv). */
  runCli,
} as const;