/**
 * Control Service - HTTP API for Process Management
 * 
 * Provides a localhost-only HTTP API for controlling and monitoring ProcessManager.
 * Used by CLI tools and local management scripts.
 * 
 * @remarks
 * Key features:
 * - Localhost-only (127.0.0.1) for security
 * - RESTful JSON API
 * - Process and queue control
 * - Status monitoring
 * - Graceful shutdown handling
 * 
 * @module control-service
 */

import http from "node:http";
import { Effect, Scope, Runtime } from "effect";
import type { ProcessManagerControls, PoolDetails } from "./ProcessManager";
import type { ExecutionHistory } from "./ExecutionHistory";
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
  | "restart"   // Restart a process or queue
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
  /** Additional data (e.g., for queue-add operations) */
  data?: any;
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
  type?: "process" | "pool";
  /** Response data (if applicable) */
  data?: T;
  /** Error message (if failed) */
  error?: string;
}

const writeJson = (
  res: http.ServerResponse,
  status: number,
  body: unknown,
): Effect.Effect<void> =>
  Effect.sync(() => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });

const readBody = (req: http.IncomingMessage): Effect.Effect<string> =>
  Effect.async<string>((resume) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => resume(Effect.succeed(data)));
    req.on("error", () => resume(Effect.succeed(data)));
  });

const handleCommand =
  <R>(pm: ProcessManagerControls<R>) =>
  (
    command: ControlCommand,
    name?: string,
  ): Effect.Effect<ControlResponse<unknown>, never, R | ExecutionHistory> =>
    Effect.gen(function* () {
      switch (command) {
        case "ls": {
          // List both processes and queues
          const processes = yield* pm
            .getAllProcessStatus()
            .pipe(Effect.catchAll(() => Effect.succeed([])));
          const queues = yield* pm.listPools();
          return {
            success: true,
            data: { processes, queues },
          };
        }
        case "queues": {
          // List only queues
          const queues = yield* pm.listPools();
          return {
            success: true,
            data: queues,
          } as ControlResponse<PoolDetails[]>;
        }
        case "status": {
          if (!name)
            return { success: false, error: "Missing name" };
          
          // Try process first
          const processResult = yield* pm
            .getProcessStatus(name)
            .pipe(
              Effect.map((data) => ({ success: true, data, type: "process" as const })),
              Effect.catchAll(() => Effect.succeed(null)),
            );
          
          if (processResult) return processResult;
          
          // Try queue
          const poolResult = yield* pm
            .getPool(name)
            .pipe(
              Effect.flatMap((pool) =>
                Effect.gen(function* () {
                  const prioritySizes = yield* pool.sizeByPriority();
                  const totalSize = yield* pool.size();
                  const completed = yield* pool.getProcessedCount();
                  return {
                    success: true,
                    data: { 
                      name, 
                      size: {
                        high: prioritySizes.high,
                        normal: prioritySizes.normal,
                        low: prioritySizes.low,
                        total: totalSize,
                      },
                      completed 
                    },
                    type: "pool" as const,
                  };
                }),
              ),
              Effect.catchAll(() => Effect.succeed(null)),
            );
          
          if (poolResult) return poolResult;
          
          return { success: false, error: `Process or pool '${name}' not found` };
        }
        case "start": {
          // Process-only command
          if (name)
            yield* pm.startProcess(name).pipe(Effect.catchAll(() => Effect.void));
          else yield* pm.startAll().pipe(Effect.catchAll(() => Effect.void));
          return { success: true };
        }
        case "stop": {
          // Process-only command
          if (name)
            yield* pm.stopProcess(name).pipe(Effect.catchAll(() => Effect.void));
          else yield* pm.stopAll().pipe(Effect.catchAll(() => Effect.void));
          return { success: true };
        }
        case "now": {
          // Process-only command
          if (!name)
            return { success: false, error: "Missing process name" };
          yield* pm
            .runProcessImmediately(name)
            .pipe(Effect.catchAll(() => Effect.void));
          return { success: true };
        }
        case "pause": {
          // Unified command - check process first, then queue
          if (!name)
            return { success: false, error: "Missing name" };
          
          // Processes don't have pause, so check queue
          const queue = yield* pm
            .getPool(name)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          
          if (!queue) {
            return { success: false, error: `Queue '${name}' not found` };
          }
          
          yield* queue.pause();
          return { success: true };
        }
        case "resume": {
          // Unified command - check process first, then queue
          if (!name)
            return { success: false, error: "Missing name" };
          
          // Processes don't have resume, so check queue
          const queue = yield* pm
            .getPool(name)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          
          if (!queue) {
            return { success: false, error: `Queue '${name}' not found` };
          }
          
          yield* queue.resume();
          return { success: true };
        }
        case "restart": {
          // Unified command - check process first, then queue
          if (!name) {
            // Global restart (processes only) - fork it to avoid blocking
            yield* Effect.fork(
              pm.restartAll().pipe(Effect.catchAll(() => Effect.void))
            );
            return { success: true };
          }
          
          // Try process first - fork the restart to avoid blocking
          const processExists = yield* pm
            .getProcessStatus(name)
            .pipe(
              Effect.map(() => true),
              Effect.catchAll(() => Effect.succeed(false)),
            );
          
          if (processExists) {
            // Fork the restart operation so it doesn't block the HTTP response
            yield* Effect.fork(
              pm.restartProcess(name).pipe(Effect.catchAll(() => Effect.void))
            );
            return { success: true };
          }
          
          // Try queue
          const queue = yield* pm
            .getPool(name)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          
          if (!queue) {
            return { success: false, error: `Process or queue '${name}' not found` };
          }
          
          yield* queue.restart();
          return { success: true };
        }
        case "shutdown": {
          // Queue-only command
          if (!name)
            return { success: false, error: "Missing queue name" };
          
          const queue = yield* pm
            .getPool(name)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          
          if (!queue) {
            return { success: false, error: `Queue '${name}' not found` };
          }
          
          yield* queue.shutdown();
          return { success: true };
        }
      }
    });

/**
 * Start the HTTP control service
 * 
 * @remarks
 * Starts a localhost-only HTTP server for controlling and monitoring the ProcessManager.
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
 * - `POST /control` - Execute commands (see {@link ControlCommand})
 * - `GET /health` - Health check
 * 
 * @typeParam R - ProcessManager requirements type
 * 
 * @param options - Configuration object
 * @param options.port - HTTP port to listen on (default: 3001)
 * @param options.pm - ProcessManager instance to control
 * 
 * @returns Scoped effect that runs the control service
 * 
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const pm = yield* makeProcessManager({
 *     queues: [EmailQueue],
 *     processes: [emailCron]
 *   });
 *   
 *   // Start control service on port 3001
 *   yield* startControlService({
 *     port: 3001,
 *     pm: pm
 *   });
 *   
 *   // Service runs until program ends
 *   yield* Effect.never;
 * }).pipe(Effect.scoped);
 * 
 * // Provide dependencies and run
 * program.pipe(
 *   Effect.provide(EmailQueueLive),
 *   Effect.runPromise
 * );
 * ```
 * 
 * @example
 * ```typescript
 * // With custom port
 * yield* startControlService({
 *   port: 8080,
 *   pm: pm
 * });
 * 
 * // Now accessible at http://localhost:8080/control
 * ```
 * 
 * @public
 */
const startControlService = <R>(options: {
  port?: number;
  pm: ProcessManagerControls<R>;
}): Effect.Effect<void, never, Scope.Scope | R | ExecutionHistory> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const port = options.port ?? 3001;
      const pm = options.pm;

      // Capture the runtime with all dependencies already provided
      const runtime = yield* Effect.runtime<R | ExecutionHistory>();

      // Create HTTP request handler
      const handler = (
        req: http.IncomingMessage,
        res: http.ServerResponse,
      ) => {
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

          if (url.pathname === "/control" && req.method === "POST") {
            const raw = yield* readBody(req);
            const parsed = Effect.try({
              try: () => JSON.parse(raw) as ControlRequestBody,
              catch: () => new Error("Invalid JSON"),
            });
            const body = yield* parsed;
            const result = yield* handleCommand(pm)(body.command, body.name);
            const status = result.success ? 200 : 400;
            yield* writeJson(res, status, result);
            return;
          }

          yield* writeJson(res, 404, { error: "Not found" });
        });

        // Run the program using the captured runtime (which has all dependencies)
        Runtime.runFork(runtime)(
          program.pipe(
            Effect.catchAll((error) =>
              writeJson(res, 500, {
                success: false,
                error: String(error),
              }),
            ),
          ),
        );
      };

      const server = http.createServer(handler);

      // Track active connections for cleanup
      const connections = new Set<any>();
      server.on("connection", (conn) => {
        connections.add(conn);
        conn.on("close", () => connections.delete(conn));
      });

      // Start listening
      yield* Effect.async<void>((resume) => {
        server.listen(port, "127.0.0.1", () => {
          resume(Effect.void);
        });
        server.on("error", (error) => {
          console.error("❌ Control service error:", error);
        });
      });

      return { server, connections };
    }),
    ({ server, connections }) =>
      Effect.async<void>((resume) => {
        console.log("🛑 Stopping control service...");
        
        // Destroy all active connections
        for (const conn of connections) {
          conn.destroy();
        }
        
        server.close((err) => {
          if (err) {
            console.error("❌ Error closing server:", err);
          } else {
            console.log("✅ Control service stopped");
          }
          resume(Effect.void);
        });
      }),
  )

export const ControlService = {
  make: startControlService,
  createCli: createCli,
  runCli: runCli,
}