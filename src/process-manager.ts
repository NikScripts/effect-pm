/**
 * ProcessManager - Orchestration Layer for Scheduled Tasks and Queues
 * 
 * The ProcessManager provides a unified interface for managing scheduled tasks (crons)
 * and priority queues. It handles process lifecycle, monitoring, and coordination.
 * 
 * @remarks
 * Key features:
 * - Process lifecycle management (start, stop, restart)
 * - Real-time status monitoring and metrics
 * - Queue integration and management
 * - Type-safe queue dependency enforcement
 * - Scoped resource management with automatic cleanup
 * 
 * @module process-manager
 */

import { Effect, Scope, Fiber, Ref, Data, Context } from "effect";
import type { CronHandler } from "./cron-handler";
import type { PriorityQueueProcessor } from "./priority-queue";
import { CronStorage, type CronStorageError } from "./cron-storage";

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Extract the identifier type from a Context.Tag
 * @internal
 */
type TagIdentifier<T> = T extends Context.Tag<infer I, any> ? I : never;

/**
 * Helper type to convert union to intersection
 * @internal
 */
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

// ============================================================================
// Public Types
// ============================================================================

/**
 * ProcessManager core dependencies
 * 
 * @remarks
 * CronStorage provides persistence for scheduled task execution history.
 * A default in-memory implementation is available via `CronStorageLive`.
 * 
 * @public
 */
export type ProcessManagerDependencies = CronStorage;

/**
 * Process types that ProcessManager can handle
 * 
 * @remarks
 * Currently supports CronHandler (scheduled tasks). Future versions may support
 * additional process types like long-running services or event-driven handlers.
 * 
 * @public
 */
export type Process<R> = CronHandler<R>;

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
  runCount?: number;
  /** First startup run time (if runOnStartup is enabled) */
  firstStartupRun?: Date | null;
  
  // Queue-specific details (when type is "queue")
  /** Current number of items in queue */
  queueSize?: number;
  /** Total number of items processed */
  processedCount?: number;
  /** Number of concurrent workers */
  workerCount?: number;
  /** Whether the queue is currently processing */
  isRunning?: boolean;
  
  /** Additional metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * Internal state for ProcessManager
 * @internal
 */
export interface ProcessManagerState<R> {
  processes: Ref.Ref<Map<string, Process<R>>>;
  queues: Record<string, PriorityQueueProcessor<any, any>>;
  statuses: Ref.Ref<Map<string, ProcessStatus>>;
  startTimes: Ref.Ref<Map<string, Date>>;
  scopes: Ref.Ref<Map<string, Scope.Scope>>;
  fibers: Ref.Ref<Map<string, Fiber.RuntimeFiber<void, CronStorageError>>>;
}

/**
 * Queue status information
 * 
 * @public
 */
export interface QueueDetails {
  /** Queue identifier */
  name: string;
  /** Current number of items in queue */
  queueSize: number;
  /** Total number of items processed */
  processedCount: number;
}

/**
 * ProcessManager Interface
 * 
 * @remarks
 * The ProcessManager provides a comprehensive API for managing scheduled tasks and queues:
 * 
 * **Process Management**
 * - Add, remove, and list processes
 * - Start, stop, and restart individual processes or all processes
 * - Run scheduled tasks immediately
 * 
 * **Monitoring**
 * - Get detailed status of individual processes
 * - Get status of all processes
 * - List and access queue information
 * 
 * **Queue Integration**
 * - Access managed queues directly
 * - View queue metrics and status
 * 
 * @typeParam R - Requirements type representing dependencies needed by managed processes
 * 
 * @public
 */
export interface ProcessManager<R> {
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
  listProcesses(): Effect.Effect<ProcessManagerDetails[], PMError, CronStorage>;

  // ========== Process Control ==========
  
  /**
   * Start a specific process
   * 
   * @param name - Process identifier
   * @remarks
   * Fails if the process is already running or doesn't exist.
   */
  startProcess(name: string): Effect.Effect<void, PMError, R>;
  
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
  restartProcess(name: string): Effect.Effect<void, PMError, R>;

  // ========== Process-Specific Actions ==========
  
  /**
   * Run a scheduled process immediately
   * 
   * @param name - Process identifier
   * @remarks
   * Only works for scheduled processes (crons). The process must support
   * immediate execution. This does not affect the regular schedule.
   */
  runProcessImmediately(name: string): Effect.Effect<void, PMError, R>;

  // ========== Status and Details ==========
  
  /**
   * Get detailed status of a specific process
   * 
   * @param name - Process identifier
   * @returns Comprehensive process details
   */
  getProcessStatus(
    name: string,
  ): Effect.Effect<ProcessManagerDetails, PMError, CronStorage>;
  
  /**
   * Get status of all managed processes
   * 
   * @returns Array of all process details
   */
  getAllProcessStatus(): Effect.Effect<
    ProcessManagerDetails[],
    PMError,
    CronStorage
  >;

  // ========== Global Control ==========
  
  /**
   * Start all managed processes
   * 
   * @remarks
   * Processes that are already running will be skipped.
   */
  startAll(): Effect.Effect<void, PMError, R>;
  
  /**
   * Stop all running processes
   * 
   * @remarks
   * Gracefully stops all processes. Processes that are already stopped are skipped.
   */
  stopAll(): Effect.Effect<void, PMError>;
  
  /**
   * Restart all processes
   * 
   * @remarks
   * Stops and then starts all processes.
   */
  restartAll(): Effect.Effect<void, PMError, R>;

  // ========== Queue Operations ==========
  
  /**
   * List all managed queues
   * 
   * @returns Array of queue details including size and processed count
   */
  listQueues(): Effect.Effect<QueueDetails[], never>;
  
  /**
   * Get a specific queue processor
   * 
   * @param name - Queue identifier
   * @returns The queue processor instance
   * @remarks
   * Use this to interact directly with a queue (add items, check status, etc.)
   */
  getQueue(
    name: string,
  ): Effect.Effect<PriorityQueueProcessor<any, any>, PMError>;
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
  | CronStorageError;

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
): Effect.Effect<ProcessManagerDetails[], PMError, CronStorage> =>
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
            const details = yield* (process as CronHandler<R>).getStatus().pipe(
              Effect.catchAll(() =>
                Effect.succeed({
                  lastRun: null,
                  runCount: 0,
                  nextRun: new Date(),
                  firstStartupRun: null,
                }),
              ),
            );
            scheduledDetails = {
              lastRun: details.lastRun,
              nextRun: details.nextRun,
              runCount: details.runCount,
              firstStartupRun: details.firstStartupRun,
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
  (name: string): Effect.Effect<void, PMError, R | CronStorage> =>
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
      const fiber = yield* Effect.fork(process!.effect);

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
  (name: string): Effect.Effect<void, PMError, R | CronStorage> =>
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
  (name: string): Effect.Effect<ProcessManagerDetails, PMError, CronStorage> =>
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

      // Handle scheduled processes (CronHandler)
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
 * Creates a ProcessManager that coordinates scheduled tasks (crons) and priority queues.
 * The ProcessManager provides:
 * - Lifecycle management for all processes
 * - Unified control interface (start, stop, restart)
 * - Status monitoring and metrics
 * - Queue integration and access
 * - Type-safe queue dependency enforcement
 * 
 * **Type Safety**
 * 
 * The type system ensures that all queue dependencies used in processes are
 * provided in the `queues` array. If a process references a queue that isn't
 * provided, you'll get a compile-time error.
 * 
 * @typeParam Queues - Array of queue service tags to manage
 * @typeParam R - Additional requirements for processes beyond queues and ProcessManager dependencies
 * 
 * @param config - Configuration object
 * @param config.queues - Array of queue service tags (from makeQueueService)
 * @param config.processes - Array of processes to manage (from createCronProcess)
 * 
 * @returns Effect that produces a ProcessManager instance
 * 
 * @example
 * ```typescript
 * const [EmailQueue, EmailQueueLive] = makeQueueService({
 *   name: "email-queue",
 *   processor: sendEmail,
 *   concurrency: 5
 * });
 * 
 * const emailCron = createCronProcess({
 *   name: "send-emails",
 *   crons: Cron.make({ minutes: [0, 30] }), // Every 30 minutes
 *   program: Effect.gen(function* () {
 *     const queue = yield* EmailQueue;
 *     yield* queue.add([email1, email2, email3]);
 *   })
 * });
 * 
 * const pm = yield* makeProcessManager({
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
    ...Context.Tag<any, PriorityQueueProcessor<any, any>>[],
  ],
  R,
>(config: {
  queues: Queues;
  processes: Process<
    | (R extends PriorityQueueProcessor<any, any>
        ? TagIdentifier<Queues[number]>
        : R)
    | ProcessManagerDependencies
  >[];
}): Effect.Effect<
  ProcessManager<
    | R
    | ProcessManagerDependencies
    | UnionToIntersection<TagIdentifier<Queues[number]>>
  >,
  PMError,
  TagIdentifier<Queues[number]>
> =>
  Effect.gen(function* () {
    // Yield all queue services to make them requirements
    const queuesMap = Object.fromEntries(
      config.queues.map((queue) => [queue.key, queue]),
    );
    const queues = yield* Effect.all(queuesMap);

    // Initialize processes map with the provided processes
    const processMap = new Map<
      string,
      Process<R | ProcessManagerDependencies | TagIdentifier<Queues[number]>>
    >();
    const statusMap = new Map<string, ProcessStatus>();
    for (const process of config.processes) {
      processMap.set(process.name, process);
      statusMap.set(process.name, "stopped");
    }

    const processes = yield* Ref.make(processMap);
    const statuses = yield* Ref.make(statusMap);
    const startTimes = yield* Ref.make(new Map<string, Date>());
    const scopes = yield* Ref.make(new Map<string, Scope.Scope>());
    const fibers = yield* Ref.make(
      new Map<string, Fiber.RuntimeFiber<void, CronStorageError>>(),
    );

    const state: ProcessManagerState<
      R | ProcessManagerDependencies | TagIdentifier<Queues[number]>
    > = {
      processes,
      queues,
      statuses,
      startTimes,
      scopes,
      fibers,
    };

    return {
      removeProcess: removeProcess(state),
      listProcesses: () => listProcesses(state),
      startProcess: (name: string) =>
        Effect.zipRight(
          Effect.logInfo(`🚀 Starting process: ${name}`),
          startProcess(state)(name),
        ),
      stopProcess: (name: string) =>
        Effect.zipRight(
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
      pauseAll: () =>
        new ProcessManagerError({
          reason: "not_implemented",
          operation: "pauseAll",
        }),
      resumeAll: () =>
        new ProcessManagerError({
          reason: "not_implemented",
          operation: "resumeAll",
        }),
      restartAll: () =>
        new ProcessManagerError({
          reason: "not_implemented",
          operation: "restartAll",
        }),
      listQueues: () =>
        Effect.all(
          Object.entries(state.queues).map(([name, queue]) =>
            Effect.gen(function* () {
              const queueSize = yield* queue.size();
              const processedCount = yield* queue.getProcessedCount();
              return { name, queueSize, processedCount };
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
  });
