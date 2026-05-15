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
  ProcessGroupProcessEntries,
  ProcessGroupQueueEntries,
  TypedProcessGroup,
} from "./ProcessGroup";
import type { ProcessStore } from "./ProcessStore";
import { createCli, runCli } from "./cli";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Control API response
 * 
 * @typeParam T - Type of data returned (varies by command)
 * 
 * @public
 */
export interface ControlResponse<T = unknown> {
  /** Whether the command succeeded */
  success: boolean;
  /** Response type (for status command) */
  type?: "process" | "queue";
  /** Response data (if applicable) */
  data?: T;
  /** Error message (if failed) */
  error?: string;
}

const responseBodyJson = Schema.fromJsonString(Schema.Unknown);

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

const processStatusResponse = <T>(
  data: T,
): ControlResponse<T> & { readonly type: "process" } => ({
  success: true,
  data,
  type: "process",
});

const queueStatusResponse = <T>(
  data: T,
): ControlResponse<T> & { readonly type: "queue" } => ({
  success: true,
  data,
  type: "queue",
});

const successResponse = <T>(data?: T): ControlResponse<T> => ({
  success: true,
  ...(data === undefined ? {} : { data }),
});

const errorResponse = (error: string): ControlResponse<never> => ({
  success: false,
  error,
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

const errorTag = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) {
    return undefined;
  }
  const tag = error._tag;
  return typeof tag === "string" ? tag : undefined;
};

const errorStatus = (error: unknown): number => {
  const tag = errorTag(error);
  if (tag === "ProcessNotFoundError") {
    return 404;
  }
  if (
    tag === "ProcessAlreadyRunningError" ||
    tag === "ProcessNotRunningError"
  ) {
    return 409;
  }
  if (tag === "UnsupportedRemoteControlError") {
    return 400;
  }
  if (tag === "ProcessGroupRemoteControlError") {
    if (typeof error === "object" && error !== null && "status" in error) {
      const status = error.status;
      return typeof status === "number" ? status : 502;
    }
    return 502;
  }
  return 500;
};

const errorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const reason = error.reason;
    if (typeof reason === "string") {
      return reason;
    }
  }
  return fallback;
};

const routeFailure = (error: unknown, fallback: string): RouteResponse => ({
  status: errorStatus(error),
  body: errorResponse(errorMessage(error, fallback)),
});

const findProcessEntry = <
  const Entries extends readonly ProcessGroupEntry[],
>(
  entries: Entries,
  id: string,
): ProcessGroupProcessEntries<Entries> | undefined =>
  entries.find(
    (entry): entry is ProcessGroupProcessEntries<Entries> =>
      entry.kind === "process" && entry.id === id,
  );

const findQueueEntry = <
  const Entries extends readonly ProcessGroupEntry[],
>(
  entries: Entries,
  id: string,
): ProcessGroupQueueEntries<Entries> | undefined =>
  entries.find(
    (entry): entry is ProcessGroupQueueEntries<Entries> =>
      entry.kind === "queue" && entry.id === id,
  );

const handleRestRoute =
  <
    const Id extends string,
    const Entries extends readonly ProcessGroupEntry[],
    Error,
  >(group: TypedProcessGroup<Id, Entries, Error>) =>
  (
    method: string | undefined,
    url: URL,
  ): Effect.Effect<
    RouteResponse | undefined,
    never,
    ProcessGroupEntryRequirements<Entries> | ProcessStore
  > =>
    Effect.gen(function* () {
      const segments = pathSegments(url);
      if (segments === undefined) {
        return {
          status: 400,
          body: errorResponse("Malformed URL path"),
        };
      }

      if (method === "GET" && segments.length === 1 && segments[0] === "status") {
        return yield* group.status.pipe(
          Effect.map((groupStatus) => ({
            status: 200,
            body: successResponse(groupStatus),
          })),
          Effect.catch((error) =>
            Effect.succeed(routeFailure(error, "Unable to read group status"))
          ),
        );
      }

      if (method === "GET" && segments.length === 1 && segments[0] === "processes") {
        return yield* group.status.pipe(
          Effect.map((groupStatus) => ({
            status: 200,
            body: successResponse(groupStatus.processes),
          })),
          Effect.catch((error) =>
            Effect.succeed(routeFailure(error, "Unable to list processes"))
          ),
        );
      }

      if (segments[0] === "processes" && segments.length >= 2) {
        const name = segments[1];
        if (name === undefined) {
          return {
            status: 400,
            body: errorResponse("Missing process name"),
          };
        }

        if (method === "GET" && segments.length === 2) {
          const entry = findProcessEntry(group.entries, name);
          if (entry === undefined) {
            return {
              status: 404,
              body: errorResponse(`Process '${name}' not found`),
            };
          }
          const result = yield* group.process(entry).status.pipe(
            Effect.map((data) => ({
              status: 200,
              body: processStatusResponse(data),
            })),
            Effect.catch((error) =>
              Effect.succeed(routeFailure(error, `Process '${name}' not found`)),
            ),
          );
          return result;
        }

        if (method === "POST" && segments.length === 3) {
          const operation = segments[2];
          const entry = findProcessEntry(group.entries, name);
          if (entry === undefined) {
            return {
              status: 404,
              body: errorResponse(`Process '${name}' not found`),
            };
          }
          const controls = group.process(entry);
          if (operation === "start") {
            return yield* controls.start.pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Process '${name}' could not be started`))
              ),
            );
          }
          if (operation === "stop") {
            return yield* controls.stop.pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Process '${name}' could not be stopped`))
              ),
            );
          }
          if (operation === "restart") {
            return yield* controls.restart.pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Process '${name}' could not be restarted`))
              ),
            );
          }
          if (operation === "now") {
            return yield* controls.runImmediately.pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Process '${name}' could not run immediately`))
              ),
            );
          }
        }
      }

      if (method === "GET" && segments.length === 1 && segments[0] === "queues") {
        return yield* group.status.pipe(
          Effect.map((groupStatus) => ({
            status: 200,
            body: successResponse(groupStatus.queues),
          })),
          Effect.catch((error) =>
            Effect.succeed(routeFailure(error, "Unable to list queues"))
          ),
        );
      }

      if (segments[0] === "queues" && segments.length >= 2) {
        const name = segments[1];
        if (name === undefined) {
          return {
            status: 400,
            body: errorResponse("Missing queue name"),
          };
        }

        if (method === "GET" && segments.length === 2) {
          const entry = findQueueEntry(group.entries, name);
          if (entry === undefined) {
            return {
              status: 404,
              body: errorResponse(`Queue '${name}' not found`),
            };
          }
          const result = yield* group.queue(entry).status.pipe(
            Effect.map((data) => ({
              status: 200,
              body: queueStatusResponse(data),
            })),
            Effect.catch((error) =>
              Effect.succeed(routeFailure(error, `Queue '${name}' not found`)),
            ),
          );
          return result;
        }

        if (method === "POST" && segments.length === 3) {
          const operation = segments[2];
          const entry = findQueueEntry(group.entries, name);
          if (entry === undefined) {
            return {
              status: 404,
              body: errorResponse(`Queue '${name}' not found`),
            };
          }
          const controls = group.queue(entry);
          if (operation === "pause") {
            return yield* controls.pause.pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Queue '${name}' could not be paused`))
              ),
            );
          }
          if (operation === "resume") {
            return yield* controls.resume.pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Queue '${name}' could not be resumed`))
              ),
            );
          }
          if (operation === "clear") {
            return yield* controls.clear.pipe(
              Effect.map((cleared) => ({
                status: 200,
                body: successResponse({ cleared }),
              })),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Queue '${name}' could not be cleared`))
              ),
            );
          }
        }
      }

      return undefined;
    });

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

          if (url.pathname === "/contract" && req.method === "GET") {
            yield* writeJson(res, 200, group.contract);
            return;
          }

          const restResponse = yield* handleRestRoute(group)(req.method, url);
          if (restResponse !== undefined) {
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