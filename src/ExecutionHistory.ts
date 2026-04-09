/**
 * ExecutionHistory - Process Execution History and Analytics
 * 
 * Provides persistent storage for process execution history, enabling analytics,
 * monitoring, and execution tracking across application restarts.
 * 
 * @remarks
 * Key features:
 * - Process-scoped storage interface
 * - Execution history tracking
 * - Success/failure recording
 * - Startup run detection
 * - Date range queries
 * - Pluggable storage backends (in-memory, Prisma, etc.)
 * 
 * @module ExecutionHistory
 */

import { Context, Data, Effect, Layer } from "effect";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Execution history storage operation error
 * 
 * @remarks
 * Thrown when storage operations fail (database errors, etc.)
 * 
 * @public
 */
export class ExecutionHistoryError extends Data.TaggedError("ExecutionHistoryError")<{
  /** Error reason/message */
  reason: string;
  /** Operation that failed */
  operation: string;
  /** Process name if applicable */
  processName?: string;
}> {}

// ============================================================================
// Public Types
// ============================================================================

/**
 * Data for recording a process execution
 * 
 * @remarks
 * Contains all information about a single execution of a process.
 * 
 * @public
 */
export interface ExecutionData {
  /** Name of the process */
  processName: string;
  /** When the execution started */
  executedAt: Date;
  /** Whether this was a startup run (first run after restart) */
  isStartupRun: boolean;
  /** How long the execution took (milliseconds) */
  durationMs?: number;
  /** Whether the execution succeeded */
  success: boolean;
  /** Error message if execution failed */
  errorMessage?: string;
}

/**
 * Date range for filtering executions
 * 
 * @public
 */
export interface DateRange {
  /** Start date (inclusive) */
  start: Date;
  /** End date (inclusive) */
  end: Date;
}

/**
 * Stored execution record
 * 
 * @remarks
 * The persisted form of a process execution with a unique ID.
 * 
 * @public
 */
export interface Execution {
  /** Unique execution identifier */
  id: string;
  /** Name of the process */
  processName: string;
  /** When the execution started */
  executedAt: Date;
  /** Whether this was a startup run */
  isStartupRun: boolean;
  /** How long the execution took (milliseconds, null if not recorded) */
  durationMs: number | null;
  /** Whether the execution succeeded */
  success: boolean;
  /** Error message if execution failed (null if succeeded) */
  errorMessage: string | null;
}

/**
 * Process-scoped storage interface
 * 
 * @remarks
 * Provides storage operations for a specific process.
 * Obtained via {@link ExecutionHistoryInterface.forProcess}.
 * 
 * All operations are scoped to the process, so processName doesn't need
 * to be passed to each method.
 * 
 * @public
 */
export interface ProcessExecutionHistory {
  /**
   * Record a process execution
   * 
   * @param data - Execution data (processName is automatically added)
   */
  recordExecution: (data: Omit<ExecutionData, 'processName'>) => Effect.Effect<void, ExecutionHistoryError>;
  
  /**
   * Get execution history
   * 
   * @param dateRange - Optional date range to filter results
   * @returns Array of executions
   */
  getExecutions: (dateRange?: DateRange) => Effect.Effect<Execution[], ExecutionHistoryError>;
  
  /**
   * Get most recent execution time
   * 
   * @returns Date of last execution (null if never run)
   */
  getLastRun: () => Effect.Effect<Date | null, ExecutionHistoryError>;
  
  /**
   * Get total execution count
   * 
   * @param dateRange - Optional date range to filter count
   * @returns Number of executions
   */
  getRunCount: (dateRange?: DateRange) => Effect.Effect<number, ExecutionHistoryError>;
  
  /**
   * Get first startup run time
   * 
   * @returns Date of first startup run (null if hasn't run since startup)
   */
  getFirstStartupRun: () => Effect.Effect<Date | null, ExecutionHistoryError>;
  
  /**
   * Check if this is the first run since restart
   * 
   * @returns True if no startup run has been recorded yet
   */
  isFirstRunSinceRestart: () => Effect.Effect<boolean, ExecutionHistoryError>;
}

/**
 * ExecutionHistory service interface
 * 
 * @remarks
 * Main interface for execution history storage. Use {@link forProcess} to get a
 * process-scoped storage interface.
 * 
 * @public
 */
export interface ExecutionHistoryInterface {
  /**
   * Get process-scoped storage
   * 
   * @param processName - Name of the process
   * @returns Storage interface scoped to the process
   */
  forProcess: (processName: string) => ProcessExecutionHistory;
}

// ============================================================================
// Default Implementation
// ============================================================================

/**
 * Create in-memory execution history implementation
 * 
 * @remarks
 * Creates a fast, simple in-memory storage for process execution history.
 * 
 * **Characteristics:**
 * - Fast - No I/O overhead
 * - Simple - No configuration required
 * - Ephemeral - Data lost on restart
 * - Thread-safe - Uses JavaScript Map
 * 
 * **Use Cases:**
 * - Development and testing
 * - Applications without persistence requirements
 * - Temporary/disposable workloads
 * 
 * **For Production:**
 * Consider using a persistent implementation (see examples/prisma-storage.ts)
 * to retain execution history across restarts.
 * 
 * @returns Effect producing an ExecutionHistoryInterface
 * 
 * @internal
 */
const makeInMemoryExecutionHistory = Effect.sync(() => {
  // Warn users that this is in-memory storage
  console.warn(
    '\n⚠️  WARNING: Using in-memory ExecutionHistory\n' +
    '   Execution history will be lost on restart.\n' +
    '   For production, use a persistent storage implementation.\n' +
    '   See: https://github.com/nikscripts/effect-pm/tree/main/examples/prisma-storage.ts\n'
  );

  // In-memory storage: Map<processName, executions[]>
  const storage = new Map<string, Execution[]>();
  let idCounter = 0;

  return {
    forProcess: (processName: string): ProcessExecutionHistory => ({
      recordExecution: (data: Omit<ExecutionData, 'processName'>) =>
        Effect.sync(() => {
          const execution: Execution = {
            id: String(++idCounter),
            processName,
            executedAt: data.executedAt,
            isStartupRun: data.isStartupRun,
            durationMs: data.durationMs ?? null,
            success: data.success,
            errorMessage: data.errorMessage ?? null,
          };

          const existing = storage.get(processName) || [];
          existing.push(execution);
          storage.set(processName, existing);
        }),

      getExecutions: (dateRange?: DateRange) =>
        Effect.sync(() => {
          const executions = storage.get(processName) || [];
          
          if (!dateRange) return executions;
          
          return executions.filter(e => 
            e.executedAt >= dateRange.start && 
            e.executedAt <= dateRange.end
          );
        }),

      getLastRun: () =>
        Effect.sync(() => {
          const executions = storage.get(processName) || [];
          if (executions.length === 0) return null;
          
          // Return most recent execution
          const sorted = [...executions].sort((a, b) => 
            b.executedAt.getTime() - a.executedAt.getTime()
          );
          return sorted[0]?.executedAt || null;
        }),

      getRunCount: (dateRange?: DateRange) =>
        Effect.sync(() => {
          const executions = storage.get(processName) || [];
          
          if (!dateRange) return executions.length;
          
          return executions.filter(e => 
            e.executedAt >= dateRange.start && 
            e.executedAt <= dateRange.end
          ).length;
        }),

      getFirstStartupRun: () =>
        Effect.sync(() => {
          const executions = storage.get(processName) || [];
          const startupRuns = executions.filter(e => e.isStartupRun);
          
          if (startupRuns.length === 0) return null;
          
          // Return earliest startup run
          const sorted = [...startupRuns].sort((a, b) => 
            a.executedAt.getTime() - b.executedAt.getTime()
          );
          return sorted[0]?.executedAt || null;
        }),

      isFirstRunSinceRestart: () =>
        Effect.sync(() => {
          const executions = storage.get(processName) || [];
          const hasStartupRun = executions.some(e => e.isStartupRun);
          return !hasStartupRun; // First run if no startup run recorded yet
        }),
    }),
  };
});

/**
 * ExecutionHistory - Process Execution Tracking Service
 * 
 * @remarks
 * Effect service for tracking process execution history. Provides persistent storage
 * for execution analytics, monitoring, and tracking across application restarts.
 * 
 * The default implementation uses in-memory storage (data lost on restart).
 * For production, implement a custom storage backend (see examples/prisma-storage.ts).
 * 
 * @example
 * ```typescript
 * import { ExecutionHistory, Process, ProcessManager } from "@nikscripts/effect-pm";
 * import { Effect } from "effect";
 * 
 * const program = Effect.gen(function* () {
 *   const history = yield* ExecutionHistory;
 *   const processHistory = history.forProcess("my-process");
 *   
 *   yield* processHistory.recordExecution({
 *     executedAt: new Date(),
 *     isStartupRun: false,
 *     success: true,
 *     durationMs: 1500,
 *   });
 * });
 * 
 * // Use default in-memory storage
 * program.pipe(
 *   Effect.provide(ExecutionHistory.layer),
 *   Effect.runPromise
 * );
 * ```
 * 
 * @example
 * ```typescript
 * // With custom persistent storage
 * import { ExecutionHistoryPrismaLayer } from "./my-prisma-storage";
 * 
 * program.pipe(
 *   Effect.provide(ExecutionHistoryPrismaLayer),
 *   Effect.runPromise
 * );
 * ```
 * 
 * @public
 */
export class ExecutionHistory extends Context.Service<
  ExecutionHistory,
  ExecutionHistoryInterface
>()("ExecutionHistory", {
  make: makeInMemoryExecutionHistory,
}) {}

export namespace ExecutionHistory {
  export const layer = Layer.effect(ExecutionHistory, makeInMemoryExecutionHistory);
}