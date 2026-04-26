/**
 * ProcessManager - Orchestration Layer for Scheduled Processes and Queues
 * 
 * The ProcessManager provides a unified interface for managing scheduled processes
 * and queues. It handles process lifecycle, monitoring, and coordination.
 * 
 * @remarks
 * Key features:
 * - Process lifecycle management (start, stop, restart)
 * - Real-time status monitoring and metrics
 * - Queue resource integration and management
 * - Scoped resource management with automatic cleanup
 * 
 * **Dependencies:**
 * - `ExecutionHistory` - Required for tracking process execution history.
 *   Provide either `ExecutionHistory.layer` (in-memory) or a custom implementation.
 * 
 * @module ProcessManager
 */

import { Effect, Scope, Fiber, Ref, Data, Context } from "effect";
import type { Process } from "./Process";
import type { QueueRef } from "./QueueResource";
import { ExecutionHistory, type ExecutionHistoryError } from "./ExecutionHistory";
import { ControlService } from "./ControlService";

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Extract the identifier type from a Context.Key
 * @internal
 */
type TagIdentifier<T> = T extends Context.Key<infer I, any> ? I : never;

// ============================================================================
// Public Types
// ============================================================================

/**
 * Environment required to run a process's scheduled `effect` (including
 * {@link ExecutionHistory}, which the scheduler wrapper always uses).
 *
 * @public
 */
export type ProcessEffectRequirements<P> = P extends Process<any>
  ? Effect.Services<P["effect"]>
  : never;

/**
 * Union of {@link ProcessEffectRequirements} for every process in a tuple.
 *
 * @remarks
 * {@link ProcessManager.make} uses this so `startAll`, `startProcess`, and
 * related controls carry the same combined environment you would thread
 * through any nested `Effect`.
 *
 * @public
 */
export type AllManagedProcessesRequirements<
  Processes extends readonly Process<any>[],
> = ProcessEffectRequirements<Processes[number]>;

/**
 * Builds the internal process map: each concrete process is assignable to
 * `Process<PMR>` because {@link Process} is covariant in `R` and `PMR` is the
 * union of every process effect's environment.
 *
 * @internal
 */
const processMapFromTuple = <const Processes extends readonly Process<any>[]>(
  processes: Processes,
): Map<string, Process<AllManagedProcessesRequirements<Processes>>> => {
  const map = new Map<
    string,
    Process<AllManagedProcessesRequirements<Processes>>
  >();
  for (const p of processes) {
    map.set(p.name, p);
  }
  return map;
};

/**
 * ProcessManager core dependencies
 * 
 * @remarks
 * ExecutionHistory provides persistence for process execution history.
 * A default in-memory implementation is available via `ExecutionHistory.layer`.
 * 
 * @public
 */
export type ProcessManagerDependencies = ExecutionHistory;

/**
 * Process status managed by ProcessManager
 * 
 * @remarks
 * - `running` - Process is actively running
 * - `paused` - Process is paused (not currently implemented)
 * - `stopped` - Process is stopped
 * 
 * @public
 */
export type ProcessStatus = "running" | "paused" | "stopped";

/**
 * Detailed information about a managed process
 * 
 * @remarks
 * Contains comprehensive status information including:
 * - Basic metadata (name, type, status)
 * - Runtime metrics (uptime, start time)
 * - Scheduled process details (lastRun, nextRun, runCount)
 * - Optional metadata for extension
 * 
 * @public
 */
export interface ProcessManagerDetails {
  /** Unique process identifier */
  name: string;
  /** Process type */
  type: "scheduled" | "service";
  /** Current process status */
  status: ProcessStatus;
  /** Milliseconds since process start */
  uptime: number;
  /** When the process was started (null if never started) */
  startTime: Date | null;
  
  // Scheduled process details (when type is "scheduled")
  /** Last execution time for scheduled processes */
  lastRun?: Date | null;
  /** Next scheduled execution time */
  nextRun?: Date;
  /** Total number of executions */
  executions?: number;
  /** First startup run time (if runOnStartup is enabled) */
  firstStartup?: Date | null;
  
  // Queue-specific details (when type is "queue")
  /** Current number of items in queue */
  size?: number;
  /** Total number of items completed */
  completed?: number;
  /** Number of concurrent workers */
  workers?: number;
  /** Whether the queue is currently processing */
  running?: boolean;
  
  /** Additional metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * Internal state for ProcessManager
 * @internal
 */
export interface ProcessManagerState<R> {
  processes: Ref.Ref<Map<string, Process<R>>>;
  queues: Record<string, QueueRef<any, any, any, any>>;
  statuses: Ref.Ref<Map<string, ProcessStatus>>;
  startTimes: Ref.Ref<Map<string, Date>>;
  scopes: Ref.Ref<Map<string, Scope.Scope>>;
  fibers: Ref.Ref<Map<string, Fiber.Fiber<void, ExecutionHistoryError>>>;
}

/**
 * Queue resource status information
 * 
 * @public
 */
export interface QueueDetails {
  /** Queue identifier */
  name: string;
  /** Current number of items in queue by priority */
  size: {
    /** High priority items pending */
    high: number;
    /** Normal priority items pending */
    normal: number;
    /** Low priority items pending */
    low: number;
    /** Total items pending (all priorities) */
    total: number;
  };
  /** Total number of items completed */
  completed: number;
}

/**
 * ProcessManager Interface
 * 
 * @remarks
 * The ProcessManager provides a comprehensive API for managing scheduled processes and queues:
 * 
 * **Process Management**
 * - Add, remove, and list processes
 * - Start, stop, and restart individual processes or all processes
 * - Run scheduled processes immediately
 * 
 * **Monitoring**
 * - Get detailed status of individual processes
 * - Get status of all processes
 * - List and access queue information
 * 
 * **Queue integration**
 * - Access managed queues directly
 * - View queue metrics and status
 * 
 * @typeParam R - Combined environment for all managed processes' runnable effects
 * (see {@link AllManagedProcessesRequirements}). Lifecycle methods that fork
 * scheduled work list `R | {@link ExecutionHistory}` because TypeScript cannot
 * prove `ExecutionHistory` is already part of an unconstrained `R`.
 * 
 * @public
 */
export interface ProcessManagerControls<R> {
  // ========== Process Management ==========
  
  /**
   * Remove a process from management
   * 
   * @param name - Process identifier
   * @remarks
   * If the process is running, it will be stopped before removal.
   * After removal, the process cannot be started again unless re-added.
   */
  removeProcess(name: string): Effect.Effect<void, PMError>;
  
  /**
   * List all managed processes
   * 
   * @returns Array of process details
   */
  listProcesses(): Effect.Effect<ProcessManagerDetails[], PMError, ExecutionHistory>;

  // ========== Process Control ==========
  
  /**
   * Start a specific process
   * 
   * @param name - Process identifier
   * @remarks
   * Fails if the process is already running or doesn't exist.
   */
  startProcess(
    name: string,
  ): Effect.Effect<void, PMError, R | ExecutionHistory>;
  
  /**
   * Stop a specific process
   * 
   * @param name - Process identifier
   * @remarks
   * Gracefully interrupts the process fiber and updates status.
   */
  stopProcess(name: string): Effect.Effect<void, PMError>;
  
  /**
   * Restart a process (stop then start)
   * 
   * @param name - Process identifier
   */
  restartProcess(
    name: string,
  ): Effect.Effect<void, PMError, R | ExecutionHistory>;

  // ========== Process-Specific Actions ==========
  
  /**
   * Run a scheduled process immediately
   * 
   * @param name - Process identifier
   * @remarks
   * Only works for scheduled processes (crons). The process must support
   * immediate execution. This does not affect the regular schedule.
   */
  runProcessImmediately(
    name: string,
  ): Effect.Effect<void, PMError, R | ExecutionHistory>;

  // ========== Status and Details ==========
  
  /**
   * Get detailed status of a specific process
   * 
   * @param name - Process identifier
   * @returns Comprehensive process details
   */
  getProcessStatus(
    name: string,
  ): Effect.Effect<ProcessManagerDetails, PMError, ExecutionHistory>;
  
  /**
   * Get status of all managed processes
   * 
   * @returns Array of all process details
   */
  getAllProcessStatus(): Effect.Effect<
    ProcessManagerDetails[],
    PMError,
    ExecutionHistory
  >;

  // ========== Global Control ==========
  
  /**
   * Start all managed processes
   * 
   * @remarks
   * Processes that are already running will be skipped.
   */
  startAll(): Effect.Effect<void, PMError, R | ExecutionHistory>;
  
  /**
   * Stop all running processes
   * 
   * @remarks
   * Gracefully stops all processes. Processes that are already stopped are skipped.
   */
  stopAll(): Effect.Effect<void, PMError>;

  // ========== Queue operations ==========
  
  /**
   * List all managed queues
   * 
   * @returns Array of queue details including size and completed count
   */
  listQueues(): Effect.Effect<QueueDetails[], never>;
  
  /**
   * Get a specific queue resource
   * 
   * @param name - Queue identifier
   * @returns The queue resource instance
   * @remarks
   * Use this to interact directly with a queue (add items, check status, etc.)
   */
  getQueue(
    name: string,
  ): Effect.Effect<QueueRef<any, any, any, any>, PMError>;
}

/**
 * Options for {@link ProcessManager} shutdown waiting (Node.js signals).
 *
 * @public
 */
export interface AwaitShutdownOptions {
  /**
   * OS signals that trigger graceful shutdown (interrupts the running fiber).
   *
   * @defaultValue `["SIGINT", "SIGTERM"]` — matches local Ctrl+C and `docker stop`.
   */
  readonly signals?: readonly string[];
  /**
   * Custom log line for each signal. Return `undefined` or `""` to skip logging.
   *
   * @remarks
   * When omitted, a default info message is logged via {@link Effect.logInfo}.
   */
  readonly logMessage?: (signal: string) => string | undefined;
}

export interface ProcessManager<R> extends ProcessManagerControls<R> {
  serve: ({ port }: { port?: number }) => Effect.Effect<void, never, Scope.Scope | R | ExecutionHistory>;

  /**
   * Block until a shutdown signal is received, then interrupt (so scoped
   * resources such as the control HTTP server shut down cleanly).
   *
   * @remarks
   * Intended as the last step in a long-running program after `serve` and
   * `startAll`. Listeners are removed when the surrounding scope closes or
   * after the first matching signal.
   *
   * No-ops into {@link Effect.never} with a warning when `process.on` is
   * unavailable (non-Node environments).
   *
   * @public
   */
  awaitShutdown: (
    options?: AwaitShutdownOptions,
  ) => Effect.Effect<never, never, Scope.Scope>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * General ProcessManager error
 * 
 * @remarks
 * Used for errors that don't fit into more specific error categories.
 * 
 * @public
 */
export class ProcessManagerError extends Data.TaggedError(
  "ProcessManagerError",
)<{
  /** Error reason/message */
  reason: string;
  /** Process that caused the error (if applicable) */
  processName?: string;
  /** Operation that failed (if applicable) */
  operation?: string;
}> {}

/**
 * Error thrown when a process is not found
 * 
 * @public
 */
export class ProcessNotFoundError extends Data.TaggedError(
  "ProcessNotFoundError",
)<{
  /** Name of the process that was not found */
  processName: string;
}> {}

/**
 * Error thrown when attempting to start a process that is already running
 * 
 * @public
 */
export class ProcessAlreadyRunningError extends Data.TaggedError(
  "ProcessAlreadyRunningError",
)<{
  /** Name of the process that is already running */
  processName: string;
}> {}

/**
 * Error thrown when attempting an operation on a process that is not running
 * 
 * @public
 */
export class ProcessNotRunningError extends Data.TaggedError(
  "ProcessNotRunningError",
)<{
  /** Name of the process that is not running */
  processName: string;
  /** Operation that was attempted */
  operation: string;
}> {}

/**
 * Union of all possible ProcessManager errors
 * 
 * @public
 */
export type PMError =
  | ProcessManagerError
  | ProcessNotFoundError
  | ProcessAlreadyRunningError
  | ProcessNotRunningError
  | ExecutionHistoryError;

const defaultShutdownSignals = ["SIGINT", "SIGTERM"] as const;

/**
 * Wait for Node process signals, then interrupt the current fiber.
 *
 * @internal
 */
const awaitShutdownNode = (
  options?: AwaitShutdownOptions,
): Effect.Effect<never, never, Scope.Scope> =>
  Effect.gen(function* () {
    const signals = options?.signals ?? defaultShutdownSignals;
    const entries: Array<{ readonly sig: string; readonly fn: () => void }> =
      [];

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const { sig, fn } of entries) {
          process.off(sig, fn);
        }
        entries.length = 0;
      }),
    );

    yield* Effect.callback<never>((resume) => {
      let done = false;
      for (const sig of signals) {
        const fn = () => {
          if (done) return;
          done = true;
          for (const e of entries) {
            process.off(e.sig, e.fn);
          }
          entries.length = 0;

          const resolved =
            options?.logMessage !== undefined
              ? options.logMessage(sig)
              : `Received ${sig}, shutting down gracefully...`;

          const log =
            resolved !== undefined && resolved !== ""
              ? Effect.logInfo(resolved)
              : Effect.void;

          resume(Effect.andThen(log, () => Effect.interrupt));
        };
        entries.push({ sig, fn });
        process.on(sig, fn);
      }
    });
    // addFinalizer yields void; success type stays `void` unless asserted.
  }) as Effect.Effect<never, never, Scope.Scope>;

const awaitShutdown = (
  options?: AwaitShutdownOptions,
): Effect.Effect<never, never, Scope.Scope> =>
  typeof process !== "undefined" && typeof process.on === "function"
    ? awaitShutdownNode(options)
    : Effect.andThen(
        Effect.logWarning(
          "ProcessManager.awaitShutdown: process.on is not available; blocking forever. Use a Node.js entrypoint.",
        ),
        () => Effect.never,
      );

// ============================================================================
// Helper Functions (Internal)
// ============================================================================

// Helper functions for process management
const removeProcess =
  <R>(state: ProcessManagerState<R>) =>
  (name: string): Effect.Effect<void, PMError> =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`🗑️  Removing process: ${name}`);

      // Check if process exists
      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      );

      if (!process) {
        yield* new ProcessNotFoundError({ processName: name });
      }

      // Stop if running
      const status = yield* Ref.get(state.statuses).pipe(
        Effect.map((statuses) => statuses.get(name)),
      );

      if (status === "running") {
        yield* stopProcess(state)(name);
      }

      // Remove from all maps
      yield* Ref.update(state.processes, (processes) => {
        const newMap = new Map(processes);
        newMap.delete(name);
        return newMap;
      });
      yield* Ref.update(state.statuses, (statuses) => {
        const newMap = new Map(statuses);
        newMap.delete(name);
        return newMap;
      });
      yield* Ref.update(state.startTimes, (startTimes) => {
        const newMap = new Map(startTimes);
        newMap.delete(name);
        return newMap;
      });
      yield* Ref.update(state.scopes, (scopes) => {
        const newMap = new Map(scopes);
        newMap.delete(name);
        return newMap;
      });
      yield* Ref.update(state.fibers, (fibers) => {
        const newMap = new Map(fibers);
        newMap.delete(name);
        return newMap;
      });

      yield* Effect.logInfo(`✅ Process '${name}' removed successfully`);
    });

const listProcesses = <R>(
  state: ProcessManagerState<R>,
): Effect.Effect<ProcessManagerDetails[], PMError, ExecutionHistory> =>
  Effect.gen(function* () {
    const processes = yield* Ref.get(state.processes);
    const statuses = yield* Ref.get(state.statuses);
    const startTimes = yield* Ref.get(state.startTimes);

    const detailsPromises = Array.from(processes.entries()).map(
      ([name, process]) =>
        Effect.gen(function* () {
          const status = statuses.get(name) || "stopped";
          const startTime = startTimes.get(name) || null;
          const uptime = startTime ? Date.now() - startTime.getTime() : 0;

          // Get additional details for scheduled processes
          let scheduledDetails = {};
          if (process.type === "scheduled") {
            const details = yield* process.getStatus().pipe(
              Effect.catch(() =>
                Effect.succeed({
                  lastRun: null,
                  executions: 0,
                  nextRun: new Date(),
                  firstStartup: null,
                }),
              ),
            );
            scheduledDetails = {
              lastRun: details.lastRun,
              nextRun: details.nextRun,
              executions: details.executions,
              firstStartup: details.firstStartup,
            };
          }

          return {
            name,
            type: process.type,
            status,
            uptime,
            startTime,
            ...scheduledDetails,
            metadata: {
              hasRunImmediately: "runImmediately" in process,
            },
          };
        }),
    );

    return yield* Effect.all(detailsPromises);
  });

const startProcess =
  <R>(state: ProcessManagerState<R>) =>
  (name: string): Effect.Effect<void, PMError, R | ExecutionHistory> =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`🚀 Starting process: ${name}`);

      // Check if process exists
      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      ); 

      if (!process) {
        yield* new ProcessNotFoundError({ processName: name });
      }

      // Check current status
      const status = yield* Ref.get(state.statuses).pipe(
        Effect.map((statuses) => statuses.get(name)),
      );

      if (status === "running") {
        yield* new ProcessAlreadyRunningError({ processName: name });
      }

      // If stopped, restart instead of starting new
      if (status === "stopped") {
        yield* Effect.logInfo(`📝 Process '${name}' is starting`);
      }

      // Create scope and start process
      const scope = yield* Scope.make();
      const fiber = yield* Effect.forkChild(process!.effect);

      // Update state
      yield* Ref.update(state.scopes, (scopes) => scopes.set(name, scope));
      yield* Ref.update(state.fibers, (fibers) => fibers.set(name, fiber));
      yield* Ref.update(state.statuses, (statuses) =>
        statuses.set(name, "running"),
      );
      yield* Ref.update(state.startTimes, (startTimes) =>
        startTimes.set(name, new Date()),
      );

      yield* Effect.logInfo(`✅ '${name}' is running`);
    });

const stopProcess =
  <R>(state: ProcessManagerState<R>) =>
  (name: string): Effect.Effect<void, PMError> =>
    Effect.gen(function* () {
      // Check if process exists
      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      );

      if (!process) {
        yield* new ProcessNotFoundError({ processName: name });
      }

      // Check if running
      const status = yield* Ref.get(state.statuses).pipe(
        Effect.map((statuses) => statuses.get(name)),
      );

      if (status !== "running") {
        yield* new ProcessNotRunningError({
          processName: name,
          operation: "stop",
        });
      }

      // Get fiber
      const fiber = yield* Ref.get(state.fibers).pipe(
        Effect.map((fibers) => fibers.get(name)),
      );

      // Interrupt the main process fiber
      if (fiber) {
        yield* Fiber.interrupt(fiber);
      }

      // Update status
      yield* Ref.update(state.statuses, (statuses) =>
        statuses.set(name, "stopped"),
      );

      yield* Effect.logInfo(`✅ Process '${name}' stopped successfully`);
    });

const runProcessImmediately =
  <R>(state: ProcessManagerState<R>) =>
  (name: string): Effect.Effect<void, PMError, R | ExecutionHistory> =>
    Effect.gen(function* () {
      // Check if process exists
      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      );

      if (!process) {
        yield* new ProcessNotFoundError({ processName: name });
      }

      // Check if it's a scheduled process with runImmediately
      if (process!.type === "scheduled" && "runImmediately" in process!) {
        yield* Effect.logInfo(`🚀 Running '${name}' immediately...`);
        yield* process!.runImmediately();
      } else {
        yield* new ProcessManagerError({
          reason: "unsupported_immediate_execution",
          processName: name,
          operation: "runImmediately",
        });
      }
    });

const getProcessStatus =
  <R>(state: ProcessManagerState<R>) =>
  (name: string): Effect.Effect<ProcessManagerDetails, PMError, ExecutionHistory> =>
    Effect.gen(function* () {
      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      );

      if (!process) {
        yield* new ProcessNotFoundError({ processName: name });
      }

      const status = yield* Ref.get(state.statuses).pipe(
        Effect.map((statuses) => statuses.get(name)),
      );
      const startTime = yield* Ref.get(state.startTimes).pipe(
        Effect.map((startTimes) => startTimes.get(name)),
      );
      const uptime = startTime ? Date.now() - startTime.getTime() : 0;

      // Handle scheduled processes
      const scheduledDetails = yield* (process!)
        .getStatus()
        .pipe(
          Effect.mapError(
            () =>
              new ProcessManagerError({
                reason: "status_details_error",
                processName: name,
                operation: "status",
              }),
          ),
        );

      return {
        name,
        type: process!.type,
        status: status || "stopped",
        uptime,
        startTime: startTime || null,
        ...scheduledDetails,
      };
    });

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a ProcessManager instance
 * 
 * @remarks
 * Creates a ProcessManager that coordinates scheduled processes and queues.
 * The ProcessManager provides:
 * - Lifecycle management for all processes
 * - Unified control interface (start, stop, restart)
 * - Status monitoring and metrics
 * - Queue resource integration and access
 * 
 * **Type Safety**
 * 
 * Managed processes may require any Effect services. The returned
 * {@link ProcessManager} is parameterized by {@link AllManagedProcessesRequirements},
 * inferred from the `processes` tuple, so `startAll` and related controls
 * require the same combined environment as forking those effects elsewhere.
 * Queue tags in `queues` must still be available when running `ProcessManager.make`
 * (they are acquired during construction).
 * For each queue, use {@link QueueResource.make} with a **string literal** `name`
 * so {@link QueueRef}’s first type parameter is a literal and `Effect.provide` /
 * merged `Layer`s can narrow `R` correctly.
 * 
 * @typeParam Queues - Array of queue resource service tags to manage
 * @typeParam Processes - Tuple of {@link Process} values; used to infer combined requirements
 * 
 * @param config - Configuration object
 * @param config.queues - Array of queue resource service tags (from QueueResource.make)
 * @param config.processes - Array of processes to manage (from Process.make)
 * 
 * @returns Effect that produces a ProcessManager instance
 * 
 * @example
 * ```typescript
 * import { QueueResource, Process, ProcessManager } from "@nikscripts/effect-pm";
 * import { Cron, Effect } from "effect";
 * 
 * const EmailQueue = QueueResource.make({
 *   name: "email-queue",
 *   effect: sendEmail,
 *   concurrency: 5
 * });
 * 
 * const emailCron = Process.make({
 *   name: "send-emails",
 *   crons: Cron.make({ minutes: [0, 30] }), // Every 30 minutes
 *   effect: Effect.gen(function* () {
 *     const queue = yield* EmailQueue;
 *     yield* queue.add([email1, email2, email3]);
 *   })
 * });
 * 
 * const pm = yield* ProcessManager.make({
 *   queues: [EmailQueue],
 *   processes: [emailCron]
 * });
 * 
 * yield* pm.startAll();
 * ```
 * 
 * @public
 */
export const makeProcessManager = <
  const Queues extends readonly [
    ...Context.Key<any, QueueRef<any, any, any, any>>[],
  ],
  const Processes extends readonly Process<any>[],
>(config: {
  queues: Queues;
  processes: Processes;
}): Effect.Effect<
  ProcessManager<AllManagedProcessesRequirements<Processes>>,
  PMError,
  TagIdentifier<Queues[number]>
> =>
  Effect.gen(function* () {
    type PMR = AllManagedProcessesRequirements<Processes>;

    // Yield all queue services to make them requirements
    const queuesMap = Object.fromEntries(
      config.queues.map((queueTag) => [queueTag.key, queueTag.asEffect()]),
    );
    const queues = yield* Effect.all(queuesMap);

    const processMap = processMapFromTuple(config.processes);
    const statusMap = new Map<string, ProcessStatus>();
    for (const name of processMap.keys()) {
      statusMap.set(name, "stopped");
    }

    const processes = yield* Ref.make(processMap);
    const statuses = yield* Ref.make(statusMap);
    const startTimes = yield* Ref.make(new Map<string, Date>());
    const scopes = yield* Ref.make(new Map<string, Scope.Scope>());
    const fibers = yield* Ref.make(
      new Map<string, Fiber.Fiber<void, ExecutionHistoryError>>(),
    );

    const state: ProcessManagerState<PMR> = {
      processes,
      queues,
      statuses,
      startTimes,
      scopes,
      fibers,
    };

    const controls = {
      removeProcess: removeProcess(state),
      listProcesses: () => listProcesses(state),
      startProcess: (name: string) =>
        Effect.andThen(
          Effect.logInfo(`🚀 Starting process: ${name}`),
          startProcess(state)(name),
        ),
      stopProcess: (name: string) =>
        Effect.andThen(
          Effect.logInfo(`🛑 Stopping process: ${name}`),
          stopProcess(state)(name),
        ),
      restartProcess: (name: string) =>
        Effect.gen(function* () {
          yield* stopProcess(state)(name);
          yield* startProcess(state)(name);
        }),
      runProcessImmediately: runProcessImmediately(state),
      getProcessStatus: getProcessStatus(state),
      getAllProcessStatus: () => listProcesses(state),
      startAll: () =>
        Effect.gen(function* () {
          const processes = yield* Ref.get(state.processes);
          for (const name of processes.keys()) {
            // Start only if not already running
            const status = yield* Ref.get(state.statuses).pipe(
              Effect.map((m) => m.get(name)),
            );
            if (status !== "running") {
              yield* startProcess(state)(name);
            }
          }
        }),
      stopAll: () =>
        Effect.gen(function* () {
          const processes = yield* Ref.get(state.processes);
          for (const name of processes.keys()) {
            const status = yield* Ref.get(state.statuses).pipe(
              Effect.map((m) => m.get(name)),
            );
            if (status === "running") {
              yield* stopProcess(state)(name);
            }
          }
        }),
      listQueues: () =>
        Effect.all(
          Object.entries(state.queues).map(([name, queue]) =>
            Effect.gen(function* () {
              const prioritySizes = yield* queue.sizeByPriority();
              const totalSize = yield* queue.size();
              const completed = yield* queue.getCompleted();
              return { 
                name, 
                size: {
                  high: prioritySizes.high,
                  normal: prioritySizes.normal,
                  low: prioritySizes.low,
                  total: totalSize,
                },
                completed 
              };
            }),
          ),
        ),
      getQueue: (name: string) =>
        Effect.gen(function* () {
          const queue = state.queues[name];
          if (!queue) {
            yield* new ProcessNotFoundError({ processName: name });
          }
          return queue!;
        }),
    };
    return {
      ...controls,
      serve: ({ port }: { port?: number }) => ControlService.make({ pm: controls, port }),
      awaitShutdown,
    };
  });

export const ProcessManager = {
  make: makeProcessManager,
}