/**
 * ============================================================================
 * ProcessGroup - Example & Documentation
 * ============================================================================
 *
 * Complete example demonstrating process orchestration with Effect.
 *
 * WHAT THIS DEMONSTRATES:
 * - QueueResource: Managed execution queues with priority scheduling
 * - Process: Supervised user `effect` with **polling** cadence and a **schedule gate**
 * - ProcessGroup: Unified orchestration and control for a cohesive bundle
 * - ProcessStore: Event-first analytics (executions + lifecycle)
 * - CLI: Command-line interface for runtime control
 *
 * MORE (v0.7+): **`examples/process-supervisor-patterns.ts`** (accelerating polling, disarm/rearm,
 * `TestClock`) and **`docs/PROCESS-API.md`** (full API tables).
 *
 * ============================================================================
 * THE SYSTEM
 * ============================================================================
 *
 * 1. PROCESS - Supervised repeat execution
 *    Combine {@link Polling} (how often to attempt a tick) and {@link ProcessSchedule}
 *    (whether ticks are armed — e.g. cron windows via `ProcessSchedule.cronMatch`).
 *
 * 2. QUEUE RESOURCE - Managed Effect Execution
 *    Priority-based execution with concurrency control, rate limiting,
 *    and comprehensive resource management.
 *
 * 3. PROCESS GROUP - Orchestration Layer
 *    Unified control and monitoring for the processes and queues that belong
 *    together. (Future: a top-level `ProcessManager` will coordinate multiple
 *    `ProcessGroup` instances across hosts.)
 *
 * 4. PROCESS STORE - Analytics & Lifecycle Events
 *    Single event-first store. In-memory by default; Prisma-backed for
 *    durable analytics via `@nikscripts/effect-pm/prisma`.
 *
 * 5. CLI - Command Line Interface
 *    Runtime control and monitoring via command-line interface.
 *
 * ============================================================================
 * CODE WALKTHROUGH
 * ============================================================================
 */

/**
 * ProcessGroup Example
 *
 * @remarks
 * This example demonstrates the full ProcessGroup system with queues
 * and scheduled processes. Uses the in-memory `ProcessStore` for execution
 * and lifecycle analytics — perfect for development and testing without
 * external dependencies.
 *
 * **For Production:**
 * Swap `ProcessStore.layer` for the Prisma-backed implementation:
 * ```typescript
 * import { PrismaClient } from "@prisma/client";
 * import { PrismaProcessStore } from "@nikscripts/effect-pm/prisma";
 *
 * const prisma = new PrismaClient();
 *
 * program.pipe(
 *   Effect.provide(PrismaProcessStore.layer({ client: prisma })),
 *   Effect.runPromise,
 * );
 * ```
 *
 * Run `npx effect-pm add prisma` once to add the required model to your
 * Prisma schema, then `prisma migrate dev`.
 */

import { Effect, Duration, Logger, Data, Resource, Layer, References } from "effect";
import {
  Process,
  ProcessStore,
  QueueResource,
  ProcessGroup,
  Polling,
  ProcessSchedule,
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
 * CREATING MANAGED PROCESSES
 * ============================================================================
 *
 * `Process.make` wires a **long-running supervisor** (`process.effect`) that:
 * - waits until {@link ProcessSchedule} says work is **armed** (hint-based or 5s fallback sleep when disarmed);
 * - when armed, waits for the next **poll** via {@link Polling.awaitNextTick};
 * - runs your `effect` once per tick (tracked in {@link ProcessStore} when provided), then repeats when disarmed → armed again.
 *
 * CONFIGURATION (typical):
 * - `name` — stable id for CLI / HTTP and analytics `entityId`
 * - `effect` — `Effect<void, E, R>`; failures are logged and recorded as failed executions
 * - `polling` — cadence between ticks while armed (here: every 10 seconds)
 * - `schedule` — gate: `alwaysArmed`, `cronMatch({ crons })`, or `fromArmedRef` for tests
 *
 * This demo keeps the gate always armed and uses spaced polling so the queue-adder
 * runs every 10 seconds under real wall time (no `TestClock` in this script).
 */

// Demo process that adds items to queues on a fixed poll cadence
const queueAdderCron = Process.make({
  name: "queue-adder",
  polling: Polling.spaced(Duration.seconds(10)),
  schedule: ProcessSchedule.alwaysArmed,
  effect: Effect.gen(function* () {
    const demoQueue = yield* DemoQueue;
    const demoTwoQueue = yield* DemoTwoQueue;
    const timestamp = Date.now();

    yield* Effect.logInfo(`🔄 Poll tick: adding items to demo queues...`);

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
 * ASSEMBLING THE PROCESS GROUP
 * ============================================================================
 *
 * ProcessGroup.make() brings everything together:
 *
 * CONFIG:
 * - processes: Array of scheduled processes to manage
 * - queues: Array of queue resource service tags
 *
 * The ProcessGroup will:
 * 1. Track all processes and queues
 * 2. Provide start/stop/restart controls for each
 * 3. Collect status and metrics
 * 4. Expose everything through the CLI and control API
 *
 * DEPENDENCY FLOW:
 * - We pass queue TAGS (DemoQueue, DemoTwoQueue) to ProcessGroup.make
 * - We provide queue layers (`.layer`) at runtime via Effect.provide
 * - Effect's dependency system matches them up automatically
 * - This ensures type safety and single instances
 */

// Demo program
const program = Effect.gen(function* () {
  // Create the ProcessGroup with our demo processes and queues
  const group = yield* ProcessGroup.make({
    processes: [queueAdderCron],
    queues: [DemoQueue, DemoTwoQueue],
  });

  yield* Effect.logInfo("🚀 Starting Demo ProcessGroup...");
  yield* Effect.logInfo(`📝 Processes: 1 managed (queue-adder)`);
  yield* Effect.logInfo(`🔄 Queues: 2 (DemoQueue, DemoTwoQueue)`);
  yield* Effect.logInfo(`⏰ Polling: every 10 seconds (schedule: always armed)`);

  // Start control API for CLI access
  yield* group.serve({ port: CONTROL_PORT });

  // Auto-start all processes
  yield* group.startAll();

  yield* Effect.logInfo("✅ Demo is running. Try these commands:");
  yield* Effect.logInfo("   npm run cli ls");
  yield* Effect.logInfo("   npm run cli status queue-adder");
  yield* Effect.logInfo("   npm run cli queues");
  yield* Effect.logInfo("   Press Ctrl+C to stop.");

  yield* group.awaitShutdown({
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
 * 1. Our program says "I need DemoQueue, DemoTwoQueue, ProcessStore"
 * 2. We provide the implementations (`.layer` for each tag) for each service
 * 3. Effect wires everything together automatically
 * 4. The program runs with all dependencies satisfied
 *
 * LAYER COMPOSITION:
 * - DemoQueue.layer: Provides the DemoQueue resource
 * - DemoTwoQueue.layer: Provides the DemoTwoQueue resource
 * - ProcessStore.layer: Provides in-memory analytics for executions + lifecycle
 * - Logger.pretty: Provides nice formatted console logging
 *
 * The order of Effect.provide() calls doesn't matter - Effect figures out
 * the dependency graph and initializes services in the correct order.
 *
 * NOTE: ProcessStore.layer is in-memory, so data is lost on restart. For
 * production, use the Prisma-backed `PrismaProcessStore.layer({ client })`
 * from `@nikscripts/effect-pm/prisma`.
 */

// Run the demo
Effect.runPromise(
  program.pipe(
    Effect.provide(DemoQueue.layer),
    Effect.provide(DemoTwoQueue.layer),
    Effect.provide(ProcessStore.layer), // In-memory storage (no external dependencies)
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
