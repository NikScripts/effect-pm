/**
 * Priority Queue System
 *
 * A fully-featured priority queue implementation with concurrency control,
 * rate limiting, and comprehensive lifecycle management.
 *
 * @remarks
 * Key features:
 * - Three priority levels (high, normal, low)
 * - Configurable concurrency limits
 * - Rate limiting/throttling
 * - Queue capacity management
 * - Automatic rebuilding from cache
 * - Non-blocking success callbacks
 * - Pause/resume/restart capabilities
 *
 * @module priority-queue
 */

import { Effect, Queue, Duration, Ref, Fiber, Context, Layer } from "effect";

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
 * Queue status details for monitoring
 *
 * @public
 */
export interface QueueProcessDetails {
  /** Current number of items in all priority queues */
  queueSize: number;
  /** Total number of items processed since queue started */
  processedCount: number;
  /** Number of active worker fibers */
  workerCount: number;
  /** Whether the queue is currently processing items */
  isRunning: boolean;
  /** Additional metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * Priority Queue Processor Interface
 *
 * @remarks
 * The main interface for interacting with a priority queue. Provides methods
 * to add items at different priority levels, monitor queue status, and control
 * queue lifecycle.
 *
 * @typeParam T - Type of items in the queue
 * @typeParam R - Return type of the processor function
 *
 * @public
 */
export interface PriorityQueueProcessor<T, _R> {
  /**
   * Add item(s) to high priority queue
   *
   * @param item - Single item or array of items
   * @remarks
   * High priority items are processed before normal and low priority items.
   * Use for urgent tasks that need immediate attention.
   */
  readonly next: (item: T | readonly T[]) => Effect.Effect<void, never, never>;

  /**
   * Add item(s) to normal priority queue (default)
   *
   * @param item - Single item or array of items
   * @remarks
   * Normal priority is the default for most items. Processed after high
   * priority but before low priority items.
   */
  readonly add: (item: T | readonly T[]) => Effect.Effect<void, never, never>;

  /**
   * Add item(s) to low priority queue
   *
   * @param item - Single item or array of items
   * @remarks
   * Low priority items are processed last. Use for background tasks or
   * non-urgent operations that can wait.
   */
  readonly deffered: (
    item: T | readonly T[]
  ) => Effect.Effect<void, never, never>;

  /**
   * Get current queue size (all priority levels combined)
   *
   * @returns Total number of pending items
   */
  readonly size: () => Effect.Effect<number, never, never>;

  /**
   * Check if queue is empty
   *
   * @returns True if no items are pending in any priority queue
   */
  readonly isEmpty: () => Effect.Effect<boolean, never, never>;

  // ========== Status and Control Methods ==========

  /**
   * Get total number of items processed
   *
   * @returns Count of successfully processed items since queue start
   */
  readonly getProcessedCount: () => Effect.Effect<number, never, never>;

  /**
   * Pause queue processing
   *
   * @remarks
   * Workers will stop processing new items but current items will complete.
   * Use {@link resume} to continue processing.
   */
  readonly pause: () => Effect.Effect<void, never, never>;

  /**
   * Resume queue processing after pause
   *
   * @remarks
   * Workers will continue processing pending items.
   */
  readonly resume: () => Effect.Effect<void, never, never>;

  /**
   * Shutdown queue permanently
   *
   * @remarks
   * Stops all workers and prevents further processing. Cannot be resumed.
   * The queue scope will be closed.
   */
  readonly shutdown: () => Effect.Effect<void, never, never>;

  /**
   * Restart queue processing
   *
   * @remarks
   * Stops and then restarts all workers. Useful for recovering from errors
   * or refreshing queue state.
   */
  readonly restart: () => Effect.Effect<void, never, never>;

  /**
   * Worker fiber references
   *
   * @internal
   * @remarks
   * Internal field that keeps worker fibers alive to prevent garbage collection.
   * Do not access directly.
   */
  readonly _workers: readonly Fiber.RuntimeFiber<void, never>[];
}

/**
 * Configuration for queue processor internals
 *
 * @remarks
 * This is the low-level configuration used by {@link createQueue}.
 * Most users should use {@link makeQueueService} instead.
 *
 * @typeParam T - Type of items to process
 * @typeParam R - Return type of processor function
 *
 * @public
 */
export interface QueueProcessorConfig<T, R> {
  // ========== Processing ==========

  /**
   * Function to process each queue item
   *
   * @param item - Item to process
   * @returns Effect producing the processed result
   * @remarks
   * This function is called for each item in the queue. It should handle
   * the actual work. Errors will be caught and passed to {@link onError}.
   */
  processor: (item: T) => Effect.Effect<R, Error, never>;

  // ========== Queue Configuration ==========

  /**
   * Maximum number of items the queue can hold
   *
   * @defaultValue 50000
   * @remarks
   * When the queue is full, adding new items will block until space is available.
   * This prevents memory issues from unlimited queue growth.
   */
  queueCapacity?: number;

  // ========== Concurrency Control ==========

  /**
   * Number of items to process concurrently
   *
   * @defaultValue 5
   * @remarks
   * Controls how many worker fibers process items in parallel.
   * Higher values increase throughput but use more resources.
   */
  concurrency?: number;

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
  throttle?: {
    /** Maximum number of operations allowed per duration */
    limit: number;
    /** Time period for the limit */
    duration: Duration.Duration;
    /** Type of throttle: not implemented yet */
    // type: "fixed" | "burst";
  };

  // ========== Persistence ==========

  /**
   * Function to cache/persist items when added
   *
   * @param item - Item(s) being added
   * @remarks
   * Called immediately when items are added to the queue (before processing).
   * NOT called for items from {@link rebuildFunction}.
   * Use for saving items to database for crash recovery.
   */
  cacheFunction?: (item: T | readonly T[]) => Effect.Effect<void, Error, never>;

  // ========== Callbacks ==========

  /**
   * Callback after successful processing
   *
   * @param result - Result from processor
   * @param item - Original item that was processed
   * @remarks
   * Runs in a forked fiber (non-blocking). The queue continues processing
   * while the callback runs. Use for notifications, logging, etc.
   */
  onSuccess?: (result: R, item: T) => Effect.Effect<void, never, never>;

  /**
   * Callback after processing error
   *
   * @param error - Error that occurred
   * @param item - Original item that failed
   * @remarks
   * Called when the processor throws an error. Use for error logging,
   * dead letter queues, or retry logic.
   */
  onError?: (error: Error, item: T) => Effect.Effect<void, never, never>;

  // ========== Recovery ==========

  /**
   * Function to rebuild queue from cache/database
   *
   * @param queueMethods - Methods to add items at different priorities
   * @returns Effect that loads and re-adds items
   * @remarks
   * Called automatically when the queue becomes empty. Use to reload
   * pending items from database after a restart. Items added here do NOT
   * trigger {@link cacheFunction}.
   */
  rebuildFunction?: (queueMethods: {
    /** Add items at high priority */
    next: (item: T | readonly T[]) => Effect.Effect<void, never, never>;
    /** Add items at normal priority */
    add: (item: T | readonly T[]) => Effect.Effect<void, never, never>;
    /** Add items at low priority */
    deffered: (item: T | readonly T[]) => Effect.Effect<void, never, never>;
  }) => Effect.Effect<void, Error, never>;
}

// ============================================================================
// Queue Factory Functions
// ============================================================================

/**
 * Create a priority queue processor (low-level API)
 *
 * @remarks
 * This is the low-level function for creating queues. Most users should use
 * {@link makeQueueService} instead, which provides proper Effect service integration.
 *
 * Creates a scoped queue processor with:
 * - Three priority levels (high, normal, low)
 * - Concurrent workers
 * - Rate limiting
 * - Automatic cache persistence
 * - Error handling
 * - Automatic rebuild on empty
 *
 * @typeParam T - Type of items to process
 * @typeParam R - Return type of processor function
 *
 * @param config - Queue configuration
 * @returns Scoped effect producing a queue processor
 *
 * @example
 * ```typescript
 * const queueEffect = createQueue({
 *   processor: (item: string) => Effect.succeed(item.toUpperCase()),
 *   concurrency: 3,
 *   queueCapacity: 1000,
 * });
 *
 * // Must be run in a scope
 * yield* Effect.scoped(
 *   Effect.gen(function* () {
 *     const queue = yield* queueEffect;
 *     yield* queue.add(["item1", "item2"]);
 *   })
 * );
 * ```
 *
 * @public
 */
export const createQueue = <T, R>(
  config: QueueProcessorConfig<T, R>
): Effect.Effect<PriorityQueueProcessor<T, R>, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const {
        processor,
        queueCapacity = 50000,
        concurrency: semaphore = 5,
        throttle = { limit: 1, duration: Duration.seconds(1) },
        cacheFunction,
        onSuccess,
        onError,
        rebuildFunction,
      } = config;

      // Create queues
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
      const sem = yield* Effect.makeSemaphore(semaphore);

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

      // Track onSuccess fibers for automatic cleanup with finalizers
      const onSuccessFibers = yield* Ref.make(
        new Set<Fiber.RuntimeFiber<void, never>>()
      );

      // Process a single item
      const processItem = (item: T) =>
        sem.withPermits(1)(
          throttler(
            Effect.gen(function* () {
              yield* Effect.logDebug(
                `Processing item: ${JSON.stringify(item)}`
              );

              const result = yield* processor(item).pipe(
                Effect.catchAll((error) => {
                  if (onError) {
                    return onError(error, item);
                  }
                  return Effect.void;
                })
              );

              // Increment processed count
              const currentCount = yield* Ref.get(processedCount);
              yield* Ref.set(processedCount, currentCount + 1);

              // Fork onSuccess to make it non-blocking and track the fiber
              if (onSuccess && result !== undefined) {
                const onSuccessFiber = yield* Effect.fork(
                  onSuccess(result, item).pipe(
                    Effect.ensuring(
                      Effect.gen(function* () {
                        // Remove fiber from tracking when it completes
                        yield* Ref.update(onSuccessFibers, (fibers) => {
                          fibers.delete(onSuccessFiber);
                          return new Set(fibers);
                        });
                        yield* Effect.logDebug(
                          `onSuccess completed for item: ${JSON.stringify(
                            item
                          )}`
                        );
                      })
                    )
                  )
                );

                // Track the fiber for finalizer cleanup
                yield* Ref.update(onSuccessFibers, (fibers) => {
                  fibers.add(onSuccessFiber);
                  return new Set(fibers);
                });
              }

              yield* Effect.logDebug(`Completed item: ${JSON.stringify(item)}`);
            })
          )
        );

      // Event-driven worker that blocks on Queue.take
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
      const getNextItemBlocking = (): Effect.Effect<T, never, never> =>
        Effect.gen(function* () {
          // First try polling each queue in priority order
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

          // All queues are empty, try to rebuild or wait
          return yield* handleEmptyQueue();
        });

      // Rebuild from database and then wait for next item
      const handleEmptyQueue = (): Effect.Effect<T, never, never> =>
        Effect.gen(function* () {
          yield* Effect.logDebug("Queue is empty, waiting for more items");

          const rebuilding = yield* Ref.get(isRebuilding);

          if (rebuildFunction && !rebuilding) {
            // Start rebuild
            yield* Ref.set(isRebuilding, true);
            yield* Effect.logInfo("🔄 Rebuilding queue from database...");

            yield* rebuildFunction(rebuildQueueMethods).pipe(
              Effect.catchAll(() => Effect.void) // Don't fail on rebuild errors
            );

            yield* Ref.set(isRebuilding, false);
            yield* Effect.logInfo("✅ Rebuild completed");

            // After rebuild, try to get an item using priority order
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
            const worker = yield* Effect.fork(createWorker());
            workers.push(worker);
          }
          return workers;
        });

      // Create queue methods for rebuild function (without caching since items are already persisted)
      const rebuildQueueMethods = {
        next: (item: T | readonly T[]) =>
          Effect.gen(function* () {
            if (Array.isArray(item)) {
              yield* Queue.offerAll(high, item);
            } else {
              yield* Queue.offer(high, item as T);
            }
          }),

        add: (item: T | readonly T[]) =>
          Effect.gen(function* () {
            if (Array.isArray(item)) {
              yield* Queue.offerAll(regular, item);
            } else {
              yield* Queue.offer(regular, item as T);
            }
          }),

        deffered: (item: T | readonly T[]) =>
          Effect.gen(function* () {
            if (Array.isArray(item)) {
              yield* Queue.offerAll(low, item);
            } else {
              yield* Queue.offer(low, item as T);
            }
          }),
      };

      // Start workers
      const workers = yield* startWorkers();

      // Add finalizer to ensure all onSuccess fibers complete when scope closes
      yield* Effect.addFinalizer((_exit) =>
        Effect.gen(function* () {
          const fibers = yield* Ref.get(onSuccessFibers);
          if (fibers.size > 0) {
            yield* Effect.logInfo(
              `Waiting for ${fibers.size} onSuccess fibers to complete...`
            );
            yield* Effect.all(
              Array.from(fibers).map((fiber) => fiber.await),
              { concurrency: "unbounded" }
            );
            yield* Effect.logInfo(
              "All onSuccess fibers completed successfully"
            );
          }
        })
      );

      // Create the queue processor for internal use
      const queueProcessor: PriorityQueueProcessor<T, R> = {
        next: (item: T | readonly T[]) =>
          Effect.gen(function* () {
            // Start caching in background (non-blocking)
            if (cacheFunction) {
              yield* Effect.fork(
                cacheFunction(item).pipe(
                  Effect.catchAll(() => Effect.void) // Don't fail on cache errors
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
              yield* Effect.fork(
                cacheFunction(item).pipe(
                  Effect.catchAll(() => Effect.void) // Don't fail on cache errors
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
              yield* Effect.fork(
                cacheFunction(item).pipe(
                  Effect.catchAll(() => Effect.void) // Don't fail on cache errors
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

        isEmpty: () =>
          Effect.gen(function* () {
            return (
              (yield* Queue.isEmpty(high)) &&
              (yield* Queue.isEmpty(regular)) &&
              (yield* Queue.isEmpty(low))
            );
          }),

        // Status and control methods
        getProcessedCount: () => Ref.get(processedCount),
        pause: () => Ref.set(isPaused, true),
        resume: () => Ref.set(isPaused, false),
        shutdown: () =>
          Effect.gen(function* () {
            yield* Ref.set(isRunning, false);
            yield* Ref.set(isPaused, false);
            // Don't shutdown queues permanently - just stop the workers
            // This allows the queue to be restarted later
            yield* Effect.logDebug(
              "Queue stopped - workers will exit gracefully"
            );
          }),
        restart: () =>
          Effect.gen(function* () {
            // Clear all pending items from queues
            const highItems = yield* Queue.takeAll(high);
            const regularItems = yield* Queue.takeAll(regular);
            const lowItems = yield* Queue.takeAll(low);
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
        _workers: workers,
      };

      // Return the PriorityQueueProcessor directly
      return queueProcessor;
    })
  );

/**
 * Configuration for creating a queue service
 *
 * @remarks
 * Extends {@link QueueProcessorConfig} with a unique name for service identification.
 *
 * @typeParam ID - Unique string literal identifier for the queue
 * @typeParam T - Type of items to process
 * @typeParam R - Return type of processor function
 *
 * @public
 */
export interface QueueServiceConfig<ID extends string, T, R>
  extends QueueProcessorConfig<T, R> {
  /** Unique name for the queue service (must be a string literal) */
  readonly name: ID;
}

/**
 * Create a priority queue service with Effect integration
 *
 * @remarks
 * This is the recommended way to create queues for use with ProcessManager.
 * Returns a tuple of [ServiceTag, Layer] for dependency injection.
 *
 * **Benefits over {@link createQueue}:**
 * - Proper Effect service integration
 * - Automatic dependency management
 * - Type-safe service identification
 * - Easy to provide/compose in layers
 *
 * **Usage Pattern:**
 * 1. Call `makeQueueService` to get [Tag, Layer]
 * 2. Use the Tag to access the queue in your Effects
 * 3. Provide the Layer when running your program
 *
 * @typeParam ID - Unique string literal identifier for the queue
 * @typeParam T - Type of items to process
 * @typeParam R - Return type of processor function
 *
 * @param config - Queue service configuration
 * @returns Tuple of [ServiceTag, ServiceLayer] for dependency injection
 *
 * @example
 * ```typescript
 * // Create a queue service
 * const [EmailQueue, EmailQueueLive] = makeQueueService({
 *   name: "email-queue",
 *   processor: (email: Email) => sendEmail(email),
 *   concurrency: 5,
 *   queueCapacity: 1000,
 * });
 *
 * // Use the queue in your program
 * const program = Effect.gen(function* () {
 *   const queue = yield* EmailQueue;
 *   yield* queue.add([email1, email2]);
 * });
 *
 * // Provide the layer when running
 * program.pipe(
 *   Effect.provide(EmailQueueLive),
 *   Effect.runPromise
 * );
 * ```
 *
 * @example
 * ```typescript
 * // With all options
 * const [ProcessingQueue, ProcessingQueueLive] = makeQueueService({
 *   name: "processing-queue",
 *   processor: (item: Task) => processTask(item),
 *   concurrency: 10,
 *   queueCapacity: 5000,
 *   throttle: { limit: 100, duration: Duration.minutes(1) }, // 100 items per minute
 *   onSuccess: (result, item) => Effect.logInfo(\`Processed: \${item.id}\`),
 *   onError: (error, item) => Effect.logError(\`Failed: \${item.id}\`),
 *   cacheFunction: (items) => saveToDatabase(items),
 *   rebuildFunction: ({ add }) =>
 *     Effect.gen(function* () {
 *       const pending = yield* loadPendingTasks();
 *       yield* add(pending);
 *     }),
 * });
 * ```
 *
 * @public
 */
export const makeQueueService = <ID extends string, T, R>(
  config: QueueServiceConfig<ID, T, R>
) => {
  const service = Context.GenericTag<
    PriorityQueueProcessor<T, R> & { _brand: ID },
    PriorityQueueProcessor<T, R>
  >(config.name);
  return [service, Layer.effect(service, createQueue(config))] as const;
};
