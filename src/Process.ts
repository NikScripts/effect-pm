/**
 * Process - Scheduled Task Management
 * 
 * Provides scheduled task execution with cron expressions, execution tracking,
 * and comprehensive status reporting.
 * 
 * @remarks
 * Key features:
 * - Cron-based scheduling using Effect's Cron.Cron
 * - Automatic execution tracking and analytics
 * - Support for multiple cron expressions
 * - Run-on-startup capability
 * - Immediate execution trigger
 * - Persistent execution history
 * 
 * @module Process
 */

import { Effect, Schedule, Cron } from "effect";
import { ExecutionHistory, type ExecutionHistoryError } from "./ExecutionHistory";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Detailed cron scheduling information
 * 
 * @remarks
 * Contains comprehensive details about a cron's execution history and schedule.
 * 
 * @public
 */
export interface CronDetails {
  /** When the cron last executed (null if never run) */
  lastRun: Date | null;
  /** Total number of executions */
  executions: number;
  /** When the cron will execute next */
  nextRun: Date;
  /** First execution after startup (null if hasn't run since startup) */
  firstStartup: Date | null;
  /** Cron expressions defining the schedule */
  crons: Cron.Cron[];
}

/**
 * Scheduled process status details
 * 
 * @remarks
 * Returned by {@link Process.getStatus}. Contains execution history
 * and next run information for a scheduled process.
 * 
 * @public
 */
export interface ScheduledProcessDetails {
  /** When the process last executed (null if never run) */
  lastRun: Date | null;
  /** Total number of executions */
  executions: number;
  /** When the process will execute next */
  nextRun: Date;
  /** First execution after startup (null if hasn't run since startup) */
  firstStartup: Date | null;
  /** Additional metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * Process Interface
 * 
 * @remarks
 * A self-contained scheduled process that runs according to a cron schedule.
 * Managed by ProcessManager for lifecycle control and monitoring.
 * 
 * **Features:**
 * - Automatic scheduling with Effect's Cron
 * - Execution tracking and analytics
 * - Status reporting with next run calculation
 * - Manual triggering via {@link runImmediately}
 * 
 * @typeParam R - Requirements type for the scheduled program
 * 
 * @public
 */
export interface Process<R> {
  /** Unique identifier for the process */
  readonly name: string;
  /** Process type discriminator (always "scheduled") */
  readonly type: "scheduled";
  /** The scheduled effect that runs on the cron schedule */
  readonly effect: Effect.Effect<void, ExecutionHistoryError, R | ExecutionHistory>;
  /**
   * Get current status and execution history
   * 
   * @param dateRange - Optional date range to filter execution count
   * @returns Effect producing process details
   */
  readonly getStatus: (dateRange?: {
    start: Date;
    end: Date;
  }) => Effect.Effect<ScheduledProcessDetails, ExecutionHistoryError, ExecutionHistory>;
  /**
   * Run the process immediately (bypasses schedule)
   * 
   * @remarks
   * Executes the program immediately without waiting for the next scheduled time.
   * Does not affect the regular schedule. Execution is tracked as a startup run.
   * 
   * @returns Effect that runs the program
   */
  readonly runImmediately: () => Effect.Effect<void, ExecutionHistoryError, R | ExecutionHistory>;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Calculate next execution time from cron expression(s)
 * 
 * @internal
 */
const getNextCronRun = (
  crons: Cron.Cron | Cron.Cron[],
  referenceTime: Date = new Date()
): Date => {
  const cronArray = Array.isArray(crons) ? crons : [crons];

  // Get all next runs and find the earliest
  const nextRuns = cronArray.map(cron => Cron.next(cron, referenceTime));
  return new Date(Math.min(...nextRuns.map(d => d.getTime())));
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a scheduled process (internal implementation)
 * 
 * @internal
 * @remarks
 * Internal function for creating scheduled processes. Use {@link Process.make} for the public API.
 * 
 * Creates a self-contained scheduled task that runs according to cron expressions.
 * The process automatically:
 * - Schedules execution using Effect's Cron scheduler
 * - Tracks all executions in ExecutionHistory
 * - Reports execution history and status
 * - Supports manual triggering via `runImmediately()`
 * 
 * **Cron Expression Support:**
 * - Single cron: Runs on that schedule
 * - Multiple crons: Runs when ANY cron matches (union)
 * 
 * **Execution Tracking:**
 * - Every execution is recorded with timestamp and duration
 * - Success/failure status is tracked
 * - First startup run is marked separately
 * 
 * @typeParam R - Requirements type for the program effect
 * 
 * @param params - Configuration object
 * @param params.name - Unique identifier for the process
 * @param params.crons - Single or multiple cron expressions
 * @param params.program - Effect to execute on schedule
 * 
 * @returns Process that can be managed by ProcessManager
 */
const createScheduledProcess = <R>(params: {
  name: string;
  crons: Cron.Cron | Cron.Cron[];
  program: Effect.Effect<void, never, R>;
}): Process<R> => {
  const { name, crons, program } = params;
  const cronArray = Array.isArray(crons) ? crons : [crons];

  // Enhanced program that tracks execution
  const trackedProgram = Effect.gen(function* () {
    const storage = yield* ExecutionHistory;
    const programStorage = storage.forProcess(name);
    
    const startTime = Date.now();
    const executedAt = new Date();

    // Check if this is the first run since restart
    const isStartupRun = yield* programStorage.isFirstRunSinceRestart();

    try {
      // Run the actual program
      yield* program;

      // Record successful execution
      yield* programStorage.recordExecution({
        executedAt,
        isStartupRun,
        durationMs: Date.now() - startTime,
        success: true,
      });

      yield* Effect.logDebug(
        `✅ Cron program '${name}' executed at ${executedAt.toISOString()}`,
      );
    } catch (error) {
      // Record failed execution
      yield* programStorage.recordExecution({
        executedAt,
        isStartupRun,
        durationMs: Date.now() - startTime,
        success: false,
        errorMessage: String(error),
      });

      yield* Effect.logError(
        `❌ Cron program '${name}' failed at ${executedAt.toISOString()}: ${error}`,
      );
      throw error;
    }
  });

  // Create the scheduled effect
  const scheduledEffect = Effect.gen(function* () {
    // Set up the cron schedule
    const cronSchedule =
      cronArray.length === 1
        ? Schedule.cron(cronArray[0]!)
        : cronArray
            .map((cron) => Schedule.cron(cron))
            .reduce(
              (a, b) =>
                Schedule.union(a, b) as unknown as Schedule.Schedule<
                  [number, number],
                  unknown,
                  never
                >,
            );

    // Run the tracked program on schedule only
    yield* Effect.schedule(trackedProgram, cronSchedule);
  });

  // Get details method (returns standardized process details)
  const getStatus = (dateRange?: {
    start: Date;
    end: Date;
  }): Effect.Effect<ScheduledProcessDetails, ExecutionHistoryError, ExecutionHistory> =>
    Effect.gen(function* () {
      const storage = yield* ExecutionHistory;
      const programStorage = storage.forProcess(name);
      
      const lastRun = yield* programStorage.getLastRun();
      const executions = yield* programStorage.getRunCount(dateRange);
      const firstStartup = yield* programStorage.getFirstStartupRun();

      // Calculate next run time
      const nextRun = getNextCronRun(crons, new Date());

      return {
        lastRun,
        executions,
        nextRun,
        firstStartup
      };
    });

  // Run immediately method (bypasses scheduler)
  const runImmediately = (): Effect.Effect<void, ExecutionHistoryError, R | ExecutionHistory> =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`🚀 Running '${name}' immediately...`);
      yield* trackedProgram;
      yield* Effect.logDebug(`✅ Completed immediate run of '${name}'`);
    });

  return {
    name,
    type: "scheduled",
    effect: scheduledEffect,
    getStatus,
    runImmediately,
  };
};

/**
 * Process - Scheduled Task Factory
 * 
 * @remarks
 * Factory for creating scheduled processes that run on cron schedules.
 * 
 * @example
 * ```typescript
 * import { Process } from "@nikscripts/effect-pm";
 * import { Cron, Effect } from "effect";
 * 
 * // Simple cron - runs every hour
 * const hourlyTask = Process.make({
 *   name: "hourly-task",
 *   crons: Cron.make({ minutes: [0] }),
 *   program: Effect.logInfo("Running hourly task"),
 * });
 * ```
 * 
 * @example
 * ```typescript
 * // Multiple crons - runs at 9 AM and 5 PM
 * const businessHours = Process.make({
 *   name: "business-hours",
 *   crons: [
 *     Cron.make({ hours: [9], minutes: [0] }),
 *     Cron.make({ hours: [17], minutes: [0] }),
 *   ],
 *   program: Effect.logInfo("Business hours check"),
 * });
 * ```
 * 
 * @example
 * ```typescript
 * // With dependencies
 * const dataSync = Process.make({
 *   name: "data-sync",
 *   crons: Cron.make({ hours: [2], minutes: [0] }), // 2 AM daily
 *   program: Effect.gen(function* () {
 *     const db = yield* Database;
 *     const pool = yield* ProcessingPool;
 *     
 *     const data = yield* db.fetchPending();
 *     yield* pool.add(data);
 *     yield* Effect.logInfo(\`Queued \${data.length} items\`);
 *   }),
 * });
 * ```
 * 
 * @public
 */
export const Process = {
  /**
   * Create a scheduled process
   * 
   * @typeParam R - Requirements type for the program effect
   * @param config - Process configuration
   * @returns Process that can be managed by ProcessManager
   */
  make: createScheduledProcess,
}