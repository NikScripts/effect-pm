/**
 * Cron Storage - Execution History and Analytics
 * 
 * Provides persistent storage for cron execution history, enabling analytics,
 * monitoring, and execution tracking across application restarts.
 * 
 * @remarks
 * Key features:
 * - Program-scoped storage interface
 * - Execution history tracking
 * - Success/failure recording
 * - Startup run detection
 * - Date range queries
 * - Pluggable storage backends (in-memory, Prisma, etc.)
 * 
 * @module cron-storage
 */

import { Effect, Data } from "effect";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Cron storage operation error
 * 
 * @remarks
 * Thrown when storage operations fail (database errors, etc.)
 * 
 * @public
 */
export class CronStorageError extends Data.TaggedError("CronStorageError")<{
  /** Error reason/message */
  reason: string;
  /** Operation that failed */
  operation: string;
  /** Program name if applicable */
  programName?: string;
}> {}

// ============================================================================
// Public Types
// ============================================================================

/**
 * Data for recording a cron execution
 * 
 * @remarks
 * Contains all information about a single execution of a cron process.
 * 
 * @public
 */
export interface CronExecutionData {
  /** Name of the cron program */
  programName: string;
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
 * Stored cron execution record
 * 
 * @remarks
 * The persisted form of a cron execution with a unique ID.
 * 
 * @public
 */
export interface CronExecution {
  /** Unique execution identifier */
  id: string;
  /** Name of the cron program */
  programName: string;
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
 * Program-scoped storage interface
 * 
 * @remarks
 * Provides storage operations for a specific cron program.
 * Obtained via {@link CronStorageInterface.forProgram}.
 * 
 * All operations are scoped to the program, so programName doesn't need
 * to be passed to each method.
 * 
 * @public
 */
export interface ProgramCronStorage {
  /**
   * Record a cron execution
   * 
   * @param data - Execution data (programName is automatically added)
   */
  recordExecution: (data: Omit<CronExecutionData, 'programName'>) => Effect.Effect<void, CronStorageError, never>;
  
  /**
   * Get execution history
   * 
   * @param dateRange - Optional date range to filter results
   * @returns Array of executions
   */
  getExecutions: (dateRange?: DateRange) => Effect.Effect<CronExecution[], CronStorageError, never>;
  
  /**
   * Get most recent execution time
   * 
   * @returns Date of last execution (null if never run)
   */
  getLastRun: () => Effect.Effect<Date | null, CronStorageError, never>;
  
  /**
   * Get total execution count
   * 
   * @param dateRange - Optional date range to filter count
   * @returns Number of executions
   */
  getRunCount: (dateRange?: DateRange) => Effect.Effect<number, CronStorageError, never>;
  
  /**
   * Get first startup run time
   * 
   * @returns Date of first startup run (null if hasn't run since startup)
   */
  getFirstStartupRun: () => Effect.Effect<Date | null, CronStorageError, never>;
  
  /**
   * Check if this is the first run since restart
   * 
   * @returns True if no startup run has been recorded yet
   */
  isFirstRunSinceRestart: () => Effect.Effect<boolean, CronStorageError, never>;
}

/**
 * Cron storage service interface
 * 
 * @remarks
 * Main interface for cron storage. Use {@link forProgram} to get a
 * program-scoped storage interface.
 * 
 * @public
 */
export interface CronStorageInterface {
  /**
   * Get program-scoped storage
   * 
   * @param programName - Name of the cron program
   * @returns Storage interface scoped to the program
   */
  forProgram: (programName: string) => ProgramCronStorage;
}

// ============================================================================
// Default Implementation
// ============================================================================

/**
 * Create in-memory cron storage implementation
 * 
 * @remarks
 * Creates a fast, simple in-memory storage for cron execution history.
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
 * Consider using a persistent implementation like `CronStoragePrismaLayer`
 * to retain execution history across restarts.
 * 
 * @returns Effect producing a CronStorageInterface
 * 
 * @internal
 */
const makeInMemoryCronStorage = Effect.sync(() => {
  // Warn users that this is in-memory storage
  console.warn(
    '\n⚠️  WARNING: Using in-memory CronStorage (CronStorageLive)\n' +
    '   Execution history will be lost on restart.\n' +
    '   For production, use a persistent storage implementation.\n' +
    '   See: https://github.com/nikscripts/effect-pm/tree/main/examples/prisma-storage.ts\n'
  );

  // In-memory storage: Map<programName, executions[]>
  const storage = new Map<string, CronExecution[]>();
  let idCounter = 0;

  return {
    forProgram: (programName: string): ProgramCronStorage => ({
      recordExecution: (data: Omit<CronExecutionData, 'programName'>) =>
        Effect.sync(() => {
          const execution: CronExecution = {
            id: String(++idCounter),
            programName,
            executedAt: data.executedAt,
            isStartupRun: data.isStartupRun,
            durationMs: data.durationMs ?? null,
            success: data.success,
            errorMessage: data.errorMessage ?? null,
          };

          const existing = storage.get(programName) || [];
          existing.push(execution);
          storage.set(programName, existing);
        }),

      getExecutions: (dateRange?: DateRange) =>
        Effect.sync(() => {
          const executions = storage.get(programName) || [];
          
          if (!dateRange) return executions;
          
          return executions.filter(e => 
            e.executedAt >= dateRange.start && 
            e.executedAt <= dateRange.end
          );
        }),

      getLastRun: () =>
        Effect.sync(() => {
          const executions = storage.get(programName) || [];
          if (executions.length === 0) return null;
          
          // Return most recent execution
          const sorted = [...executions].sort((a, b) => 
            b.executedAt.getTime() - a.executedAt.getTime()
          );
          return sorted[0]?.executedAt || null;
        }),

      getRunCount: (dateRange?: DateRange) =>
        Effect.sync(() => {
          const executions = storage.get(programName) || [];
          
          if (!dateRange) return executions.length;
          
          return executions.filter(e => 
            e.executedAt >= dateRange.start && 
            e.executedAt <= dateRange.end
          ).length;
        }),

      getFirstStartupRun: () =>
        Effect.sync(() => {
          const executions = storage.get(programName) || [];
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
          const executions = storage.get(programName) || [];
          const hasStartupRun = executions.some(e => e.isStartupRun);
          return !hasStartupRun; // First run if no startup run recorded yet
        }),
    }),
  };
});

/**
 * Default CronStorage Layer (In-Memory)
 * 
 * @remarks
 * Provides an in-memory implementation of CronStorage. Perfect for development,
 * testing, and applications that don't need persistent execution history.
 * 
 * **Characteristics:**
 * - No configuration required
 * - No external dependencies
 * - Fast performance
 * - Data is lost on application restart
 * 
 * **For Production Use:**
 * Replace with a persistent implementation:
 * ```typescript
 * import { CronStoragePrismaLayer } from "./cron-storage-prisma";
 * 
 * program.pipe(
 *   Effect.provide(CronStoragePrismaLayer), // Instead of CronStorageLive
 *   Effect.runPromise
 * );
 * ```
 * 
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const storage = yield* CronStorage;
 *   // Use storage...
 * });
 * 
 * // Provide in-memory storage
 * program.pipe(
 *   Effect.provide(CronStorageLive),
 *   Effect.runPromise
 * );
 * ```
 * 
 * @public
 */
// export const CronStorageLive = Layer.effect(CronStorage, makeInMemoryCronStorage);

/**
 * Cron Storage Effect Service
 * 
 * @remarks
 * Use this service tag to access cron storage in your Effects.
 * 
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const storage = yield* CronStorage;
 *   const programStorage = storage.forProgram("my-cron");
 *   
 *   yield* programStorage.recordExecution({
 *     executedAt: new Date(),
 *     isStartupRun: false,
 *     success: true,
 *     durationMs: 1500,
 *   });
 * });
 * ```
 * 
 * @public
 */
// export class CronStorage extends Context.Tag("CronStorage")<
//   CronStorage,
//   CronStorageInterface
// >() {}
export class CronStorage extends Effect.Service<CronStorage>()("CronStorage", {
  accessors: true,
  effect: makeInMemoryCronStorage,
}) {}