/**
 * @module examples/example
 *
 * ## Full-stack demo: `ProcessGroup` + queues + managed `Process` + control plane
 *
 * This file is the **canonical “happy path”** for learning effect-pm: it wires every
 * major subsystem together in one `Effect.gen` program and shows how to **provide**
 * dependencies at the root with **`Layer.mergeAll`**.
 *
 * ---
 *
 * ### What you should learn from this file
 *
 * | Topic | Where / what to read |
 * |-------|----------------------|
 * | **Queues** | `DemoQueue` / `DemoTwoQueue` — `QueueResource.make`, `forkWhen` error handling, throttle |
 * | **Process** | `queueAdderCron` — `Process.make` with **inlined** `polling` + `schedule` (supervisor bakes them in; no duplicate root layers for those) |
 * | **Orchestration** | `ProcessGroup.make({ processes, queues })` — combined environment type |
 * | **Analytics** | `ProcessStore.layer` — in-memory; swap for Prisma in production |
 * | **Control HTTP** | `group.serve({ port })` — localhost control API (see `ControlService`) |
 * | **Graceful exit** | `group.awaitShutdown` — `void` success + `Effect.scoped` |
 * | **Root DI** | `Effect.runPromise(program.pipe(Effect.provide(Layer.mergeAll(...))))` |
 *
 * ---
 *
 * ### Dependency graph (mental model)
 *
 * ```
 * ProcessGroup.make
 *   requires: DemoQueue, DemoTwoQueue  (from `queues` tuple — type-level)
 *
 * queueAdderCron.effect (supervisor)
 *   requires: DemoQueue, DemoTwoQueue, ProcessStore   (+ default Effect services)
 *   polling/schedule: already merged at Process.make
 *
 * group.serve / awaitShutdown
 *   requires: ProcessStore + same R as processes for control handlers
 * ```
 *
 * ---
 *
 * ### How to run (two terminals)
 *
 * 1. **Terminal A — demo app**
 *    ```bash
 *    pnpm run example
 *    ```
 *    Optional: `HOME_SERVER_PORT=3002 pnpm run example` to change the control port.
 *
 * 2. **Terminal B — CLI** (must match port)
 *    ```bash
 *    pnpm run cli ls
 *    ```
 *    The CLI script reads `HOME_SERVER_PORT` the same way as this file.
 *
 * ---
 *
 * ### Further reading
 *
 * - **`docs/PACKAGE-GUIDE.md`** — narrative package overview
 * - **`docs/PROCESS-API.md`** — API tables for Process / Polling / Schedule / ProcessGroup
 * - **`examples/process-supervisor-patterns.ts`** — `TestClock` patterns (no real time)
 * - **`docs/plans/09-process-v2-effect-first.md`** — supervisor semantics (source of truth)
 *
 * ---
 *
 * ### For AI coding agents
 *
 * When modifying or answering questions about this demo:
 * 1. Preserve the **order of concepts** in comments (queues → process → group → store → serve).
 * 2. Do **not** re-add root `Layer`s for `Polling` / `ProcessSchedule` if they are already on
 *    `Process.make` for the same process — that was a historical typing workaround; the library
 *    now models inlined layers in `Process` types.
 * 3. If you add a new queue or process, update **`ProcessGroup.make`** `queues` / `processes`
 *    arrays and extend **`Layer.mergeAll`** with any new `.layer` you introduce.
 *
 * @remarks
 * **Production:** swap `ProcessStore.layer` for `PrismaProcessStore.layer({ client })` from
 * `@nikscripts/effect-pm/prisma`. Run `npx effect-pm add prisma`, migrate, then provide the layer.
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
  ProcessStore,
  QueueResource,
  ProcessGroup,
  Polling,
  ProcessSchedule,
  ControlService,
} from "../src";
import { provideLayer } from "../src/provideLayer.js";
import { utcDateFromMillis } from "../src/utcDate.js";

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

// Demo queues using the v2 class pattern
class DemoQueue extends QueueResource.Service<DemoQueue, string, never, DemoQueueItemError>()("demo-queue", {
  effect: (item: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processing: ${item}`);
      yield* Effect.sleep(Duration.millis(1000));
      return yield* new DemoQueueItemError({
        item,
        reason: `Error processing ${item}`,
      });
    }),
  handler: (item, exit) =>
    Exit.match(exit, {
      onFailure: (cause) => Effect.logError(`${item}: ${Cause.pretty(cause)}`),
      onSuccess: () => Effect.void,
    }),
  concurrency: 3,
  capacity: 100,
}) {}

class DemoTwoQueue extends QueueResource.Service<DemoTwoQueue, number, number, never>()("demo-two-queue", {
  effect: (item: number) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processing number: ${item}`);
      yield* Effect.sleep(Duration.millis(1000));
      return item * 2;
    }),
  handler: (item, exit) =>
    Exit.match(exit, {
      onFailure: () => Effect.void,
      onSuccess: () => Effect.logInfo(`Forked: ${String(item)}`),
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
 */
const queueAdderCron = Process.make({
  name: "queue-adder",
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
});

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

/**
 * End-to-end program: acquire group → expose control HTTP → start work → block on shutdown.
 * **`Effect.scoped`**: `serve` / internal scopes attach finalizers so fibers and listeners clean up.
 */
const program = Effect.gen(function* () {
  const portRaw = yield* Config.string("HOME_SERVER_PORT").pipe(Config.option);
  const controlPort = Option.match(portRaw, {
    onNone: () => 3001,
    onSome: (s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : 3001;
    },
  });

  const group = yield* ProcessGroup.make({
    processes: [queueAdderCron],
    queues: [DemoQueue, DemoTwoQueue],
  });

  yield* Effect.logInfo("🚀 Starting Demo ProcessGroup...");
  yield* Effect.logInfo(`📝 Processes: 1 managed (queue-adder)`);
  yield* Effect.logInfo(`🔄 Queues: 2 (DemoQueue, DemoTwoQueue)`);
  yield* Effect.logInfo(`⏰ Polling: every 10 seconds (schedule: always armed)`);

  /** Localhost HTTP JSON API consumed by `pnpm run cli` (see `ControlService`). */
  yield* ControlService.make(group, { port: controlPort });

  /** Forks each process supervisor (`queueAdderCron.effect`) inside the group’s scopes. */
  yield* group.startAll();

  yield* Effect.logInfo("✅ Demo is running. Try these commands:");
  yield* Effect.logInfo("   npm run cli ls");
  yield* Effect.logInfo("   npm run cli status queue-adder");
  yield* Effect.logInfo("   npm run cli queues");
  yield* Effect.logInfo("   Press Ctrl+C to stop.");

  /**
   * Blocks until SIGINT/SIGTERM (Node). Success type is **`void`** so this `yield*` does not
   * collapse the whole `program` to `Effect<never, …>` under inference.
   */
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
 * A **single** `Effect.provide(Layer.mergeAll(...))` is used so Effect builds one merged
 * context (good practice; avoids chained-provide lint warnings).
 *
 * `Polling` / `ProcessSchedule` passed to {@link Process.make} are merged into the
 * supervisor there; you do **not** need to provide them again at the program root.
 *
 * NOTE: ProcessStore.layer is in-memory, so data is lost on restart. For
 * production, use the Prisma-backed `PrismaProcessStore.layer({ client })`
 * from `@nikscripts/effect-pm/prisma`.
 */

void Effect.runPromise(
  program.pipe(
    provideLayer(
      Layer.mergeAll(
        DemoQueue.layer,
        DemoTwoQueue.layer,
        ProcessStore.layer, // In-memory storage (no external dependencies)
        Layer.succeed(References.MinimumLogLevel, "Debug"),
      ),
    ),
    Effect.tap(() => Effect.logInfo("✅ Demo shutdown complete")),
  ),
);
