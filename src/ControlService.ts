/**
 * **ControlService** — localhost JSON control plane for a {@link ProcessGroup}.
 *
 * @remarks
 * - **Binding** — `127.0.0.1` only (not exposed on LAN interfaces).
 * - **Transport** — `POST /control` with {@link ControlRequestBody}; responses use
 *   {@link ControlResponse}. `GET /health` for probes.
 * - **Payloads** — Request bodies are validated with **Effect Schema**; responses are
 *   JSON-encoded safely from plain objects.
 * - **Concurrency** — Some mutating routes fork work so the HTTP handler returns quickly
 *   (see `restart` / global restart in the implementation).
 *
 * The namespace also re-exports {@link createCli} and {@link runCli} so operators can
 * depend on a single import when wiring tooling.
 *
 * @module ControlService
 */

import { Data, Effect, Schema, Scope } from "effect";
import type {
  ProcessGroupContract,
  ProcessGroupControls,
  ProcessGroupEntry,
  ProcessGroupEntryRequirements,
  QueueDetails,
  TypedProcessGroup,
} from "./ProcessGroup";
import type { QueueHandle } from "./QueueResource";
import type { ProcessStore } from "./ProcessStore";
import { createCli, runCli } from "./cli";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Available control commands
 * 
 * @remarks
 * Commands are categorized by their target:
 * - **Process commands**: start, stop, restart, now
 * - **Queue commands**: pause, resume, shutdown
 * - **Queue maintenance**: restart clears pending queue items; REST `clear` is
 *   available at `POST /queues/:id/clear`
 * - **Universal commands**: ls, status, queues
 * 
 * @public
 */
export type ControlCommand =
  | "ls"        // List all processes and queues
  | "status"    // Get detailed status of a process or queue
  | "start"     // Start a process
  | "stop"      // Stop a process
  | "pause"     // Pause a queue
  | "resume"    // Resume a queue
  | "restart"   // Restart a process, or clear a queue
  | "shutdown"  // Shutdown a queue permanently
  | "now"       // Run a process immediately
  | "queues"    // List all queues

/**
 * Control API request body
 * 
 * @public
 */
export interface ControlRequestBody {
  /** Command to execute */
  command: ControlCommand;
  /** Target process or queue name (required for most commands) */
  name?: string;
  /** Reserved for future command payloads. */
  data?: unknown;
}

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

class InvalidJsonError extends Data.TaggedError("InvalidJsonError")<{
  readonly cause: unknown;
}> {}

const controlCommandSchema = Schema.Literals([
  "ls",
  "status",
  "start",
  "stop",
  "pause",
  "resume",
  "restart",
  "shutdown",
  "now",
  "queues",
] as const);

const controlRequestFromJson = Schema.fromJsonString(
  Schema.Struct({
    command: controlCommandSchema,
    name: Schema.optional(Schema.String),
    data: Schema.optional(Schema.Unknown),
  }),
);

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

type AnyProcessGroupContract = ProcessGroupContract<
  string,
  readonly ProcessGroupEntry[]
>;

type LegacyControlServiceOptions<R, Error = unknown> = {
  readonly port?: number;
  readonly group: ProcessGroupControls<R, Error>;
  readonly contract?: AnyProcessGroupContract;
};

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
      Effect.orDie,
    );
    yield* Effect.sync(() => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(json);
    });
  });

const appendChunk = (data: string, chunk: unknown): string => {
  if (typeof chunk === "string") {
    return data + chunk;
  }
  if (chunk instanceof Uint8Array) {
    return data + new TextDecoder().decode(chunk);
  }
  return data;
};

const readBody = (req: JsonRequest): Effect.Effect<string> =>
  Effect.callback<string>((resume: (effect: Effect.Effect<string>) => void) => {
    let data = "";
    req.on("data", (chunk: unknown) => {
      data = appendChunk(data, chunk);
    });
    req.on("end", () => resume(Effect.succeed(data)));
    req.on("error", () => resume(Effect.succeed(data)));
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

const queueDetails = (
  name: string,
  queue: QueueHandle<any, any, any>,
): Effect.Effect<QueueDetails> =>
  Effect.gen(function* () {
    const prioritySizes = yield* queue.sizes;
    const totalSize = yield* queue.size;
    const completed = yield* queue.completed;
    return {
      name,
      size: {
        high: prioritySizes.high,
        normal: prioritySizes.normal,
        low: prioritySizes.low,
        total: totalSize,
      },
      completed,
    };
  });

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

const handleRestRoute =
  <R, Error>(group: ProcessGroupControls<R, Error>) =>
  (
    method: string | undefined,
    url: URL,
  ): Effect.Effect<RouteResponse | undefined, Error, R | ProcessStore> =>
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
          Effect.flatMap((groupStatus) =>
            Effect.map(group.listQueues(), (queues) => ({
              status: 200,
              body: successResponse({
                processes: groupStatus.processes,
                queues,
              }),
            }))
          ),
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
          const result = yield* group.processStatus(name).pipe(
            Effect.map((data) => ({
              status: 200,
              body: processStatusResponse(data),
            })),
            Effect.catch(() =>
              Effect.succeed({
                status: 404,
                body: errorResponse(`Process '${name}' not found`),
              }),
            ),
          );
          return result;
        }

        if (method === "POST" && segments.length === 3) {
          const operation = segments[2];
          if (operation === "start") {
            return yield* group.start(name).pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Process '${name}' could not be started`))
              ),
            );
          }
          if (operation === "stop") {
            return yield* group.stop(name).pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Process '${name}' could not be stopped`))
              ),
            );
          }
          if (operation === "restart") {
            return yield* group.restart(name).pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Process '${name}' could not be restarted`))
              ),
            );
          }
          if (operation === "now") {
            return yield* group.runImmediately(name).pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Process '${name}' could not run immediately`))
              ),
            );
          }
        }
      }

      if (method === "GET" && segments.length === 1 && segments[0] === "queues") {
        return yield* group.listQueues().pipe(
          Effect.map((queues) => ({
            status: 200,
            body: successResponse(queues),
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
          const result = yield* group.getQueue(name).pipe(
            Effect.flatMap((queue) =>
              Effect.map(queueDetails(name, queue), (data) => ({
                status: 200,
                body: queueStatusResponse(data),
              })),
            ),
            Effect.catch(() =>
              Effect.succeed({
                status: 404,
                body: errorResponse(`Queue '${name}' not found`),
              }),
            ),
          );
          return result;
        }

        if (method === "POST" && segments.length === 3) {
          const operation = segments[2];
          if (operation === "pause") {
            return yield* group.pauseQueue(name).pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Queue '${name}' could not be paused`))
              ),
            );
          }
          if (operation === "resume") {
            return yield* group.resumeQueue(name).pipe(
              Effect.as({ status: 200, body: successResponse() }),
              Effect.catch((error) =>
                Effect.succeed(routeFailure(error, `Queue '${name}' could not be resumed`))
              ),
            );
          }
          if (operation === "clear") {
            return yield* group.clearQueue(name).pipe(
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

const handleCommand =
  <R, Error>(group: ProcessGroupControls<R, Error>) =>
  (
    command: ControlCommand,
    name?: string,
  ): Effect.Effect<ControlResponse<unknown>, Error, R | ProcessStore> =>
    Effect.gen(function* () {
      switch (command) {
        case "ls": {
          // List both processes and queues
          const groupStatus = yield* group.status;
          const processes = groupStatus.processes;
          const queues = yield* group.listQueues();
          return {
            success: true,
            data: { processes, queues },
          };
        }
        case "queues": {
          // List all queues
          const queues = yield* group.listQueues();
          return {
            success: true,
            data: queues,
          };
        }
        case "status": {
          if (name === undefined)
            return { success: false, error: "Missing name" };
          
          // Try process first
          const processResult = yield* group
            .processStatus(name)
            .pipe(
              Effect.map((data) => processStatusResponse(data)),
              Effect.catch(() => Effect.succeed(null)),
            );
          
          if (processResult !== null) return processResult;
          
          // Try queue
          const queueResult = yield* group
            .getQueue(name)
            .pipe(
              Effect.flatMap((queue) =>
                Effect.gen(function* () {
                  const prioritySizes = yield* queue.sizes;
                  const totalSize = yield* queue.size;
                  const completed = yield* queue.completed;
                  return {
                    ...queueStatusResponse({
                      name, 
                      size: {
                        high: prioritySizes.high,
                        normal: prioritySizes.normal,
                        low: prioritySizes.low,
                        total: totalSize,
                      },
                      completed 
                    }),
                  };
                }),
              ),
              Effect.catch(() => Effect.succeed(null)),
            );
          
          if (queueResult !== null) return queueResult;
          
          return { success: false, error: `Process or queue '${name}' not found` };
        }
        case "start": {
          // Process-only command
          if (name !== undefined)
            yield* group.start(name).pipe(Effect.catch(() => Effect.void));
          else yield* group.startAll().pipe(Effect.catch(() => Effect.void));
          return { success: true };
        }
        case "stop": {
          // Process-only command
          if (name !== undefined)
            yield* group.stop(name).pipe(Effect.catch(() => Effect.void));
          else yield* group.stopAll().pipe(Effect.catch(() => Effect.void));
          return { success: true };
        }
        case "now": {
          // Process-only command
          if (name === undefined)
            return { success: false, error: "Missing process name" };
          yield* group
            .runImmediately(name)
            .pipe(Effect.catch(() => Effect.void));
          return { success: true };
        }
        case "pause": {
          // Unified command - check process first, then queue
          if (name === undefined)
            return { success: false, error: "Missing name" };
          
          // Processes don't have pause, so check queue
          const queue = yield* group
            .getQueue(name)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          
          if (queue === null) {
            return { success: false, error: `Queue '${name}' not found` };
          }

          yield* queue.pause;
          return { success: true };
        }
        case "resume": {
          // Unified command - check process first, then queue
          if (name === undefined)
            return { success: false, error: "Missing name" };
          
          // Processes don't have resume, so check queue
          const queue = yield* group
            .getQueue(name)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          
          if (queue === null) {
            return { success: false, error: `Queue '${name}' not found` };
          }

          yield* queue.resume;
          return { success: true };
        }
        case "restart": {
          // Unified command - check process first, then queue
          if (name === undefined) {
            // Global restart: stop all processes then start all — fork to avoid blocking
            yield* Effect.forkChild(
              Effect.gen(function* () {
                yield* group.stopAll();
                yield* group.startAll();
              }).pipe(Effect.catch(() => Effect.void)),
            );
            return { success: true };
          }
          
          // Try process first - fork the restart to avoid blocking
          const processExists = yield* group
            .processStatus(name)
            .pipe(
              Effect.map(() => true),
              Effect.catch(() => Effect.succeed(false)),
            );
          
          if (processExists) {
            // Fork the restart operation so it doesn't block the HTTP response
            yield* Effect.forkChild(
              group.restart(name).pipe(Effect.catch(() => Effect.void))
            );
            return { success: true };
          }
          
          // Try queue
          const queue = yield* group
            .getQueue(name)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          
          if (queue === null) {
            return { success: false, error: `Process or queue '${name}' not found` };
          }

          yield* queue.clear;
          return { success: true };
        }
        case "shutdown": {
          // Queue-only command
          if (name === undefined)
            return { success: false, error: "Missing queue name" };

          const queue = yield* group
            .getQueue(name)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          
          if (queue === null) {
            return { success: false, error: `Queue '${name}' not found` };
          }

          yield* queue.shutdown;
          return { success: true };
        }
      }
    });

/**
 * Start the HTTP control service
 * 
 * @remarks
 * Starts a localhost-only HTTP server for controlling and monitoring a {@link ProcessGroup}.
 * The server provides a JSON API for CLI tools and management scripts.
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
 * - `POST /control` - Execute commands (see {@link ControlCommand})
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
 *   const group = yield* ProcessGroup.make({
 *     queues: [EmailQueue],
 *     processes: [emailCron]
 *   });
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
 * // Now accessible at http://localhost:8080/control
 * ```
 * 
 * @public
 */
function startControlService<R, Error>(
  options: LegacyControlServiceOptions<R, Error>,
): Effect.Effect<void, never, Scope.Scope | R | ProcessStore>;
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
  options:
    | LegacyControlServiceOptions<unknown, unknown>
    | TypedControlServiceOptions<string, readonly ProcessGroupEntry[], unknown>,
): Effect.Effect<void, never, Scope.Scope | unknown | ProcessStore> {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const port = options.port ?? 3001;
      const group = options.group;
      // Typed groups expose their contract and keep the legacy string-based
      // controls under `.legacy`; legacy groups can optionally pass a contract
      // while continuing to serve the existing `/control` command API.
      const commandGroup = "legacy" in group ? group.legacy : group;
      const contract = "legacy" in group
        ? group.contract
        : "contract" in options
          ? options.contract
          : undefined;

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
            if (contract === undefined) {
              yield* writeJson(res, 404, { error: "Contract not available" });
              return;
            }
            yield* writeJson(res, 200, contract);
            return;
          }

          const restResponse = yield* handleRestRoute(commandGroup)(req.method, url);
          if (restResponse !== undefined) {
            yield* writeJson(res, restResponse.status, restResponse.body);
            return;
          }

          if (url.pathname === "/control" && req.method === "POST") {
            const raw = yield* readBody(req);
            const body = yield* Schema.decodeUnknownEffect(
              controlRequestFromJson,
            )(raw).pipe(
              Effect.mapError((cause) => new InvalidJsonError({ cause })),
            );
            const result = yield* handleCommand(commandGroup)(body.command, body.name);
            const status = result.success ? 200 : 400;
            yield* writeJson(res, status, result);
            return;
          }

          yield* writeJson(res, 404, { error: "Not found" });
        });

        // Run the program with the captured context (all dependencies)
        runWithServices(
          program.pipe(
            Effect.catch((error) =>
              writeJson(res, 500, {
                success: false,
                error: String(error),
              }),
            ),
          ),
        );
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
   * Acquire a localhost HTTP listener for `/control` and `/health` until the scope ends.
   */
  make: startControlService,
  /** Build an `@effect/cli` application targeting this service’s port. */
  createCli,
  /** `Effect` that runs {@link createCli} against `process.argv` (or a passed argv). */
  runCli,
} as const;