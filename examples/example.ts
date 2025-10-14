/**
 * ============================================================================
 * ProcessManager - Example & Documentation
 * ============================================================================
 *
 * Complete example demonstrating process orchestration with Effect.
 *
 * WHAT THIS DEMONSTRATES:
 * - ResourcePool: Managed execution pools with priority scheduling
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
 * 2. RESOURCE POOL - Managed Effect Execution
 *    Priority-based execution pools with concurrency control, rate limiting,
 *    and comprehensive resource management.
 *
 * 3. PROCESS MANAGER - Orchestration Layer
 *    Unified control and monitoring for all processes and resource pools.
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
 * This example demonstrates the full ProcessManager system with resource pools
 * and scheduled processes. Uses in-memory ExecutionHistory for execution tracking -
 * perfect for development and testing without external dependencies.
 * 
 * **For Production:**
 * Replace `ExecutionHistory.Default` with a persistent storage implementation:
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

import { Effect, Duration, Logger, Cron } from "effect";
import {
  Process,
  ExecutionHistory,
  ResourcePool,
  ProcessManager,
} from "../src";

/**
 * ============================================================================
 * CREATING RESOURCE POOLS
 * ============================================================================
 *
 * ResourcePool.make() creates a managed execution pool for processing items
 * with priority levels, concurrency control, and rate limiting.
 *
 * How it works:
 * -------------
 *
 * 1. YIELD THE TAG: Use the returned service tag to access the pool in Effects
 *    Example:
 *      const pool = yield* DemoPool;  // Get the pool anywhere
 *      yield* pool.add(["item1", "item2"]);
 *
 * 2. PROVIDE THE LAYER: Use .Default to provide the implementation
 *    Example:
 *      Effect.provide(DemoPool.Default)
 *
 * 3. SINGLE INSTANCE: Effect ensures only ONE instance of each pool exists
 *    No accidental duplicates, no synchronization issues.
 *
 * 4. TYPE SAFETY: TypeScript tracks the pool's item and result types,
 *    catching errors at compile time, not runtime.
 */

// Demo queues
export const DemoQueue = ResourcePool.make({
  name: "demo-queue",
  effect: (item: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processing: ${item}`);
      yield* Effect.sleep(Duration.millis(1000)); // Simulate work
      return `Processed: ${item}`;
    }),
  onSuccess: (result: string, item: string) => Effect.logInfo(result),
  onError: (error: Error, item: string) =>
    Effect.logError(`Error processing ${item}: ${error.message}`),
  throttle: {
    limit: 10,
    duration: Duration.seconds(1),
  },
  concurrency: 3,
  capacity: 100,
});

const DemoTwoQueue = ResourcePool.make({
  name: "demo-two-queue",
  effect: (item: number) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processing number: ${item}`);
      yield* Effect.sleep(Duration.millis(1000)); // Simulate work
      return item * 2;
    }),
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
 * This demonstrates how ResourcePools and Processes work together:
 * 1. The process wakes up every 10 seconds (defined in the schedule)
 * 2. It yields both pool services (DemoQueue, DemoTwoQueue)
 * 3. It adds new items to both pools
 * 4. The pools process those items according to their configuration
 *
 * ANALYTICS: Every execution is automatically tracked in ExecutionHistory.
 * You can query execution history, success/failure rates, and timing data.
 */

// Demo cron that adds items to pools
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
 * - pools: Array of resource pool service tags
 *
 * The ProcessManager will:
 * 1. Track all processes and resource pools
 * 2. Provide start/stop/restart controls for each
 * 3. Collect status and metrics
 * 4. Expose everything through the CLI and control API
 *
 * DEPENDENCY FLOW:
 * - We pass pool TAGS (DemoQueue, DemoTwoQueue) to ProcessManager.make
 * - We provide pool LAYERS (.Default) at runtime via Effect.provide
 * - Effect's dependency system matches them up automatically
 * - This ensures type safety and single instances
 */

// Demo program
const program = Effect.gen(function* () {
  // Create the ProcessManager with our demo processes and pools
  const pm = yield* ProcessManager.make({
    processes: [queueAdderCron],
    pools: [DemoQueue, DemoTwoQueue],
  });

  yield* Effect.logInfo("🚀 Starting Demo ProcessManager...");
  yield* Effect.logInfo(`📝 Processes: 1 cron (queue-adder)`);
  yield* Effect.logInfo(`🔄 Pools: 2 resource pools (DemoQueue, DemoTwoQueue)`);
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

  // Keep process running until signal received
  yield* Effect.async<never>((resume) => {
    const handleSignal = (signal: string) => {
      console.log(`\n📡 Received ${signal}, shutting down gracefully...`);
      resume(Effect.interrupt);
    };

    process.on("SIGINT", () => handleSignal("SIGINT"));
    process.on("SIGTERM", () => handleSignal("SIGTERM"));
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
 * 2. We provide the implementations (.Default layers) for each service
 * 3. Effect wires everything together automatically
 * 4. The program runs with all dependencies satisfied
 *
 * LAYER COMPOSITION:
 * - DemoQueue.Default: Provides the DemoQueue resource pool
 * - DemoTwoQueue.Default: Provides the DemoTwoQueue resource pool
 * - ExecutionHistory.Default: Provides in-memory execution history storage
 * - Logger.pretty: Provides nice formatted console logging
 *
 * The order of Effect.provide() calls doesn't matter - Effect figures out
 * the dependency graph and initializes services in the correct order.
 * 
 * NOTE: ExecutionHistory.Default is in-memory, so data is lost on restart.
 * For production, use a persistent implementation (see examples/prisma-storage.ts).
 */

// Run the demo
Effect.runPromise(
  program.pipe(
    Effect.provide(DemoQueue.Default),
    Effect.provide(DemoTwoQueue.Default),
    Effect.provide(ExecutionHistory.Default), // In-memory storage (no external dependencies)
    Effect.provide(Logger.pretty)
  )
)
  .then(() => {
    console.log("✅ Demo shutdown complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Demo failed:", err);
    process.exit(1);
  });
