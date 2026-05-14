/**
 * QueueResource — Effect-idiomatic managed priority queue with workers.
 *
 * Provides a three-level priority queue (high, normal, low) backed by bounded
 * Effect `Queue`s with configurable concurrency, deduplication, retry, persistence,
 * and lifecycle hooks. Workers are managed fibers tracked by `FiberSet`; pause/resume
 * is implemented via `Latch`; empty-queue blocking uses a `Deferred` wake signal to
 * avoid priority inversion.
 *
 * ## Entry points
 *
 * | Function | Purpose |
 * |----------|---------|
 * | `QueueResource.make` | Scoped Effect producing a {@link QueueHandle} |
 * | `QueueResource.layer` | Builds a `Layer` from tag + config |
 * | `QueueResource.Service` | Class factory: tag + baked-in `.layer` |
 * | `QueueResource.Tag` | Class factory: pure identity tag (no layer) |
 *
 * ## Usage
 *
 * ```ts
 * import { Effect, Layer } from "effect"
 * import { QueueResource } from "@nikscripts/effect-pm"
 *
 * // Declare service via class factory
 * const EmailQueue = QueueResource.Service<typeof EmailQueue, Email, void, SmtpError>()(
 *   "@app/EmailQueue",
 *   {
 *     effect: (email, ctx) => sendEmail(email),
 *     handler: (item, exit, ctx) =>
 *       Exit.match(exit, {
 *         onFailure: () => ctx.retry,
 *         onSuccess: () => Effect.void,
 *       }),
 *     concurrency: 5,
 *     retries: 3,
 *   },
 * )
 *
 * // Use in program
 * const program = Effect.gen(function*() {
 *   const queue = yield* EmailQueue
 *   yield* queue.add([email1, email2])
 * })
 *
 * program.pipe(Effect.provide(EmailQueue.layer))
 * ```
 *
 * @module QueueResource
 */

import {
  Cause,
  Context,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberSet,
  HashSet,
  Latch,
  Layer,
  Option,
  Queue,
  Ref,
  Semaphore,
} from "effect";
import {
  ProcessStore,
  type QueueItemCompletedEvent,
  type QueueItemStatus,
  type QueueLifecycleChangedEvent,
  type QueueLifecycleTag,
} from "./ProcessStore";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Priority level for queue items.
 *
 * - `"high"` — processed first (use for urgent/time-sensitive items)
 * - `"normal"` — default priority
 * - `"low"` — processed last (use for background/deferrable work)
 *
 * @public
 */
export type Priority = "high" | "normal" | "low";

/**
 * Enqueue a single item or a readonly batch of items.
 *
 * @public
 */
export interface QueueEnqueue<T> {
  (item: T): Effect.Effect<void>;
  (items: ReadonlyArray<T>): Effect.Effect<void>;
}

/**
 * The service interface returned from `yield* MyQueue`.
 *
 * All observation methods (`size`, `sizes`, `isEmpty`, `completed`) and lifecycle
 * actions (`pause`, `resume`, `shutdown`, `clear`) are effectful properties —
 * access them with `yield*` directly (no function call parentheses).
 *
 * Enqueue methods accept either a single item or a readonly array of items.
 *
 * @typeParam T - Item type processed by this queue
 * @typeParam _R - Success type of the item effect (phantom, used for type inference)
 * @typeParam _E - Error type of the item effect (phantom, used for type inference)
 *
 * @example
 * ```ts
 * const queue = yield* MyQueue
 * yield* queue.add(item1)
 * yield* queue.add([item2, item3])
 * yield* queue.prioritize(urgentItem)
 * const pending = yield* queue.size
 * yield* queue.pause
 * ```
 *
 * @public
 */
export interface QueueHandle<
  in out T,
  out _R = void,
  out _E = never,
> {
  /** Enqueue items at **normal** priority. */
  readonly add: QueueEnqueue<T>;
  /** Enqueue items at **high** priority (processed before normal and low). */
  readonly prioritize: QueueEnqueue<T>;
  /** Enqueue items at **low** priority (processed after high and normal). */
  readonly defer: QueueEnqueue<T>;

  /** Total pending items across all priority levels. */
  readonly size: Effect.Effect<number>;
  /** Pending item count per priority level. */
  readonly sizes: Effect.Effect<{
    readonly high: number;
    readonly normal: number;
    readonly low: number;
  }>;
  /** Whether all priority queues are empty. */
  readonly isEmpty: Effect.Effect<boolean>;
  /** Total items that have finished processing (success or failure). */
  readonly completed: Effect.Effect<number>;

  /**
   * Pause processing. Workers block before their next item.
   * Items can still be enqueued while paused — they accumulate in the queues.
   */
  readonly pause: Effect.Effect<void>;
  /**
   * Resume processing after a pause.
   * Workers unblock and process accumulated items in priority order.
   */
  readonly resume: Effect.Effect<void>;
  /**
   * Permanently stop the queue. Enqueue attempts after shutdown are logged
   * and silently dropped. Workers exit on their next iteration.
   */
  readonly shutdown: Effect.Effect<void>;
  /**
   * Drain all pending items from all priority queues and reset the completed
   * counter. Returns the number of items cleared. Workers remain alive.
   */
  readonly clear: Effect.Effect<number>;
}

/**
 * Context passed to the `effect` callback during item processing.
 *
 * Provides **guarded** enqueue operations for spawning derived/follow-up work.
 * Attempting to enqueue the same item (by reference or by `key`) logs a warning
 * and silently drops the item to prevent infinite processing loops.
 *
 * Use `ctx.retry` in the **handler** (not here) for intentional re-processing.
 *
 * @typeParam T - Item type
 *
 * @public
 */
export interface EffectContext<T> {
  /** Enqueue derived items at normal priority. Self-enqueue is warned and dropped. */
  readonly add: QueueEnqueue<T>;
  /** Enqueue derived items at high priority. Self-enqueue is warned and dropped. */
  readonly prioritize: QueueEnqueue<T>;
  /** Enqueue derived items at low priority. Self-enqueue is warned and dropped. */
  readonly defer: QueueEnqueue<T>;
  /** How many times this item has been processed (1 = first attempt). */
  readonly attempts: number;
  /** When the item first entered the queue as epoch millis (preserved across retries). */
  readonly enqueuedAt: number;
  /** The priority level this item was enqueued at. */
  readonly priority: Priority;
}

/**
 * Context passed to the `handler` callback after item processing.
 *
 * Includes `retry` — the only sanctioned way to re-process the same item.
 * Retry is a **re-enqueue** (back of the same priority queue), NOT an immediate
 * re-execution. The item waits in line behind other pending items.
 *
 * Enqueue operations here are **unguarded** — the handler is trusted to make
 * intentional routing decisions (retry, dead-letter, escalation, etc.).
 *
 * @typeParam T - Item type
 *
 * @public
 */
export interface HandlerContext<T> {
  /**
   * Re-enqueue this item at the same priority (back of the line).
   * Respects the `retries` limit — when exhausted, `onRetryExhausted` is called
   * and the item is NOT re-enqueued.
   */
  readonly retry: Effect.Effect<void>;
  /** Enqueue items at normal priority (unguarded). */
  readonly add: QueueEnqueue<T>;
  /** Enqueue items at high priority (unguarded). */
  readonly prioritize: QueueEnqueue<T>;
  /** Enqueue items at low priority (unguarded). */
  readonly defer: QueueEnqueue<T>;
  /** How many times this item has been processed (1 = first attempt). */
  readonly attempts: number;
  /** When the item first entered the queue as epoch millis (preserved across retries). */
  readonly enqueuedAt: number;
  /** The priority level this item was enqueued at. */
  readonly priority: Priority;
}

/**
 * Configuration for {@link QueueResource.make}.
 *
 * @typeParam T - Item type
 * @typeParam R - Success type of the item effect
 * @typeParam E - Error type of the item effect
 *
 * @public
 */
export interface QueueResourceConfig<T, R, E> {
  /** Queue name used for log annotations and error messages. @default "anonymous" */
  readonly name?: string;
  /** Start with processing paused. Call `resume` to begin. @default false */
  readonly paused?: boolean;
  /**
   * Process each item. Receives a guarded {@link EffectContext} for spawning
   * derived work. The exit of this effect determines success/failure for the item.
   */
  readonly effect: (
    item: T,
    ctx: EffectContext<T>,
  ) => Effect.Effect<R, E>;
  /**
   * Handle each item's result. **Always forked** — runs in its own fiber and
   * never blocks the worker from processing the next item.
   *
   * Receives the item, its `Exit`, and a {@link HandlerContext} with `retry`.
   * There is no automatic retry — the handler decides retry policy.
   *
   * When absent, failures are logged with a warning.
   */
  readonly handler?: (
    item: T,
    exit: Exit.Exit<R, E>,
    ctx: HandlerContext<T>,
  ) => Effect.Effect<void>;
  /** Max items processing concurrently (worker count). @default 5 */
  readonly concurrency?: number;
  /** Max items per priority queue (bounded backpressure). @default 50_000 */
  readonly capacity?: number;
  /**
   * Extract a deduplication key from each item. When set, items with a key
   * already in-flight (enqueued or processing) are silently dropped.
   * The key is released after processing completes (including handler).
   */
  readonly key?: (item: T) => string;
  /**
   * Max times an item may be re-enqueued via `ctx.retry` in the handler.
   * When exhausted, `onRetryExhausted` is called instead of re-enqueuing.
   * @default Infinity
   */
  readonly retries?: number;
  /** Called when `ctx.retry` is invoked but the retry limit is reached. */
  readonly onRetryExhausted?: (
    item: T,
    cause: Cause.Cause<E>,
  ) => Effect.Effect<void>;
  /**
   * Persist items on enqueue (before processing). Called with the batch and
   * priority level. Errors are logged and swallowed (fire-and-forget).
   */
  readonly persist?: (
    items: ReadonlyArray<T>,
    priority: Priority,
  ) => Effect.Effect<void>;
  /**
   * Refill the queue from an external source when all priority queues are empty.
   * Receives the queue handle for re-enqueuing. Errors are logged and swallowed.
   */
  readonly refill?: (queue: QueueHandle<T, R, E>) => Effect.Effect<void>;
  /**
   * Hook: fired after item(s) are enqueued. Receives the batch and priority.
   * Fire-and-forget — errors are logged and swallowed.
   */
  readonly onEnqueue?: (
    items: ReadonlyArray<T>,
    priority: Priority,
  ) => Effect.Effect<void>;
  /**
   * Hook: fired after each item's effect completes. Receives the item, its
   * Exit, and the elapsed Duration. Runs in a forked fiber (non-blocking).
   * Errors are logged and swallowed.
   */
  readonly onComplete?: (
    item: T,
    exit: Exit.Exit<R, E>,
    elapsed: Duration.Duration,
  ) => Effect.Effect<void>;
  /**
   * Hook: fired when all priority queues become empty (after drain, not idle).
   * Fire-and-forget — errors are logged and swallowed.
   */
  readonly onEmpty?: Effect.Effect<void>;
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Indicates an enqueue was attempted after the queue was shut down.
 * In practice this is logged as a warning and the items are dropped —
 * this error type exists for programmatic detection in tests/monitoring.
 *
 * @public
 */
export class QueueShutdownError extends Data.TaggedError(
  "QueueShutdownError",
)<{
  readonly queue: string;
}> {}

// ============================================================================
// Backwards-compat type alias for ProcessGroup
// ============================================================================


// ============================================================================
// Internal Utilities
// ============================================================================

const isReadonlyArray = <A>(input: A | ReadonlyArray<A>): input is ReadonlyArray<A> =>
  Array.isArray(input);

/** Normalize public enqueue input without treating arbitrary iterables as batches. */
function normalizeEnqueueInput<A>(input: A | ReadonlyArray<A>): ReadonlyArray<A> {
  return isReadonlyArray(input) ? input : [input];
}

// ============================================================================
// Internal Item Wrapper
// ============================================================================

/**
 * Internal envelope wrapping each item with queue metadata.
 * This is stripped before passing items to the user's `effect` callback.
 */
interface InternalItem<T> {
  readonly item: T;
  /** Number of times this item has been re-enqueued via retry. */
  readonly retries: number;
  /** Priority level the item was originally enqueued at. */
  readonly priority: Priority;
  /** Timestamp (ms since epoch) when the item first entered the queue. */
  readonly enqueuedAt: number;
  /** Cached dedup key (avoids recomputing `config.key` on each check). */
  readonly key: string | undefined;
}

// ============================================================================
// Core Implementation
// ============================================================================

/**
 * Internal factory: creates the scoped Effect that produces a {@link QueueHandle}.
 *
 * Architecture:
 * - Three bounded `Queue<InternalItem<T>>` (one per priority level)
 * - N worker fibers (managed by `FiberSet`) that loop: latch → take → latch → process
 * - `Latch` gates worker entry (pause/resume)
 * - `Deferred` wake signal for non-blocking empty-queue wait (avoids priority inversion)
 * - `Semaphore` for concurrency control within the worker pool
 * - Handler effects are forked into a separate `FiberSet` (never block workers)
 */
const makeQueueEffect = <T, R, E>(
  config: QueueResourceConfig<T, R, E>,
) =>
  Effect.gen(function* () {
    const queueName = config.name ?? "anonymous";
    const concurrency = config.concurrency ?? 5;
    const capacity = config.capacity ?? 50_000;
    const maxRetries = config.retries ?? Infinity;

    // ─── Allocate internal state ───
    // Three bounded queues: one per priority level. Backpressure at `capacity`.
    const highQueue = yield* Queue.bounded<InternalItem<T>>(capacity);
    const normalQueue = yield* Queue.bounded<InternalItem<T>>(capacity);
    const lowQueue = yield* Queue.bounded<InternalItem<T>>(capacity);

    // Latch: open = workers run, closed = workers block before next item.
    // Starts closed when `paused: true` so items can accumulate before processing.
    const latch = yield* Latch.make(!(config.paused ?? false));

    // Concurrency gate: workers acquire a permit before processing.
    const semaphore = yield* Semaphore.make(concurrency);

    // Counters and state flags
    const completedCount = yield* Ref.make(0);
    const isShutdownRef = yield* Ref.make(false);

    // Dedup: set of keys currently in-flight (enqueued or processing).
    // A key is added on enqueue and removed after processing completes.
    const activeKeys = yield* Ref.make(HashSet.empty<string>());

    // Wake signal: completed when items arrive, workers blocked on empty queue
    // await this. Recreated after each signal (single-use Deferred pattern).
    let wakeSignal = yield* Deferred.make<void>();

    // Managed fiber collections. Scope close interrupts all fibers automatically.
    const workerFibers = yield* FiberSet.make<void>();
    const handlerFibers = yield* FiberSet.make<void>();

    yield* Effect.logDebug(`Queue "${queueName}" initializing: concurrency=${String(concurrency)}, capacity=${String(capacity)}`);

    // ─── Internal: optional ProcessStore analytics ───
    // If ProcessStore is available in context, emit events. If not, silent no-op.
    // This makes analytics automatic when ProcessStore is provided, but never required.

    const storeOption = yield* Effect.serviceOption(ProcessStore);
    let eventSeq = 0;


    const recordItemEvent = (
      status: QueueItemStatus,
      priority: Priority,
      durationMs: number,
      attempts: number,
      error?: string,
    ): Effect.Effect<void> => {
      if (Option.isNone(storeOption)) return Effect.void;
      return Effect.gen(function* () {
        const now = yield* Effect.clockWith((c) => c.currentTimeMillis);
        eventSeq++;
        const event: QueueItemCompletedEvent = {
          id: `${queueName}-item-${String(eventSeq)}`,
          type: "queue.item.completed",
          occurredAt: now,
          entityType: "queue",
          entityId: queueName,
          item: { status, priority, durationMs, attempts, error },
        };
        yield* storeOption.value.append(event);
      }).pipe(Effect.ignore);
    };

    const recordLifecycleEvent = (
      tag: QueueLifecycleTag,
      itemsCleared?: number,
    ): Effect.Effect<void> => {
      if (Option.isNone(storeOption)) return Effect.void;
      return Effect.gen(function* () {
        const now = yield* Effect.clockWith((c) => c.currentTimeMillis);
        eventSeq++;
        const event: QueueLifecycleChangedEvent = {
          id: `${queueName}-lifecycle-${String(eventSeq)}`,
          type: "queue.lifecycle.changed",
          occurredAt: now,
          entityType: "queue",
          entityId: queueName,
          lifecycle: { tag, itemsCleared },
        };
        yield* storeOption.value.append(event);
      }).pipe(Effect.ignore);
    };

    // ─── Internal: wake signal ───

    /** Complete the current wake signal and allocate a fresh one. */
    const signalWake = Effect.gen(function* () {
      yield* Deferred.succeed(wakeSignal, undefined);
      wakeSignal = yield* Deferred.make<void>();
    });

    /** Select the internal queue for a given priority level. */
    const queueForPriority = (priority: Priority) =>
      priority === "high"
        ? highQueue
        : priority === "low"
          ? lowQueue
          : normalQueue;

    // ─── Internal: enqueue logic ───

    /**
     * Core enqueue path. Handles:
     * 1. Shutdown check (warn + drop)
     * 2. Dedup key check (skip duplicates)
     * 3. Offer to the target priority queue
     * 4. Wake sleeping workers
     * 5. Fire hooks (onEnqueue, persist)
     */
    const enqueueInternal = (
      items: ReadonlyArray<T>,
      priority: Priority,
      retries = 0,
      enqueuedAt?: number,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const shutdown = yield* Ref.get(isShutdownRef);
        if (shutdown) {
          yield* Effect.logWarning(
            `Enqueue after shutdown in queue "${queueName}", item(s) dropped`,
          );
          return;
        }

        const toEnqueue: Array<InternalItem<T>> = [];

        for (const item of items) {
          // Dedup: skip items whose key is already in-flight
          if (config.key !== undefined) {
            const k = config.key(item);
            const keys = yield* Ref.get(activeKeys);
            if (HashSet.has(keys, k)) continue;
            yield* Ref.update(activeKeys, HashSet.add(k));
          }
          toEnqueue.push({
            item,
            retries,
            priority,
            enqueuedAt: enqueuedAt ?? (yield* Effect.clockWith((c) => c.currentTimeMillis)),
            key: config.key !== undefined ? config.key(item) : undefined,
          });
        }

        if (toEnqueue.length === 0) return;

        yield* Queue.offerAll(queueForPriority(priority), toEnqueue);
        yield* signalWake;

        // Fire-and-forget hooks
        if (config.onEnqueue !== undefined) {
          yield* config
            .onEnqueue(toEnqueue.map((i) => i.item), priority)
            .pipe(Effect.ignore);
        }
        if (config.persist !== undefined) {
          yield* config
            .persist(toEnqueue.map((i) => i.item), priority)
            .pipe(Effect.ignore);
        }
      });

    /** Public enqueue: convert Iterable to array, delegate to internal. */
    const enqueuePublic = (
      items: T | ReadonlyArray<T>,
      priority: Priority,
    ): Effect.Effect<void> => enqueueInternal(normalizeEnqueueInput(items), priority);

    // ─── Internal: EffectContext (guarded) ───

    /**
     * Build the guarded context passed to the user's `effect` callback.
     * Self-enqueue detection uses reference equality and (if configured) key equality.
     */
    const makeEffectContext = (
      internal: InternalItem<T>,
    ): EffectContext<T> => {
      const isSameItem = (candidate: T): boolean => {
        if (candidate === internal.item) return true;
        if (config.key !== undefined && internal.key !== undefined && config.key(candidate) === internal.key)
          return true;
        return false;
      };

      const guardedEnqueue = (
        candidates: T | ReadonlyArray<T>,
        priority: Priority,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const items = normalizeEnqueueInput(candidates);
          const safe = items.filter((c) => !isSameItem(c));
          if (safe.length < items.length) {
            yield* Effect.logWarning(
              `Self-enqueue detected in queue "${queueName}", item(s) dropped`,
            );
          }
          if (safe.length > 0) {
            yield* enqueueInternal(safe, priority);
          }
        });

      return {
        add: (items) => guardedEnqueue(items, "normal"),
        prioritize: (items) => guardedEnqueue(items, "high"),
        defer: (items) => guardedEnqueue(items, "low"),
        attempts: internal.retries + 1,
        enqueuedAt: internal.enqueuedAt,
        priority: internal.priority,
      };
    };

    // ─── Internal: HandlerContext ───

    /**
     * Build the context passed to the user's `handler` callback.
     * Includes `retry` which re-enqueues the item with an incremented retry counter.
     */
    const makeHandlerContext = (
      internal: InternalItem<T>,
      exit: Exit.Exit<R, E>,
    ): HandlerContext<T> => ({
      retry: Effect.gen(function* () {
        if (internal.retries >= maxRetries) {
          if (config.onRetryExhausted !== undefined) {
            const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
            yield* config.onRetryExhausted(internal.item, cause).pipe(
              Effect.ignore,
            );
          }
          yield* recordItemEvent("exhausted", internal.priority, 0, internal.retries + 1);
          yield* Effect.logDebug(
            `Retry exhausted for item in queue "${queueName}" after ${String(internal.retries + 1)} attempts`,
          );
          return;
        }
        yield* recordItemEvent("retried", internal.priority, 0, internal.retries + 1);
        yield* enqueueInternal(
          [internal.item],
          internal.priority,
          internal.retries + 1,
          internal.enqueuedAt,
        );
      }),
      add: (items) => enqueuePublic(items, "normal"),
      prioritize: (items) => enqueuePublic(items, "high"),
      defer: (items) => enqueuePublic(items, "low"),
      attempts: internal.retries + 1,
      enqueuedAt: internal.enqueuedAt,
      priority: internal.priority,
    });

    // ─── Internal: priority dispatch ───

    /**
     * Take the next item in strict priority order (high → normal → low).
     * If all queues are empty, blocks on the wake signal then re-polls.
     * This avoids the priority inversion that `Effect.race(take, take, take)` would cause.
     */
    const takeNext: Effect.Effect<InternalItem<T>> = Effect.gen(function* () {
      const high = yield* Queue.poll(highQueue);
      if (Option.isSome(high)) return high.value;

      const normal = yield* Queue.poll(normalQueue);
      if (Option.isSome(normal)) return normal.value;

      const low = yield* Queue.poll(lowQueue);
      if (Option.isSome(low)) return low.value;

      // All empty — wait for wake signal then re-poll in priority order
      yield* Deferred.await(wakeSignal);
      return yield* takeNext;
    });

    // ─── Internal: item processing ───

    /**
     * Process a single item within the semaphore gate.
     * 1. Run user's `effect` and capture Exit
     * 2. Increment completed counter
     * 3. Release dedup key
     * 4. Fire onComplete hook (forked)
     * 5. Run handler or log unhandled failure (forked)
     */
    const processItem = (internal: InternalItem<T>): Effect.Effect<void> =>
      semaphore.withPermits(1)(
        Effect.gen(function* () {
          const start = yield* Effect.clockWith((c) => c.currentTimeMillis);
          const ctx = makeEffectContext(internal);
          const exit = yield* Effect.exit(config.effect(internal.item, ctx));
          const end = yield* Effect.clockWith((c) => c.currentTimeMillis);
          const elapsed = Duration.millis(end - start);

          yield* Ref.update(completedCount, (n) => n + 1);

          // Record to ProcessStore (if available)
          yield* recordItemEvent(
            Exit.isSuccess(exit) ? "completed" : "failed",
            internal.priority,
            Duration.toMillis(elapsed),
            internal.retries + 1,
            Exit.isFailure(exit) ? Cause.pretty(exit.cause) : undefined,
          );

          // Release dedup key so future items with same key can enter
          if (config.key !== undefined && internal.key !== undefined) {
            yield* Ref.update(activeKeys, HashSet.remove(internal.key));
          }

          // Fire onComplete hook in a managed fiber (non-blocking)
          if (config.onComplete !== undefined) {
            yield* FiberSet.run(handlerFibers)(
              config.onComplete(internal.item, exit, elapsed).pipe(Effect.ignore),
            );
          }

          // Route to handler or log unhandled failure
          if (config.handler !== undefined) {
            const handlerCtx = makeHandlerContext(internal, exit);
            yield* FiberSet.run(handlerFibers)(
              config.handler(internal.item, exit, handlerCtx).pipe(Effect.ignore),
            );
          } else if (Exit.isFailure(exit)) {
            yield* Effect.logWarning(
              `Item failed in queue "${queueName}", no handler configured`,
            ).pipe(Effect.annotateLogs("cause", Cause.pretty(exit.cause)));
          }
        }),
      );

    // ─── Internal: worker loop ───

    /**
     * Each worker loops forever:
     * 1. Check shutdown → interrupt if true
     * 2. Await latch (blocks when paused)
     * 3. Take next item (blocks when all queues empty)
     * 4. Await latch again (in case pause happened during take)
     * 5. Process item (within semaphore gate)
     *
     * The double latch-await ensures that items taken during a race with
     * `pause` are held until resume, preserving priority ordering.
     */
    const workerLoop = (workerId: number): Effect.Effect<void> =>
      Effect.annotateLogs(
        Effect.forever(
          Effect.gen(function* () {
            const shutdown = yield* Ref.get(isShutdownRef);
            if (shutdown) return yield* Effect.interrupt;

            yield* latch.await;
            const internal = yield* takeNext;
            yield* latch.await;
            yield* processItem(internal);
          }),
        ),
        { "queue.name": queueName, "queue.worker": String(workerId) },
      );

    // ─── Start worker pool ───

    for (let i = 0; i < concurrency; i++) {
      yield* FiberSet.run(workerFibers)(workerLoop(i));
    }

    yield* recordLifecycleEvent("Started");
    yield* Effect.logDebug(`Queue "${queueName}" started with ${String(concurrency)} workers`);

    // ─── Build public handle ───

    const queueHandle: QueueHandle<T, R, E> = {
      // Enqueue delegates — priority is the only difference
      add: (items) => enqueuePublic(items, "normal"),
      prioritize: (items) => enqueuePublic(items, "high"),
      defer: (items) => enqueuePublic(items, "low"),

      // Read all three queue sizes in parallel, combine into total
      size: Effect.map(
        Effect.all([Queue.size(highQueue), Queue.size(normalQueue), Queue.size(lowQueue)]),
        ([h, n, l]) => Math.max(0, h) + Math.max(0, n) + Math.max(0, l),
      ),

      // Read all three queue sizes in parallel, return per-level breakdown
      sizes: Effect.map(
        Effect.all([Queue.size(highQueue), Queue.size(normalQueue), Queue.size(lowQueue)]),
        ([h, n, l]) => ({
          high: Math.max(0, h),
          normal: Math.max(0, n),
          low: Math.max(0, l),
        }),
      ),

      // True when all three priority queues report zero or negative size
      isEmpty: Effect.map(
        Effect.all([Queue.size(highQueue), Queue.size(normalQueue), Queue.size(lowQueue)]),
        ([h, n, l]) => h <= 0 && n <= 0 && l <= 0,
      ),

      // Counter incremented after each item completes processing
      completed: Ref.get(completedCount),

      // Close latch → workers block on next iteration before taking items
      pause: latch.close.pipe(
        Effect.andThen(recordLifecycleEvent("Paused")),
        Effect.asVoid,
      ),

      // Open latch → blocked workers proceed to take + process
      resume: latch.open.pipe(
        Effect.andThen(recordLifecycleEvent("Resumed")),
        Effect.asVoid,
      ),

      // Mark shutdown → wake sleeping workers (so they see the flag) → record
      shutdown: Ref.set(isShutdownRef, true).pipe(
        Effect.andThen(signalWake),
        Effect.andThen(recordLifecycleEvent("Shutdown")),
        Effect.andThen(Effect.logInfo(`Queue "${queueName}" shutting down`)),
      ),

      clear: Effect.gen(function* () {
        let count = 0;
        const drain = (q: Queue.Queue<InternalItem<T>>): Effect.Effect<void> =>
          Effect.gen(function* () {
            const internal = yield* Queue.poll(q);
            if (Option.isSome(internal)) {
              count++;
              if (config.key !== undefined && internal.value.key !== undefined) {
                yield* Ref.update(activeKeys, HashSet.remove(internal.value.key));
              }
              yield* drain(q);
            }
          });
        yield* drain(highQueue);
        yield* drain(normalQueue);
        yield* drain(lowQueue);
        yield* Ref.set(completedCount, 0);
        yield* recordLifecycleEvent("Cleared", count);
        yield* Effect.logDebug(`Queue "${queueName}" cleared ${String(count)} items`);
        return count;
      }),
    };

    // ─── Refill: monitor for empty state ───

    if (config.refill !== undefined) {
      const refillFn = config.refill;
      yield* FiberSet.run(workerFibers)(
        Effect.forever(
          Effect.gen(function* () {
            const empty = yield* queueHandle.isEmpty;
            if (empty) {
              const shutdown = yield* Ref.get(isShutdownRef);
              if (shutdown) return yield* Effect.interrupt;
              yield* Effect.logDebug(`Queue "${queueName}" empty, triggering refill`);
              yield* refillFn(queueHandle).pipe(Effect.ignore);
              if (config.onEmpty !== undefined) {
                yield* config.onEmpty.pipe(Effect.ignore);
              }
            }
            yield* Deferred.await(wakeSignal);
          }),
        ),
      );
    }

    return queueHandle;
  });

// ============================================================================
// Public API
// ============================================================================

/**
 * QueueResource namespace — managed priority queue with workers.
 *
 * @public
 */
export const QueueResource = {
  /**
   * Create a scoped Effect that produces a {@link QueueHandle}.
   *
   * The returned Effect requires `Scope` (workers are scoped fibers).
   * Use `Layer.effect(tag)(QueueResource.make(config))` or the convenience
   * helpers `.layer` / `.Service` for standard wiring.
   *
   * @example
   * ```ts
   * const queue = yield* QueueResource.make({
   *   effect: (item) => processItem(item),
   *   concurrency: 10,
   * })
   * ```
   */
  make: makeQueueEffect,

  /**
   * Build a `Layer` from a Context tag and config.
   *
   * Equivalent to `Layer.effect(tag)(QueueResource.make(config))`.
   *
   * @example
   * ```ts
   * const MyQueueLive = QueueResource.layer(MyQueue, {
   *   effect: (item) => processItem(item),
   *   concurrency: 5,
   * })
   * ```
   */
  layer: <Self, T, R, E>(
    tag: Context.Key<Self, QueueHandle<T, R, E>>,
    config: QueueResourceConfig<T, R, E>,
  ) => Layer.effect(tag)(makeQueueEffect(config)),

  /**
   * Class factory: creates a Context tag with a baked-in `.layer`.
   *
   * The returned value is both a `Context.Service` (yieldable tag) and has
   * a `.layer` property for providing the queue to your program.
   *
   * @example
   * ```ts
   * const EmailQueue = QueueResource.Service<typeof EmailQueue, Email, void, SmtpError>()(
   *   "@app/EmailQueue",
   *   { effect: (email) => sendEmail(email), concurrency: 5 },
   * )
   *
   * // Use:
   * const queue = yield* EmailQueue
   * Effect.provide(EmailQueue.layer)
   * ```
   */
  Service: <Self, T, R, E = never>() =>
  <const Name extends string>(
    name: Name,
    config: QueueResourceConfig<T, R, E>,
  ) => {
    const base = Context.Service<Self, QueueHandle<T, R, E>>()(name);
    const layer = Layer.effect(base)(makeQueueEffect({ ...config, name }));
    return Object.assign(base, { layer });
  },

  /**
   * Class factory: creates a pure identity Context tag (no default layer).
   *
   * Use with {@link QueueResource.layer} to provide implementations.
   * Useful for shared contracts, library interfaces, and dependency inversion.
   *
   * @example
   * ```ts
   * class JobQueue extends QueueResource.Tag<JobQueue, Job, void, JobError>()("@app/JobQueue") {}
   *
   * // Provide implementation separately:
   * const JobQueueLive = QueueResource.layer(JobQueue, { ... })
   * ```
   */
  Tag: <Self, T, R, E = never>() =>
  <const Name extends string>(name: Name) =>
    Context.Service<Self, QueueHandle<T, R, E>>()(name),
};
