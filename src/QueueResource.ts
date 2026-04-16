/**
 * QueueResource - Managed Effect Execution System
 * 
 * A managed execution system for resource-intensive Effect operations with
 * priority-based scheduling, concurrency control, rate limiting, and lifecycle management.
 * 
 * @remarks
 * Key features:
 * - Three priority levels (high, normal, low)
 * - Configurable concurrency limits
 * - Rate limiting/throttling
 * - Queue capacity management
 * - Automatic rebuilding from cache
 * - Optional follow-up via `forkWith` (required when the item effect’s error type `E` is not `never`)
 * - `forkWith` runs in a fork; in-flight forks are awaited when the queue scope ends
 * - Pause/resume/restart capabilities
 * 
 * @module QueueResource
 */

import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Ref,
  Semaphore,
} from "effect";

/** Re-export for use next to `forkWith` handlers (failure inspection, `Cause.pretty`, etc.). */
export { Cause };

// ============================================================================
// Internal Utilities
// ============================================================================

/**
 * Creates a global throttler that enforces minimum time gaps between effect starts
 * 
 * @internal
 * @remarks
 * This throttler ensures that wrapped effects don't start more frequently than
 * the specified minimum interval. Unlike rate limiting which tracks completions,
 * this throttles the _start_ of effects.
 * 
 * **Behavior:**
 * - Tracks when the last effect started
 * - If insufficient time has passed, waits before starting the next effect
 * - Updates the timestamp _before_ starting the effect (not after completion)
 * 
 * @param minInterval - Minimum time gap between effect starts
 * @returns An effect that produces a throttling function
 */
/** Drain a queue without blocking when empty (unlike `Queue.takeAll`, which waits for ≥1 item). */
const drainQueue = <A>(q: Queue.Queue<A>) =>
  Effect.gen(function* () {
    const out: A[] = [];
    while (true) {
      const x = yield* Queue.poll(q);
      if (x._tag === "None") break;
      out.push(x.value);
    }
    return out;
  });

const makeGlobalThrottler = (minInterval: Duration.Duration) =>
  Effect.gen(function* () {
    const lastStartTime = yield* Ref.make<number>(0);
    
    return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.gen(function* () {
        // Enforce minimum interval globally
        const now = Date.now();
        const lastStart = yield* Ref.get(lastStartTime);
        const timeSinceLastStart = now - lastStart;
        const minIntervalMs = Duration.toMillis(minInterval);
        
        if (timeSinceLastStart < minIntervalMs) {
          const waitTime = minIntervalMs - timeSinceLastStart;
          yield* Effect.sleep(Duration.millis(waitTime));
        }
        
        // Update last start time before starting the effect
        yield* Ref.set(lastStartTime, Date.now());
        
        // Execute the wrapped effect
        return yield* effect;
      });
  });

// ============================================================================
// Public Types
// ============================================================================

/**
 * Service environment required by a queue's per-item processor (the return type
 * of {@link QueueResourceConfigBase.effect}).
 *
 * @public
 */
export type QueueItemEffectRequirements<F> = F extends (
  item: infer _Item,
) => Effect.Effect<any, any, infer R>
  ? R
  : never;

/**
 * QueueResource status details for monitoring
 * 
 * @public
 */
export interface QueueResourceDetails {
  /** Current number of items in queue */
  size: number;
  /** Total number of items that finished processing (success or failure) */
  completed: number;
  /** Number of active worker fibers */
  workers: number;
  /** Whether the queue is currently processing items */
  running: boolean;
  /** Additional metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * QueueResource Interface
 * 
 * @remarks
 * The main interface for interacting with a QueueResource. Provides methods
 * to add items at different priority levels, monitor queue status, and control
 * queue lifecycle.
 * 
 * @typeParam T - Type of items to process
 * @typeParam R - Success type produced by the item effect
 * @typeParam E - Error type of the item effect
 *
 * @public
 */
export interface QueueResourceInstance<T, _R, _E = never> {
  /**
   * Add item(s) at high priority
   * 
   * @param item - Single item or array of items
   * @remarks
   * High priority items are processed before normal and low priority items.
   * Use for urgent tasks that need immediate attention.
   */
  readonly next: (item: T | readonly T[]) => Effect.Effect<void>;
  
  /**
   * Add item(s) at normal priority (default)
   * 
   * @param item - Single item or array of items
   * @remarks
   * Normal priority is the default for most items. Processed after high
   * priority but before low priority items.
   */
  readonly add: (item: T | readonly T[]) => Effect.Effect<void>;
  
  /**
   * Add item(s) at low priority
   * 
   * @param item - Single item or array of items
   * @remarks
   * Low priority items are processed last. Use for background tasks or
   * non-urgent operations that can wait.
   */
  readonly deffered: (
    item: T | readonly T[]
  ) => Effect.Effect<void>;

  /**
   * Get current queue size (all priority levels combined)
   * 
   * @returns Total number of pending items
   */
  readonly size: () => Effect.Effect<number>;
  
  /**
   * Get size by priority level
   * 
   * @returns Object with counts for each priority level
   */
  readonly sizeByPriority: () => Effect.Effect<{
    high: number;
    normal: number;
    low: number;
  }>;
  
  /**
   * Check if queue is empty
   * 
   * @returns True if no items are pending at any priority level
   */
  readonly isEmpty: () => Effect.Effect<boolean>;

  // ========== Status and Control Methods ==========
  
  /**
   * Get total number of items that finished processing (success or failure)
   *
   * @returns Count since queue start; reset when the queue is {@link restart | restarted}
   */
  readonly getCompleted: () => Effect.Effect<number>;
  
  /**
   * Pause queue processing
   * 
   * @remarks
   * Workers will stop processing new items but current items will complete.
   * Use {@link resume} to continue processing.
   */
  readonly pause: () => Effect.Effect<void>;
  
  /**
   * Resume queue processing after pause
   * 
   * @remarks
   * Workers will continue processing pending items.
   */
  readonly resume: () => Effect.Effect<void>;
  
  /**
   * Shutdown queue permanently
   * 
   * @remarks
   * Stops all workers and prevents further processing. Cannot be resumed.
   * The queue scope will be closed.
   */
  readonly shutdown: () => Effect.Effect<void>;
  
  /**
   * Restart queue processing
   * 
   * @remarks
   * Stops and then restarts all workers. Useful for recovering from errors
   * or refreshing queue state.
   */
  readonly restart: () => Effect.Effect<void>;

  /**
   * Worker fiber references
   *
   * @internal
   * @remarks
   * Internal field that keeps worker fibers alive to prevent garbage collection.
   * Do not access directly.
   */
  readonly _workers: readonly Fiber.Fiber<void>[];
}

/**
 * Shared fields for {@link QueueResourceConfig} (excluding `forkWith`).
 *
 * @typeParam T - Type of items to process
 * @typeParam R - Success type produced by the item effect
 * @typeParam E - Error type of the item effect
 * @typeParam RItem - Service environment required by each item's {@link QueueResourceConfigBase.effect | effect}
 *
 * @public
 */
export interface QueueResourceConfigBase<T, R, E = never, RItem = never> {
  /** Unique name for the resource queue (must be a string literal) */
  readonly name: string;
  // ========== Processing ==========

  /**
   * Effect to execute for each item
   *
   * @param item - Item to process
   * @returns Effect with success type `R`, failure type `E`, and service
   * environment `RItem` (defaults to `never` when omitted).
   * @remarks
   * **Worker behavior:** The queue runs this effect with `Effect.exit`. Failures
   * and defects do not crash the worker; the outcome is turned into a value-level
   * `Effect<R, E>` (`Effect.succeed` / `Effect.failCause`) and passed to
   * {@link QueueResourceConfig}'s `forkWith` when configured.
   *
   * **What counts as `E`:** Only the effect’s **failure channel** (the second type
   * argument of `Effect.Effect<R, E>`). That is how TypeScript models errors —
   * not whether you use `Effect.fail` specifically.
   */
  readonly effect: (item: T) => Effect.Effect<R, E, RItem>;

  // ========== Queue configuration ==========

  /**
   * Maximum number of items the queue can hold
   *
   * @defaultValue 50000
   * @remarks
   * When the queue is full, adding new items will block until space is available.
   * This prevents memory issues from unlimited growth.
   */
  capacity?: number;

  // ========== Concurrency Control ==========

  /**
   * Number of items to process concurrently
   *
   * @defaultValue 5
   * @remarks
   * Controls how many worker fibers process items in parallel.
   * Higher values increase throughput but use more resources.
   */
  readonly concurrency?: number;

  // ========== Rate Limiting ==========

  /**
   * Throttle configuration for rate limiting
   *
   * @defaultValue { limit: 1, duration: Duration.seconds(1) }
   * @remarks
   * Controls how frequently items can be processed:
   * - `limit`: Maximum number of items to process
   * - `duration`: Within this time period
   *
   * Example: `{ limit: 10, duration: Duration.minutes(1) }` allows 10 items per minute.
   * Use this to prevent overwhelming external APIs or services.
   */
  readonly throttle?: {
    /** Maximum number of operations allowed per duration */
    readonly limit: number;
    /** Time period for the limit */
    readonly duration: Duration.Duration;
  };

  // ========== Persistence ==========

  /**
   * Function to cache/persist items when added
   *
   * @param item - Item(s) being added
   * @param queue - The QueueResource instance (allows checking queue state)
   * @remarks
   * Called immediately when items are added to the queue (before processing).
   * NOT called for items from {@link refill}.
   * Use for saving items to database for crash recovery.
   */
  cache?: (
    item: T | readonly T[],
    queue: QueueResourceInstance<T, R, E>
  ) => Effect.Effect<void, Error>;

  /**
   * Effect to refill queue from cache/database
   *
   * @param queue - The QueueResource instance (allows adding items and checking queue state)
   * @returns Effect that loads and re-adds items
   * @remarks
   * Called automatically when the queue becomes empty. Use to reload
   * pending items from database after a restart. Items added here do NOT
   * trigger {@link cache}. Use queue.add(), queue.next(), or queue.deffered() to
   * add items at different priority levels.
   */
  refill?: (queue: QueueResourceInstance<T, R, E>) => Effect.Effect<void, Error>;
}

/**
 * Configuration for QueueResource
 *
 * @remarks
 * Use with {@link QueueResource.make}.
 *
 * **`forkWith` and `E`:** If the item {@link QueueResourceConfigBase.effect | effect}
 * can fail (`[E] extends [never]` is false), `forkWith` is **required**. It
 * receives `forked: Effect<R, E>` — the same `R` and `E` as the item effect —
 * and must return **`Effect<void, never, RFork>`**: **success must be `void`** and
 * the **error type must be `never`**, so you eliminate `E` using Effect’s APIs
 * (`catchTag`, `catchAll`, `orElse`, etc.). **`RFork`** is the **requirements**
 * context your handler needs (e.g. logger, DB); it is inferred from the returned
 * effect.
 *
 * **Scope shutdown:** Each `forkWith` run is executed in a **forked fiber**.
 * Those fibers are tracked; when the queue’s `Effect.scoped` scope ends, a
 * finalizer **awaits** any still-running `forkWith` fibers so follow-up work can
 * finish before teardown.
 *
 * @typeParam T - Type of items to process
 * @typeParam R - Success type produced by the item effect
 * @typeParam E - Error type of the item effect
 * @typeParam RFork - Environment required by the effect returned from `forkWith`
 * @typeParam RItem - Environment required by each item {@link QueueResourceConfigBase.effect | effect}
 *
 * @public
 */
export type QueueResourceConfig<T, R, E = never, RFork = never, RItem = never> =
  QueueResourceConfigBase<T, R, E, RItem> &
    ([E] extends [never]
      ? {
          /**
           * Optional follow-up run in a **fork** after each item. The queue wraps the
           * returned effect in `catchAll` so defects in the handler do not kill workers.
           *
           * @param forked - Item outcome as `Effect.succeed` / `Effect.failCause` (same `R`, `E` as `effect`)
           * @param item - Item that was processed
           * @param queue - Queue instance (lifecycle, re-enqueue, etc.)
           * @remarks Return **`Effect<void, never, RFork>`** — handle `forked` until errors are `never`.
           */
          readonly forkWith?: (
            forked: Effect.Effect<R, E>,
            item: T,
            queue: QueueResourceInstance<T, R, E>
          ) => Effect.Effect<void, never, RFork>;
        }
      : {
          /**
           * **Required** when the item effect has a non-`never` error type `E`.
           * Runs in a **fork** after each item; the queue wraps with `catchAll` so
           * handler bugs do not crash workers.
           *
           * @param forked - Item outcome as `Effect.succeed` / `Effect.failCause` (same `R`, `E` as `effect`)
           * @param item - Item that was processed
           * @param queue - Queue instance (lifecycle, re-enqueue, etc.)
           * @remarks Must return **`Effect<void, never, RFork>`**. Narrow tagged errors with
           * `catchTag` and cover the rest with `catchAll` until `E` is gone.
           */
          readonly forkWith: (
            forked: Effect.Effect<R, E>,
            item: T,
            queue: QueueResourceInstance<T, R, E>
          ) => Effect.Effect<void, never, RFork>;
        });

// ============================================================================
// QueueResource Factory
// ============================================================================

/**
 * Create a QueueResource effect (internal implementation)
 * 
 * @internal
 * @remarks
 * Internal function for creating the QueueResource effect. Use {@link QueueResource.make}
 * for the public API.
 * 
 * Creates a scoped QueueResource with:
 * - Three priority levels (high, normal, low)
 * - Concurrent workers
 * - Rate limiting
 * - Automatic cache persistence
 * - Item outcomes via `Effect.exit`, optional `forkWith`, and fork fiber finalizer
 * - Automatic refill on empty
 * 
 * @typeParam T - Type of items to process
 * @typeParam R - Success type produced by the item effect
 * @typeParam E - Error type of the item effect
 * @typeParam RFork - Environment required by `forkWith`'s returned effect
 * @typeParam RItem - Environment required by each item `effect`
 *
 * @param config - Queue configuration (without name)
 * @returns Scoped effect producing a QueueResource
 */
const makeQueueResourceEffect = <T, R, E, RFork = never, RItem = never>(
  config: Omit<QueueResourceConfig<T, R, E, RFork, RItem>, "name">
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const {
        effect: processor,
        capacity: queueCapacity = 50000,
        concurrency: semaphore = 5,
        throttle = { limit: 1, duration: Duration.seconds(1) },
        cache: cacheFunction,
        forkWith,
        refill: refillFunction,
      } = config;

      // Create internal priority queues
      const [high, regular, low] = yield* Effect.all(
        [
          Queue.bounded<T>(queueCapacity),
          Queue.bounded<T>(queueCapacity),
          Queue.bounded<T>(queueCapacity),
        ],
        {
          concurrency: 3,
        }
      );

      // Create semaphore for concurrency control
      const sem = yield* Semaphore.make(semaphore);

      // Create global throttler - calculate min duration from throttle config
      // If limit=10 per minute, min duration = 1 minute / 10 = 6 seconds between worker executions
      // If semaphore=5, min duration = 6 seconds / 5 ≈ 1.2 seconds between items
      const minDuration =
        Duration.toMillis(throttle.duration) / throttle.limit / semaphore;
      const throttler = yield* makeGlobalThrottler(
        Duration.millis(minDuration)
      );

      // Processing state
      const isRunning = yield* Ref.make(true);
      const isPaused = yield* Ref.make(false);
      const workerCount = yield* Ref.make(0);
      const processedCount = yield* Ref.make(0);
      const isRebuilding = yield* Ref.make(false);

      const forkedFibers = yield* Ref.make(
        new Set<Fiber.Fiber<void>>()
      );

      // Store workers in closure variable (will be populated later)
      let workers: readonly Fiber.Fiber<void>[] = [];

      // Create the QueueResource instance (before processItem so it can be passed to forkWith)
      const queue: QueueResourceInstance<T, R, E> = {
        next: (item: T | readonly T[]) =>
          Effect.gen(function* () {
            // Start caching in background (non-blocking)
            if (cacheFunction) {
              yield* Effect.forkChild(
                cacheFunction(item, queue).pipe(
                  Effect.catch(() => Effect.void) // Don't fail on cache errors
                )
              );
            }

            // Add to queue immediately (don't wait for cache)
            if (Array.isArray(item)) {
              yield* Queue.offerAll(high, item);
            } else {
              yield* Queue.offer(high, item as T);
            }
          }),

        add: (item: T | readonly T[]) =>
          Effect.gen(function* () {
            // Start caching in background (non-blocking)
            if (cacheFunction) {
              yield* Effect.forkChild(
                cacheFunction(item, queue).pipe(
                  Effect.catch(() => Effect.void) // Don't fail on cache errors
                )
              );
            }

            // Add to queue immediately (don't wait for cache)
            if (Array.isArray(item)) {
              yield* Queue.offerAll(regular, item);
            } else {
              yield* Queue.offer(regular, item as T);
            }
          }),

        deffered: (item: T | readonly T[]) =>
          Effect.gen(function* () {
            // Start caching in background (non-blocking)
            if (cacheFunction) {
              yield* Effect.forkChild(
                cacheFunction(item, queue).pipe(
                  Effect.catch(() => Effect.void) // Don't fail on cache errors
                )
              );
            }

            // Add to queue immediately (don't wait for cache)
            if (Array.isArray(item)) {
              yield* Queue.offerAll(low, item);
            } else {
              yield* Queue.offer(low, item as T);
            }
          }),

        size: () =>
          Effect.gen(function* () {
            const total =
              (yield* Queue.size(high)) +
              (yield* Queue.size(regular)) +
              (yield* Queue.size(low));
            return total < 0 ? 0 : total;
          }),

        sizeByPriority: () =>
          Effect.gen(function* () {
            const highSize = yield* Queue.size(high);
            const normalSize = yield* Queue.size(regular);
            const lowSize = yield* Queue.size(low);
            return {
              high: highSize < 0 ? 0 : highSize,
              normal: normalSize < 0 ? 0 : normalSize,
              low: lowSize < 0 ? 0 : lowSize,
            };
          }),

        isEmpty: () =>
          Effect.gen(function* () {
            const highSize = yield* Queue.size(high);
            const normalSize = yield* Queue.size(regular);
            const lowSize = yield* Queue.size(low);
            return highSize === 0 && normalSize === 0 && lowSize === 0;
          }),

        // Status and control methods
        getCompleted: () => Ref.get(processedCount),
        pause: () => Ref.set(isPaused, true),
        resume: () => Ref.set(isPaused, false),
        shutdown: () =>
          Effect.gen(function* () {
            yield* Ref.set(isRunning, false);
            yield* Ref.set(isPaused, false);
            // Don't shutdown queue permanently - just stop the workers
            // This allows the queue to be restarted later
            yield* Effect.logDebug(
              "Queue stopped - workers will exit gracefully"
            );
          }),
        restart: () =>
          Effect.gen(function* () {
            // Clear all pending items from all priority levels
            const highItems = yield* drainQueue(high);
            const regularItems = yield* drainQueue(regular);
            const lowItems = yield* drainQueue(low);
            const totalCleared =
              highItems.length + regularItems.length + lowItems.length;

            // Reset processed count
            yield* Ref.set(processedCount, 0);

            yield* Effect.logInfo(
              `Queue restarted - cleared ${totalCleared} pending items, reset count to 0`
            );
          }),

        // Keep workers alive by storing them in the returned object
        // This prevents garbage collection of the worker fibers
        get _workers() {
          return workers;
        },
      };

      /**
       * Run the item effect to completion, bump the processed counter, then fork
       * `forkWith(forked, …)` when set (`catchAll` on the returned effect).
       * `forked` mirrors success/failure without failing the worker.
       */
      const processItem = (item: T) =>
        sem.withPermits(1)(
          throttler(
            Effect.gen(function* () {
              yield* Effect.logDebug(
                `Processing item: ${JSON.stringify(item)}`
              );

              const exit = yield* Effect.exit(processor(item));

              const forked = Exit.isSuccess(exit)
                ? Effect.succeed(exit.value)
                : Effect.failCause(exit.cause);

              yield* Ref.update(processedCount, (n) => n + 1);

              if (forkWith) {
                const fiber = yield* Effect.forkChild(
                  forkWith(forked, item, queue).pipe(
                    Effect.catch(() => Effect.void),
                    Effect.ensuring(
                      Ref.update(forkedFibers, (fibers) => {
                        const next = new Set(fibers);
                        next.delete(fiber);
                        return next;
                      })
                    )
                  )
                );
                yield* Ref.update(forkedFibers, (fibers) =>
                  new Set(fibers).add(fiber)
                );
              }

              yield* Effect.logDebug(`Completed item: ${JSON.stringify(item)}`);
            })
          )
        );

      // Event-driven worker that blocks until items available
      const createWorker = () =>
        Effect.gen(function* () {
          const currentWorkers = yield* Ref.get(workerCount);
          yield* Ref.set(workerCount, currentWorkers + 1);

          yield* Effect.logDebug(
            `Worker started (total: ${currentWorkers + 1})`
          );

          yield* Effect.forever(
            Effect.gen(function* () {
              const running = yield* Ref.get(isRunning);
              const paused = yield* Ref.get(isPaused);

              if (!running) {
                yield* Effect.logDebug("Worker stopped - isRunning is false");
                return;
              }

              if (paused) {
                yield* Effect.logDebug("Worker paused - waiting for resume");
                yield* Effect.sleep(Duration.millis(500)); // Wait a bit before checking again
                return;
              }

              yield* Effect.logDebug("Worker waiting for item...");
              // Try to get next item - this blocks until an item is available
              const nextItem = yield* getNextItemBlocking();
              yield* Effect.logDebug(`Worker got item`);
              yield* processItem(nextItem);
            })
          );
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              const currentWorkers = yield* Ref.get(workerCount);
              yield* Ref.set(workerCount, currentWorkers - 1);
              yield* Effect.logDebug(
                `Worker stopped (total: ${currentWorkers - 1})`
              );
            })
          )
        );

      // Get next item with blocking behavior - maintains priority order
      const getNextItemBlocking = (): Effect.Effect<T> =>
        Effect.gen(function* () {
          // First try polling each priority level
          const highItem = yield* Queue.poll(high);
          if (highItem._tag === "Some") {
            yield* Effect.logDebug("📦 Got high priority item");
            return highItem.value;
          }

          const regularItem = yield* Queue.poll(regular);
          if (regularItem._tag === "Some") {
            yield* Effect.logDebug("📦 Got regular priority item");
            return regularItem.value;
          }

          const lowItem = yield* Queue.poll(low);
          if (lowItem._tag === "Some") {
            yield* Effect.logDebug("📦 Got low priority item");
            return lowItem.value;
          }

          // All priority levels empty, try to rebuild or wait
          return yield* handleEmptyQueue();
        });

      // Rebuild from database and then wait for next item
      const handleEmptyQueue = (): Effect.Effect<T> =>
        Effect.gen(function* () {
          yield* Effect.logDebug("Queue is empty, waiting for more items");

          const rebuilding = yield* Ref.get(isRebuilding);

          if (refillFunction && !rebuilding) {
            // Start refill
            yield* Ref.set(isRebuilding, true);
            yield* Effect.logInfo("🔄 Refilling queue from database...");

            yield* refillFunction(queue).pipe(
              Effect.catch(() => Effect.void) // Don't fail on refill errors
            );

            yield* Ref.set(isRebuilding, false);
            yield* Effect.logInfo("✅ Refill completed");

            // After refill, try to get an item using priority order
            // const highItem = yield* Queue.poll(high);
            // if (highItem._tag === "Some") {
            //   return highItem.value;
            // }

            // const regularItem = yield* Queue.poll(regular);
            // if (regularItem._tag === "Some") {
            //   return regularItem.value;
            // }

            // const lowItem = yield* Queue.poll(low);
            // if (lowItem._tag === "Some") {
            //   return lowItem.value;
            // }
          }

          const result = yield* Effect.race(
            Effect.race(
              Effect.gen(function* () {
                const item = yield* Queue.take(high);
                return { queue: "high", item };
              }),
              Effect.gen(function* () {
                const item = yield* Queue.take(regular);
                return { queue: "regular", item };
              })
            ),
            Effect.gen(function* () {
              const item = yield* Queue.take(low);
              return { queue: "low", item };
            })
          );
          return result.item;
        });

      // Start workers dynamically based on semaphore
      const startWorkers = () =>
        Effect.gen(function* () {
          const workers = [];
          for (let i = 0; i < semaphore; i++) {
            const worker = yield* Effect.forkChild(createWorker());
            workers.push(worker);
          }
          return workers;
        });

      // Start workers and assign to closure variable
      workers = yield* startWorkers();

      /** Wait for in-flight `forkWith` fibers before the scoped queue is torn down. */
      yield* Effect.addFinalizer((_exit) =>
        Effect.gen(function* () {
          const fibers = yield* Ref.get(forkedFibers);
          if (fibers.size > 0) {
            yield* Effect.logInfo(
              `Waiting for ${fibers.size} forked fibers to complete...`
            );
            yield* Fiber.joinAll(Array.from(fibers));
          }
        })
      );

      // Return the QueueResource instance
      return queue;
    })
  );

/**
 * QueueResource - Managed Effect Execution with Priority Scheduling
 * 
 * @remarks
 * A managed execution system for resource-intensive Effect operations.
 * Provides priority-based scheduling, concurrency control, rate limiting,
 * and comprehensive lifecycle management.
 * 
 * **Features:**
 * - Three priority levels (high, normal, low)
 * - Configurable concurrency and rate limiting  
 * - Automatic persistence and recovery
 * - Optional follow-up via `forkWith` (required when the item effect’s error type `E` is not `never`)
 * - `forkWith` runs in a fork; in-flight forks are awaited when the queue scope ends
 * - Pause/resume/restart capabilities
 * 
 * **Item failures and `forkWith`:**
 * TypeScript uses the item effect’s **`E`** (failure channel) to decide whether
 * `forkWith` is required. Handlers return **`Effect<void, never, RFork>`** — void
 * success and **`E` cleared** in the type system (see {@link QueueResourceConfig}).
 *
 * **Usage:**
 * 1. Call `QueueResource.make()` to create a queue service
 * 2. Yield the service tag in your Effects to access the queue
 * 3. Provide the `.layer` when running your program (include any `RFork`
 *    requirements from `forkWith` in your program’s layers)
 * 
 * @example
 * ```typescript
 * import { QueueResource, ProcessManager } from "@nikscripts/effect-pm";
 * import { Effect, Duration } from "effect";
 * 
 * // Create a resource queue
 * const EmailQueue = QueueResource.make({
 *   name: "email-queue",
 *   effect: (email: Email) => sendEmail(email),
 *   concurrency: 5,
 *   capacity: 1000,
 * });
 * 
 * // Use in your program
 * const program = Effect.gen(function* () {
 *   const queue = yield* EmailQueue;
 *   yield* queue.add([email1, email2, email3]);
 * });
 * 
 * // Provide the layer
 * program.pipe(
 *   Effect.provide(EmailQueue.layer),
 *   Effect.runPromise
 * );
 * ```
 * 
 * @example
 * ```typescript
 * import { Effect, Duration } from "effect";
 *
 * // Success path only (use Effect.tap so logging stays in the same effect)
 * const SuccessQueue = QueueResource.make({
 *   name: "success-queue",
 *   effect: (task: Task) => processTask(task),
 *   forkWith: (forked, _item, _queue) =>
 *     forked.pipe(
 *       Effect.tap((result) => Effect.logInfo(String(result))),
 *       Effect.catch(() => Effect.void)
 *     ),
 * });
 *
 * // Error handling only (example: tagged errors)
 * const ErrorQueue = QueueResource.make({
 *   name: "error-queue",
 *   effect: (task: Task) => processTask(task),
 *   forkWith: (forked, item, _queue) =>
 *     forked.pipe(
 *       Effect.catchTag("DatabaseError", (_error) => saveToDeadLetterQueue(item)),
 *       Effect.catch((_error) => Effect.logError("task failed"))
 *     ),
 * });
 *
 * // Both success and failure handling
 * const FullQueue = QueueResource.make({
 *   name: "full-queue",
 *   effect: (task: Task) => processTask(task),
 *   forkWith: (forked, item, _queue) =>
 *     Effect.gen(function* () {
 *       const result = yield* forked.pipe(
 *         Effect.catchTag("DatabaseError", (_error) => saveToDeadLetterQueue(item)),
 *         Effect.catch((_error) => Effect.logError("task failed")),
 *         Effect.orDie
 *       );
 *       yield* notifyWebhook(result);
 *     }),
 *   cache: (tasks, queue) => saveToDatabase(tasks),
 *   throttle: { limit: 100, duration: Duration.minutes(1) },
 *   refill: (queue) =>
 *     Effect.gen(function* () {
 *       const pending = yield* loadPendingTasks();
 *       yield* queue.add(pending);
 *     }),
 * });
 * ```
 * 
 * @public
 */
export const QueueResource = {
  /**
   * Create a QueueResource service
   *
   * @typeParam T - Type of items to process
   * @typeParam R - Success type produced by the item effect
   * @typeParam E - Error type of the item effect
   * @typeParam RFork - Requirements of the effect returned from `forkWith` (inferred)
   * @typeParam RItem - Requirements of each item `effect` (inferred from the handler)
   *
   * @param config - QueueResource configuration; see {@link QueueResourceConfig}
   * @returns Service tag with `.layer`. The layer’s requirement type includes
   * whatever `RFork` your `forkWith` needs, `RItem` for the item processor, and
   * internal queue dependencies.
   */
  make: <T, R, E, RFork = never, RItem = never>(
    config: QueueResourceConfig<T, R, E, RFork, RItem>
  ) => {
    const service = Context.Service<
      QueueResourceInstance<T, R, E> & { _brand: typeof config.name },
      QueueResourceInstance<T, R, E>
    >(config.name);
    
    const layer = Layer.effect(
      service,
      makeQueueResourceEffect<T, R, E, RFork, RItem>(config)
    );
    
    return Object.assign(service, { layer });
  },
}