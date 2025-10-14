/**
 * ResourcePool - Managed Effect Execution System
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
 * - Non-blocking success callbacks
 * - Pause/resume/restart capabilities
 * 
 * @module ResourcePool
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
 * ResourcePool status details for monitoring
 * 
 * @public
 */
export interface ResourcePoolDetails {
  /** Current number of items in pool */
  size: number;
  /** Total number of items completed */
  completed: number;
  /** Number of active worker fibers */
  workers: number;
  /** Whether the pool is currently processing items */
  running: boolean;
  /** Additional metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * ResourcePool Interface
 * 
 * @remarks
 * The main interface for interacting with a ResourcePool. Provides methods
 * to add items at different priority levels, monitor pool status, and control
 * pool lifecycle.
 * 
 * @typeParam T - Type of items to process
 * @typeParam R - Return type of the effect function
 * 
 * @public
 */
export interface ResourcePool<T, _R> {
  /**
   * Add item(s) to high priority queue
   *
   * @param item - Single item or array of items
   * @remarks
   * High priority items are processed before normal and low priority items.
   * Use for urgent tasks that need immediate attention.
   */
  readonly next: (item: T | readonly T[]) => Effect.Effect<void>;

  /**
   * Add item(s) to normal priority queue (default)
   *
   * @param item - Single item or array of items
   * @remarks
   * Normal priority is the default for most items. Processed after high
   * priority but before low priority items.
   */
  readonly add: (item: T | readonly T[]) => Effect.Effect<void>;

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
  ) => Effect.Effect<void>;

  /**
   * Get current pool size (all priority levels combined)
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
   * Check if pool is empty
   * 
   * @returns True if no items are pending at any priority level
   */
  readonly isEmpty: () => Effect.Effect<boolean>;

  // ========== Status and Control Methods ==========
  
  /**
   * Get total number of items completed
   * 
   * @returns Count of successfully processed items since pool start
   */
  readonly getProcessedCount: () => Effect.Effect<number>;
  
  /**
   * Pause pool processing
   * 
   * @remarks
   * Workers will stop processing new items but current items will complete.
   * Use {@link resume} to continue processing.
   */
  readonly pause: () => Effect.Effect<void>;
  
  /**
   * Resume pool processing after pause
   * 
   * @remarks
   * Workers will continue processing pending items.
   */
  readonly resume: () => Effect.Effect<void>;
  
  /**
   * Shutdown pool permanently
   * 
   * @remarks
   * Stops all workers and prevents further processing. Cannot be resumed.
   * The pool scope will be closed.
   */
  readonly shutdown: () => Effect.Effect<void>;
  
  /**
   * Restart pool processing
   * 
   * @remarks
   * Stops and then restarts all workers. Useful for recovering from errors
   * or refreshing pool state.
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
  readonly _workers: readonly Fiber.RuntimeFiber<void>[];
}

/**
 * Configuration for ResourcePool
 * 
 * @remarks
 * Configuration object for creating a ResourcePool with {@link ResourcePool.make}.
 * 
 * @typeParam T - Type of items to process
 * @typeParam R - Return type of effect function
 * 
 * @public
 */
export interface ResourcePoolConfig<T, R> {
  /** Unique name for the resource pool (must be a string literal) */
  readonly name: string;
  // ========== Processing ==========

  /**
   * Effect to execute for each item
   * 
   * @param item - Item to process
   * @returns Effect producing the processed result
   * @remarks
   * This effect is executed for each item in the pool. It should handle
   * the actual work. Errors will be caught and passed to {@link onError}.
   */
  readonly effect: (item: T) => Effect.Effect<R, Error>;

  // ========== Queue Configuration ==========

  /**
   * Maximum number of items the queue can hold
   *
   * @defaultValue 50000
   * @remarks
   * When the queue is full, adding new items will block until space is available.
   * This prevents memory issues from unlimited queue growth.
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
   * @remarks
   * Called immediately when items are added to the queue (before processing).
   * NOT called for items from {@link refill}.
   * Use for saving items to database for crash recovery.
   */
  cache?: (item: T | readonly T[]) => Effect.Effect<void, Error>;

  /**
   * Function to rebuild queue from cache/database
   *
   * @param queueMethods - Methods to add items at different priorities
   * @returns Effect that loads and re-adds items
   * @remarks
   * Called automatically when the queue becomes empty. Use to reload
   * pending items from database after a restart. Items added here do NOT
   * trigger {@link cache}.
   */
  refill?: (queueMethods: {
    /** Add items at high priority */
    next: (item: T | readonly T[]) => Effect.Effect<void>;
    /** Add items at normal priority */
    add: (item: T | readonly T[]) => Effect.Effect<void>;
    /** Add items at low priority */
    deffered: (item: T | readonly T[]) => Effect.Effect<void>;
  }) => Effect.Effect<void, Error>;

  // ========== Callbacks ==========

  /**
   * Effect to run after successful processing
   * 
   * @param result - Result from effect
   * @param item - Original item that was processed
   * @remarks
   * Runs in a forked fiber (non-blocking). The pool continues processing
   * while the callback runs. Use for notifications, logging, etc.
   */
  readonly onSuccess?: (result: R, item: T) => Effect.Effect<void>;
  
  /**
   * Effect to run after processing error
   * 
   * @param error - Error that occurred
   * @param item - Original item that failed
   * @remarks
   * Called when the effect throws an error. Use for error logging,
   * dead letter queues, or retry logic.
   */
  readonly onError?: (error: Error, item: T) => Effect.Effect<void>;
}

// ============================================================================
// ResourcePool Factory
// ============================================================================

/**
 * Create a ResourcePool effect (internal implementation)
 * 
 * @internal
 * @remarks
 * Internal function for creating the ResourcePool effect. Use {@link ResourcePool.make}
 * for the public API.
 * 
 * Creates a scoped ResourcePool with:
 * - Three priority levels (high, normal, low)
 * - Concurrent workers
 * - Rate limiting
 * - Automatic cache persistence
 * - Error handling
 * - Automatic refill on empty
 * 
 * @typeParam T - Type of items to process
 * @typeParam R - Return type of effect function
 * 
 * @param config - Pool configuration (without name)
 * @returns Scoped effect producing a ResourcePool
 */
const makeResourcePoolEffect = <T, R>(
  config: Omit<ResourcePoolConfig<T, R>, "name">
): Effect.Effect<ResourcePool<T, R>> =>
  Effect.scoped(
    Effect.gen(function* () {
      const {
        effect: processor,
        capacity: queueCapacity = 50000,
        concurrency: semaphore = 5,
        throttle = { limit: 1, duration: Duration.seconds(1) },
        cache: cacheFunction,
        onSuccess,
        onError,
        refill: rebuildFunction,
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
        new Set<Fiber.RuntimeFiber<void>>()
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
      const getNextItemBlocking = (): Effect.Effect<T> =>
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
      const handleEmptyQueue = (): Effect.Effect<T> =>
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

      // Create the ResourcePool instance
      const pool: ResourcePool<T, R> = {
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

      // Return the ResourcePool instance
      return pool;
    })
  );

/**
 * ResourcePool - Managed Effect Execution with Priority Scheduling
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
 * - Non-blocking success callbacks
 * - Pause/resume/restart capabilities
 * 
 * **Usage:**
 * 1. Call `ResourcePool.make()` to create a pool service
 * 2. Yield the service tag in your Effects to access the pool
 * 3. Provide the `.Default` layer when running your program
 * 
 * @example
 * ```typescript
 * import { ResourcePool, ProcessManager } from "@nikscripts/effect-pm";
 * import { Effect, Duration } from "effect";
 * 
 * // Create a resource pool
 * const EmailPool = ResourcePool.make({
 *   name: "email-pool",
 *   effect: (email: Email) => sendEmail(email),
 *   concurrency: 5,
 *   capacity: 1000,
 * });
 * 
 * // Use in your program
 * const program = Effect.gen(function* () {
 *   const pool = yield* EmailPool;
 *   yield* pool.add([email1, email2, email3]);
 * });
 * 
 * // Provide the layer
 * program.pipe(
 *   Effect.provide(EmailPool.Default),
 *   Effect.runPromise
 * );
 * ```
 * 
 * @example
 * ```typescript
 * // With all options
 * const ProcessingPool = ResourcePool.make({
 *   name: "processing-pool",
 *   effect: (task: Task) => processTask(task),
 *   concurrency: 10,
 *   capacity: 5000,
 *   throttle: { limit: 100, duration: Duration.minutes(1) },
 *   onSuccess: (result, task) => Effect.logInfo(\`Done: \${task.id}\`),
 *   onError: (error, task) => Effect.logError(\`Failed: \${task.id}\`),
 *   cache: (tasks) => saveToDatabase(tasks),
 *   refill: ({ add }) => 
 *     Effect.gen(function* () {
 *       const pending = yield* loadPendingTasks();
 *       yield* add(pending);
 *     }),
 * });
 * ```
 * 
 * @public
 */
export const ResourcePool = {
  /**
   * Create a ResourcePool service
   * 
   * @typeParam T - Type of items to process
   * @typeParam R - Return type of effect function
   * 
   * @param config - ResourcePool configuration
   * @returns Service tag with Default layer that can be yielded and provided
   */
  make: <T, R>(
    config: ResourcePoolConfig<T, R>
  ) => {
    const service = Context.GenericTag<
      ResourcePool<T, R> & { _brand: typeof config.name },
      ResourcePool<T, R>
    >(config.name);
    
    const layer = Layer.effect(service, makeResourcePoolEffect(config));
    
    return Object.assign(service, { Default: layer });
  },
}