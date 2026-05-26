import { ProcessStorage } from "../../src/ProcessStorage";
/**
 * @module examples/scenarios/full-process-group-with-queues-and-control-cli
 *
 * End-to-end ProcessGroup + queues + control CLI. Terminal A: `pnpm run example` — Terminal B: `pnpm run cli ls`
 */

import {
  Cause,
  Clock,
  Config,
  Duration,
  Effect,
  Exit,
  Data,
  Layer,
  Option,
  References,
} from "effect";
import {
  Process,
    QueueResource,
  ProcessGroup,
  Polling,
  ProcessSchedule,
  ControlService,
} from "../../src";
import { utcDateFromMillis } from "../../src/internal/utcDate";

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
 * 4. TYPE SAFETY: `QueueResource.make` infers `T`, requirements `R`, and `E` from `effect`.
 *    The optional `handler` receives the item `Exit` in a fork so workers keep moving.
 *
 */

/**
 * Example tagged error for the demo queue’s failure channel (`E`).
 * `yield*` this value inside `Effect.gen` so `E` is `DemoQueueItemError`, not ambient services `R`.
 */
export class DemoQueueItemError extends Data.TaggedError("DemoQueueItemError")<{
  readonly item: string;
  readonly reason: string;
}> { }

// Demo queues using the class service pattern
class DemoQueue extends QueueResource.Service<DemoQueue, string, DemoQueueItemError>()("demo-queue", {
  effect: (item: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processing: ${item}`);
      yield* Effect.sleep(Duration.millis(1000));
      return yield* new DemoQueueItemError({
        item,
        reason: `Error processing ${item}`,
      });
    }),
  onExit: ({ entry, exit }) =>
    Exit.match(exit, {
      onFailure: (cause) => Effect.logError(`${entry.item}: ${Cause.pretty(cause)}`),
      onSuccess: () => Effect.void,
    }),
  concurrency: 3,
  capacity: 100,
}) {}

class DemoTwoQueue extends QueueResource.Service<DemoTwoQueue, number, never>()("demo-two-queue", {
  effect: (item: number) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processing number: ${item}`);
      yield* Effect.sleep(Duration.millis(1000));
      yield* Effect.logInfo(`Derived value ${String(item * 2)} for demo`);
    }),
  onExit: ({ entry, exit }) =>
    Exit.match(exit, {
      onFailure: () => Effect.void,
      onSuccess: () => Effect.logInfo(`Forked: ${String(entry.item)}`),
    }),
  concurrency: 2,
  capacity: 50,
}) {}

/**
 * ============================================================================
 * CREATING MANAGED PROCESSES
 * ============================================================================
 *
 * `Process.make` wires a **long-running schedule driver** (`process.effect`) that:
 * - watches schedule entries and spawns run instances at each `startAt`;
 * - inside each running instance, waits for the next **poll** via {@link Polling.awaitNextTick};
 * - runs your `effect` once per tick (tracked in {@link ProcessStore} when provided), then naturally exits once the entry window closes.
 *
 * CONFIGURATION (typical):
 * - `name` — stable id for CLI / HTTP and analytics `entityId`
 * - `effect` — `Effect<void, E, R>`; failures are logged and recorded as failed executions
 * - `polling` — cadence between ticks while armed (here: every 10 seconds)
 * - `schedule` — in-memory or custom `ProcessScheduleService` layer (or initializer)
 *
 * This demo uses an open-ended schedule entry and spaced polling so the queue-adder
 * runs every 10 seconds under real wall time (no `TestClock` in this script).
 */

/**
 * Managed process: schedule driver runs `effect` on {@link Polling} cadence while
 * the active schedule entry remains open. Here one open-ended entry + spaced polling (~10s)
 * produce a steady “tick” that only needs the two queue services at runtime.
 *
 * @effect-expect-leaking DemoQueue | DemoTwoQueue
 */
class QueueAdderProcess extends Process.Service<QueueAdderProcess>()("queue-adder", {
  polling: Polling.spaced(Duration.seconds(10)),
  schedule: ProcessSchedule.inMemory([
    ProcessSchedule.at("queue-adder", utcDateFromMillis(0)),
  ]),
  effect: Effect.gen(function* () {
    const demoQueue = yield* DemoQueue;
    const demoTwoQueue = yield* DemoTwoQueue;
    const timestamp = yield* Clock.currentTimeMillis;

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
}) {}

/**
 * ============================================================================
 * ASSEMBLING THE PROCESS GROUP
 * ============================================================================
 *
 * ProcessGroup.make(id, entries) brings everything together:
 *
 * ENTRIES:
 * - process service declarations to manage
 * - queue resource service declarations to control
 *
 * The ProcessGroup will:
 * 1. Track all processes and queues
 * 2. Provide start/stop/restart controls for each
 * 3. Collect status and metrics
 * 4. Expose everything through the CLI and control API
 *
 * DEPENDENCY FLOW:
 * - We pass process and queue declarations to ProcessGroup.make
 * - We provide queue layers (`.layer`) at runtime via Effect.provide
 * - Effect's dependency system matches them up automatically
 * - This ensures type safety and single instances
 */

/**
 * End-to-end program: acquire group → expose control HTTP → start work → block on shutdown.
 * **`Effect.scoped`**: `ControlService.make` / internal scopes attach finalizers so fibers and listeners clean up.
 */
const mainLayer = Layer.mergeAll(
  QueueAdderProcess.layer.pipe(
    Layer.provide(Layer.mergeAll(DemoQueue.layer, DemoTwoQueue.layer)),
  ),
  DemoQueue.layer,
  DemoTwoQueue.layer,
  ProcessStorage.layer, // In-memory storage (no external dependencies)
  Layer.succeed(References.MinimumLogLevel, "Debug"),
);

const program = Effect.gen(function* () {
  const portRaw = yield* Config.string("HOME_SERVER_PORT").pipe(Config.option);
  const controlPort = Option.match(portRaw, {
    onNone: () => 3001,
    onSome: (s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : 3001;
    },
  });

  const group = yield* ProcessGroup.make("demo-process-group", [
    QueueAdderProcess,
    DemoQueue,
    DemoTwoQueue,
  ] as const);

  yield* Effect.logInfo("🚀 Starting Demo ProcessGroup...");
  yield* Effect.logInfo(`📝 Processes: 1 managed (queue-adder)`);
  yield* Effect.logInfo(`🔄 Queues: 2 (DemoQueue, DemoTwoQueue)`);
  yield* Effect.logInfo(`⏰ Polling: every 10 seconds (schedule: always armed)`);

  /** Localhost HTTP JSON API consumed by `pnpm run cli` (see `ControlService`). */
  yield* ControlService.make({ group, port: controlPort });

  /** Forks the process supervisor inside the group’s scopes. */
  yield* group.start(QueueAdderProcess);

  yield* Effect.logInfo("✅ Demo is running. Try these commands:");
  yield* Effect.logInfo("   pnpm run cli ls");
  yield* Effect.logInfo("   pnpm run cli status queue-adder");
  yield* Effect.logInfo("   pnpm run cli queues");
  yield* Effect.logInfo("   Press Ctrl+C to stop.");

  /**
   * Blocks until SIGINT/SIGTERM (Node). Success type is **`void`** so this `yield*` does not
   * collapse the whole `program` to `Effect<never, …>` under inference.
   */
  yield* group.awaitShutdown({
    logMessage: (signal) => `📡 Received ${signal}, shutting down gracefully...`,
  });
}).pipe(Effect.provide(mainLayer));

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
 * - ProcessStorage.layer: Provides in-memory analytics for executions + lifecycle
 * - Logger.pretty: Provides nice formatted console logging
 *
 * A **single** `Effect.provide(Layer.mergeAll(...))` is used so Effect builds one merged
 * context (good practice; avoids chained-provide lint warnings).
 *
 * `Polling` / `ProcessSchedule` passed to {@link Process.make} are merged into the
 * supervisor there; you do **not** need to provide them again at the program root.
 *
 * NOTE: ProcessStorage.layer is in-memory, so data is lost on restart. For local
 * durable analytics without a database, use `ProcessStorage.layerRuntimeStorage`
 * with `SQLiteRuntimeStorage.layer({ filename })` (see `@nikscripts/effect-pm/storage/sqlite`)
 * with Effect FileSystem / Path platform layers. For SQL-backed persistence,
 * use `PrismaRuntimeStorage.layerProcessStore({ client })` from
 * `@nikscripts/effect-pm/storage/prisma`.
 */

void Effect.runPromise(
  Effect.scoped(
    program.pipe(
      Effect.tap(() => Effect.logInfo("✅ Demo shutdown complete")),
    ),
  ),
);
