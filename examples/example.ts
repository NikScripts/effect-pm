/**
 * ============================================================================
 * SERVICES HUB - Example & Documentation
 * ============================================================================
 *
 * The Services Hub is the foundation that makes everything work in this application.
 * It manages all APIs, scrapers, scheduled tasks, and resource-intensive operations.
 * This is how services get scheduled, how they communicate, and how resources are
 * managed efficiently and safely.
 *
 * For small, quick tasks you can call them directly. But for resource-intensive
 * operations, you need to manage and monitor their use - that's what this does.
 *
 * ============================================================================
 * THE 4-IN-ONE SYSTEM
 * ============================================================================
 *
 * 1. CRON HANDLER - Scheduling Service with Analytics
 *    ------------------------------------------------------
 *    Schedules tasks to run at specific times or intervals.
 *    Tracks execution history: when tasks last ran, when they'll run next,
 *    how many times they've executed, and more. Perfect for recurring jobs
 *    like checking for new comics every hour, or syncing data daily.
 *
 * 2. PRIORITY QUEUE - Advanced Task Queue System
 *    ------------------------------------------------------
 *    A fully-featured queueing service for managing resource-intensive tasks.
 *
 *    KEY FEATURES:
 *
 *    • Priority Levels (3 tiers: high, normal, low)
 *      Important tasks get processed before less important ones.
 *      Example: User-requested downloads get priority over background syncs.
 *
 *    • Rate Limiting / Throttling
 *      Control how frequently tasks can run - once per second, once per minute,
 *      or as fast as possible. Prevents overwhelming external APIs or databases.
 *
 *    • Concurrency Control
 *      Process 1 item at a time, 5 at a time, or 100 at a time - you choose.
 *      Example: Parse 5 web pages simultaneously without overwhelming the server.
 *
 *    • Queue Capacity (Memory Management)
 *      Set a maximum queue size (usually very high, like 50,000 items).
 *      When full, adding new items pauses until space opens up.
 *      This prevents memory leaks - if unlimited items could be queued,
 *      the application could run out of memory and crash.
 *
 *      When adding is paused, the code that's trying to add items simply waits -
 *      it doesn't fail or lose data, it just pauses until there's room.
 *
 *    • Cache & Rebuild Functions
 *      If something goes wrong and the queue stops, it can rebuild itself
 *      from a cache or database, returning everything to the way it was.
 *
 *    • Non-Blocking Success Callbacks
 *      After processing an item successfully, you might want to do additional work
 *      (like sending a notification or updating a dashboard). These callbacks
 *      run in the background without slowing down the queue - the queue moves
 *      on to the next item immediately while the callback finishes up on its own.
 *
 * 3. PROCESS MANAGER - Orchestration Layer
 *    ------------------------------------------------------
 *    Combines crons and queues so they work together and communicate.
 *    Provides unified control - start, stop, restart any process or queue.
 *    Tracks status, uptime, and health of all running services.
 *
 * 4. CLI - Command Line Interface
 *    ------------------------------------------------------
 *    A command-line tool to check on systems directly instead of through a
 *    web interface. Useful when debugging or when the web interface has issues.
 *    Commands: ls, status, start, stop, restart, pause, resume, etc.
 *
 * ============================================================================
 * CODE WALKTHROUGH
 * ============================================================================
 */

/**
 * ProcessManager Example
 * 
 * @remarks
 * This example demonstrates the full ProcessManager system with queues and cron jobs.
 * Uses in-memory storage (CronStorageLive) for execution history - perfect for
 * development and testing without external dependencies.
 * 
 * **For Production:**
 * Replace `CronStorageLive` with a persistent storage implementation:
 * ```typescript
 * import { CronStoragePrismaLayer } from "@your-org/process-manager-prisma";
 * 
 * program.pipe(
 *   Effect.provide(CronStoragePrismaLayer), // Persistent storage
 *   Effect.runPromise
 * );
 * ```
 */

import { Effect, Duration, Logger, Cron } from "effect";
import {
  CronStorage,
  startControlService,
  makeQueueService,
  createCronProcess,
  makeProcessManager
} from "../src";

/**
 * ============================================================================
 * CREATING QUEUES
 * ============================================================================
 *
 * makeQueueService returns a TUPLE: [ServiceTag, LayerImplementation]
 *
 * Why separate the identifier (tag) from the implementation (layer)?
 * ------------------------------------------------------------------
 *
 * 1. REUSABILITY: The ServiceTag can be used throughout your codebase to
 *    access the queue. You yield it in Effects to get the queue instance.
 *
 *    Example:
 *      const queue = yield* DemoQueue;  // Get the queue anywhere
 *      yield* queue.add(["item1", "item2"]);
 *
 * 2. SINGLE SOURCE OF TRUTH: By separating tag from implementation, Effect
 *    ensures there's only ever ONE instance of this queue in your application.
 *    No accidental duplicates, no synchronization issues.
 *
 * 3. DEPENDENCY INJECTION: The Layer (implementation) is provided at runtime,
 *    making it easy to swap implementations for testing or different environments.
 *
 * 4. TYPE SAFETY: TypeScript tracks that DemoQueue provides a
 *    PriorityQueueProcessor<string, string>, so type errors are caught at
 *    compile time, not runtime.
 */

// Demo queues
export const [DemoQueue, DemoQueueLive] = makeQueueService({
  name: "demo-queue",
  processor: (item: string) =>
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
  queueCapacity: 100,
});

const [DemoTwoQueue, DemoTwoQueueLive] = makeQueueService({
  name: "demo-two-queue",
  processor: (item: number) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processing number: ${item}`);
      yield* Effect.sleep(Duration.millis(1000)); // Simulate work
      return item * 2;
    }),
  concurrency: 2,
  queueCapacity: 50,
});

/**
 * ============================================================================
 * CREATING SCHEDULED TASKS (CRONS)
 * ============================================================================
 *
 * createCronProcess creates a scheduled task that runs on a timer.
 *
 * CONFIGURATION:
 * - name: Unique identifier for the cron
 * - crons: Cron.make() defines WHEN it runs (seconds, minutes, hours, etc.)
 * - program: The Effect that gets executed on schedule
 *
 * This cron demonstrates how queues and crons work together:
 * 1. The cron wakes up every 10 seconds (defined in the schedule)
 * 2. It yields both queue services (DemoQueue, DemoTwoQueue)
 * 3. It adds new items to both queues
 * 4. The queues process those items according to their own rules
 *
 * ANALYTICS: Every execution is automatically tracked in the database.
 * You can see execution history, success/failure rates, and timing data.
 */

// Demo cron that adds items to queues
const queueAdderCron = createCronProcess({
  name: "queue-adder",
  crons: Cron.make({
    seconds: [0, 10, 20, 30, 40, 50], // Every 10 seconds
    minutes: [],
    hours: [],
    days: [],
    months: [],
    weekdays: [],
  }),
  program: Effect.gen(function* () {
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
 * makeProcessManager brings everything together:
 *
 * CONFIG:
 * - processes: Array of cron handlers to manage
 * - queues: Array of queue service tags (the first item from the tuple)
 *
 * The ProcessManager will:
 * 1. Track all processes and queues
 * 2. Provide start/stop/restart controls for each
 * 3. Collect status and metrics
 * 4. Expose everything through the CLI and (future) web interface
 *
 * DEPENDENCY FLOW:
 * - We pass queue TAGS (DemoQueue, DemoTwoQueue) to makeProcessManager
 * - We provide queue LAYERS (DemoQueueLive, DemoTwoQueueLive) at runtime
 * - Effect's dependency system matches them up automatically
 * - This ensures type safety and single instances
 */

// Demo program
const program = Effect.gen(function* () {
  // Create the ProcessManager with our demo processes and queues
  const pm = yield* makeProcessManager({
    processes: [queueAdderCron],
    queues: [DemoQueue, DemoTwoQueue],
  });

  yield* Effect.logInfo("🚀 Starting Demo ProcessManager...");
  yield* Effect.logInfo(`📝 Processes: 1 cron (queue-adder)`);
  yield* Effect.logInfo(`🔄 Queues: 2 queues (DemoQueue, DemoTwoQueue)`);
  yield* Effect.logInfo(`⏰ Schedule: Every 10 seconds`);

  // Start control API for CLI access
  yield* startControlService({ port: CONTROL_PORT, pm: pm });

  // Auto-start all processes
  yield* pm.startAll();

  yield* Effect.logInfo("✅ Demo is running. Try these commands:");
  yield* Effect.logInfo("   npm run sb ls");
  yield* Effect.logInfo("   npm run sb status queue-adder");
  yield* Effect.logInfo("   npm run sb queues");
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
 * 1. Our program says "I need DemoQueue, DemoTwoQueue, and ProcessManager deps"
 * 2. We provide the implementations (Layers) for each service
 * 3. Effect wires everything together automatically
 * 4. The program runs with all dependencies satisfied
 *
 * LAYER COMPOSITION:
 * - ProcessManagerLive: Provides the ProcessManager service factory
 * - DemoQueueLive & DemoTwoQueueLive: Provide our queue implementations
 * - CronStorageLive: Provides in-memory cron execution history storage
 * - Logger.pretty: Provides nice formatted console logging
 *
 * The order of Effect.provide() calls doesn't matter - Effect figures out
 * the dependency graph and initializes services in the correct order.
 * 
 * NOTE: CronStorageLive is in-memory, so execution history is lost on restart.
 * For production, use a persistent storage implementation like CronStoragePrismaLayer.
 */

// Run the demo
Effect.runPromise(
  program.pipe(
    Effect.provide(DemoQueueLive),
    Effect.provide(DemoTwoQueueLive),
    Effect.provide(CronStorage.Default), // In-memory storage (no external dependencies)
    Effect.provide(Logger.pretty),
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
