/**
 * ============================================================================
 * ProcessManager - Example & Documentation
 * ============================================================================
 *
 * Complete example demonstrating process orchestration with Effect.
 *
 * WHAT THIS DEMONSTRATES:
 * - QueueResource: Managed execution queues with priority scheduling
 * - Process: Scheduled tasks with cron expressions
 * - ProcessManager: Unified orchestration and control
 * - ExecutionHistory: Automatic tracking and analytics
 * - CLI: Command-line interface for runtime control
 *
 * ============================================================================
 * THE SYSTEM
 * ============================================================================
 *
 * 1. PROCESS - Scheduled Task Execution
 *    Create tasks that run on cron schedules with automatic execution tracking.
 *
 * 2. QUEUE RESOURCE - Managed Effect Execution
 *    Priority-based execution with concurrency control, rate limiting,
 *    and comprehensive resource management.
 *
 * 3. PROCESS MANAGER - Orchestration Layer
 *    Unified control and monitoring for all processes and queues.
 *
 * 4. EXECUTION HISTORY - Analytics & Tracking
 *    Automatic tracking of all process executions with queryable history.
 *
 * 5. CLI - Command Line Interface
 *    Runtime control and monitoring via command-line interface.
 *
 * ============================================================================
 * CODE WALKTHROUGH
 * ============================================================================
 */

/**
 * ProcessManager Example
 *
 * @remarks
 * This example demonstrates the full ProcessManager system with queues
 * and scheduled processes. Uses in-memory ExecutionHistory for execution tracking -
 * perfect for development and testing without external dependencies.
 *
 * **For Production:**
 * Replace `ExecutionHistory.layer` with a persistent storage implementation:
 * ```typescript
 * import { ExecutionHistoryPrismaLayer } from "./my-prisma-storage";
 *
 * program.pipe(
 *   Effect.provide(ExecutionHistoryPrismaLayer),
 *   Effect.runPromise
 * );
 * ```
 *
 * See `examples/prisma-storage.ts` for a complete Prisma implementation.
 */

import { Effect, Duration, Logger, Cron, Data, Resource, Layer, References } from "effect";
import {
  Process,
  ExecutionHistory,
  QueueResource,
  ProcessManager,
} from "../src";

/**
 * ============================================================================
 * CREATING QUEUE RESOURCES
 * ============================================================================
 *
 * QueueResource.make() creates a managed execution queue for processing items
 * with priority levels, concurrency control, and rate limiting.
 *
 * How it works:
 * -------------
 *
 * 1. YIELD THE TAG: Use the returned service tag to access the queue in Effects
 *    Example:
 *      const queue = yield* DemoQueue;  // Get the queue anywhere
 *      yield* queue.add(["item1", "item2"]);
 *
 * 2. PROVIDE THE LAYER: Use `.layer` to provide the implementation
 *    Example:
 *      Effect.provide(DemoQueue.layer)
 *
 * 3. SINGLE INSTANCE: Effect ensures only ONE instance of each queue exists
 *    No accidental duplicates, no synchronization issues.
 *
 * 4. TYPE SAFETY: `QueueResource.make` infers `T`, `R`, and `E` from `effect`.
 *    When `E` is not `never`, `forkWith` is required and must return
 *    **`Effect<void, never, …>`** (void success, all failures from `forked` handled).
 *
 */

/**
 * Example tagged error for the demo queue’s failure channel (`E`).
 * `yield*` this value inside `Effect.gen` so `E` is `DemoQueueItemError`, not `R`.
 */
export class DemoQueueItemError extends Data.TaggedError("DemoQueueItemError")<{
  readonly item: string;
  readonly reason: string;
}> { }

// Demo queues
export const DemoQueue = QueueResource.make({
  name: "demo-queue",
  effect: (item: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processing: ${item}`);
      yield* Effect.sleep(Duration.millis(1000)); // Simulate work
      return yield* new DemoQueueItemError({
        item,
        reason: `Error processing ${item}`,
      });
    }),
  forkWith: (forked, _item, _queue) =>
    forked.pipe(
      Effect.catchTag("DemoQueueItemError", (error) =>
        Effect.logError(`${error.item}: ${error.reason}`)
      )
    ),
  throttle: {
    limit: 10,
    duration: Duration.seconds(1),
  },
  concurrency: 3,
  capacity: 100,
});

const DemoTwoQueue = QueueResource.make({
  name: "demo-two-queue",
  effect: (item: number) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processing number: ${item}`);
      yield* Effect.sleep(Duration.millis(1000)); // Simulate work
      return item * 2;
    }),
  forkWith: (forked, item, _queue) =>
    forked.pipe(
      Effect.tap(() => Effect.logInfo("Forked: ", item)),
      Effect.catch((error) => {
        // error could be any remaining error type
        console.log("Unexpected error:", error)
        return Effect.void
      })
    ),
  concurrency: 2,
  capacity: 50,
});

/**
 * ============================================================================
 * CREATING SCHEDULED PROCESSES
 * ============================================================================
 *
 * Process.make() creates a scheduled task that runs on a cron schedule.
 *
 * CONFIGURATION:
 * - name: Unique identifier for the process
 * - crons: Cron.make() defines WHEN it runs (seconds, minutes, hours, etc.)
 * - effect: The Effect that gets executed on schedule
 *
 * This demonstrates how queue resources and Processes work together:
 * 1. The process wakes up every 10 seconds (defined in the schedule)
 * 2. It yields both queue services (DemoQueue, DemoTwoQueue)
 * 3. It adds new items to both queues
 * 4. The queues process those items according to their configuration
 *
 * ANALYTICS: Every execution is automatically tracked in ExecutionHistory.
 * You can query execution history, success/failure rates, and timing data.
 */

// Demo cron that adds items to queues
const queueAdderCron = Process.make({
  name: "queue-adder",
  crons: Cron.make({
    seconds: [0, 10, 20, 30, 40, 50], // Every 10 seconds
    minutes: [],
    hours: [],
    days: [],
    months: [],
    weekdays: [],
  }),
  effect: Effect.gen(function* () {
    const demoQueue = yield* DemoQueue;
    const demoTwoQueue = yield* DemoTwoQueue;
    const timestamp = Date.now();

    yield* Effect.logInfo(`🔄 Cron adding items to demo queues...`);

    // Add to string queue
    yield* demoQueue.add([
      `cron-item-${timestamp}`,
      `cron-item-${timestamp + 1}`,
    ]);

    // Add to number queue
    yield* demoTwoQueue.add([timestamp, timestamp + 1]);

    yield* Effect.logInfo(`✅ Added items to both demo queues`);
  }),
});

const CONTROL_PORT = Number(process.env.HOME_SERVER_PORT) || 3001;

/**
 * ============================================================================
 * ASSEMBLING THE PROCESS MANAGER
 * ============================================================================
 *
 * ProcessManager.make() brings everything together:
 *
 * CONFIG:
 * - processes: Array of scheduled processes to manage
 * - queues: Array of queue resource service tags
 *
 * The ProcessManager will:
 * 1. Track all processes and queues
 * 2. Provide start/stop/restart controls for each
 * 3. Collect status and metrics
 * 4. Expose everything through the CLI and control API
 *
 * DEPENDENCY FLOW:
 * - We pass queue TAGS (DemoQueue, DemoTwoQueue) to ProcessManager.make
 * - We provide queue layers (`.layer`) at runtime via Effect.provide
 * - Effect's dependency system matches them up automatically
 * - This ensures type safety and single instances
 */

// Demo program
const program = Effect.gen(function* () {
  // Create the ProcessManager with our demo processes and queues
  const pm = yield* ProcessManager.make({
    processes: [queueAdderCron],
    queues: [DemoQueue, DemoTwoQueue],
  });

  yield* Effect.logInfo("🚀 Starting Demo ProcessManager...");
  yield* Effect.logInfo(`📝 Processes: 1 cron (queue-adder)`);
  yield* Effect.logInfo(`🔄 Queues: 2 (DemoQueue, DemoTwoQueue)`);
  yield* Effect.logInfo(`⏰ Schedule: Every 10 seconds`);

  // Start control API for CLI access
  yield* pm.serve({ port: CONTROL_PORT });

  // Auto-start all processes
  yield* pm.startAll();

  yield* Effect.logInfo("✅ Demo is running. Try these commands:");
  yield* Effect.logInfo("   npm run cli ls");
  yield* Effect.logInfo("   npm run cli status queue-adder");
  yield* Effect.logInfo("   npm run cli queues");
  yield* Effect.logInfo("   Press Ctrl+C to stop.");

  yield* pm.awaitShutdown({
    logMessage: (signal) => `📡 Received ${signal}, shutting down gracefully...`,
  });
}).pipe(Effect.scoped);

/**
 * ============================================================================
 * PROVIDING DEPENDENCIES & RUNNING
 * ============================================================================
 *
 * Effect's dependency system requires us to "provide" all services before
 * the program can run. Think of it like this:
 *
 * 1. Our program says "I need DemoQueue, DemoTwoQueue, ExecutionHistory"
 * 2. We provide the implementations (`.layer` for each tag) for each service
 * 3. Effect wires everything together automatically
 * 4. The program runs with all dependencies satisfied
 *
 * LAYER COMPOSITION:
 * - DemoQueue.layer: Provides the DemoQueue resource
 * - DemoTwoQueue.layer: Provides the DemoTwoQueue resource
 * - ExecutionHistory.layer: Provides in-memory execution history storage
 * - Logger.pretty: Provides nice formatted console logging
 *
 * The order of Effect.provide() calls doesn't matter - Effect figures out
 * the dependency graph and initializes services in the correct order.
 *
 * NOTE: ExecutionHistory.layer is in-memory, so data is lost on restart.
 * For production, use a persistent implementation (see examples/prisma-storage.ts).
 */

// Run the demo
Effect.runPromise(
  program.pipe(
    Effect.provide(DemoQueue.layer),
    Effect.provide(DemoTwoQueue.layer),
    Effect.provide(ExecutionHistory.layer), // In-memory storage (no external dependencies)
    Effect.provide(Layer.succeed(References.MinimumLogLevel, "Debug")),
  ),
)
  .then(() => {
    console.log("✅ Demo shutdown complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Demo failed:", err);
    process.exit(1);
  });
