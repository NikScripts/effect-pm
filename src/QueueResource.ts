/**
 * QueueResource — Effect-idiomatic priority queue with managed workers.
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

// ============================================================================
// Public Types
// ============================================================================

/** @public */
export type Priority = "high" | "normal" | "low";

/**
 * The service shape returned from `yield* MyQueue`.
 * Effectful properties (no parens) for reads/actions without input.
 *
 * @public
 */
export interface QueueHandle<in out T, out _R = void, out _E = never> {
  readonly add: (items: Iterable<T>) => Effect.Effect<void>;
  readonly prioritize: (items: Iterable<T>) => Effect.Effect<void>;
  readonly defer: (items: Iterable<T>) => Effect.Effect<void>;

  readonly size: Effect.Effect<number>;
  readonly sizes: Effect.Effect<{
    readonly high: number;
    readonly normal: number;
    readonly low: number;
  }>;
  readonly isEmpty: Effect.Effect<boolean>;
  readonly completed: Effect.Effect<number>;

  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
  readonly clear: Effect.Effect<number>;
}

/**
 * Passed to `effect` — guarded enqueue for derived work + item metadata.
 *
 * @public
 */
export interface EffectContext<T> {
  readonly add: (items: Iterable<T>) => Effect.Effect<void>;
  readonly prioritize: (items: Iterable<T>) => Effect.Effect<void>;
  readonly defer: (items: Iterable<T>) => Effect.Effect<void>;
  readonly attempts: number;
  readonly enqueuedAt: Date;
  readonly priority: Priority;
}

/**
 * Passed to `handler` — retry + unguarded enqueue + item metadata.
 *
 * `retry` re-enqueues the item at the SAME priority (back of the line).
 * It is NOT immediate re-execution — the item waits in the queue.
 *
 * @public
 */
export interface HandlerContext<T> {
  readonly retry: Effect.Effect<void>;
  readonly add: (items: Iterable<T>) => Effect.Effect<void>;
  readonly prioritize: (items: Iterable<T>) => Effect.Effect<void>;
  readonly defer: (items: Iterable<T>) => Effect.Effect<void>;
  readonly attempts: number;
  readonly enqueuedAt: Date;
  readonly priority: Priority;
}

/**
 * Configuration for QueueResource.make.
 *
 * @public
 */
export interface QueueResourceConfig<T, R, E> {
  readonly name?: string;
  /** Start with processing paused. Call resume to begin. @default false */
  readonly paused?: boolean;
  readonly effect: (
    item: T,
    ctx: EffectContext<T>,
  ) => Effect.Effect<R, E>;
  readonly handler?: (
    item: T,
    exit: Exit.Exit<R, E>,
    ctx: HandlerContext<T>,
  ) => Effect.Effect<void>;
  readonly concurrency?: number;
  readonly capacity?: number;
  readonly key?: (item: T) => string;
  readonly retries?: number;
  readonly onRetryExhausted?: (
    item: T,
    cause: Cause.Cause<E>,
  ) => Effect.Effect<void>;
  readonly persist?: (
    items: ReadonlyArray<T>,
    priority: Priority,
  ) => Effect.Effect<void>;
  readonly refill?: (queue: QueueHandle<T, R, E>) => Effect.Effect<void>;
  readonly onEnqueue?: (
    items: ReadonlyArray<T>,
    priority: Priority,
  ) => Effect.Effect<void>;
  readonly onComplete?: (
    item: T,
    exit: Exit.Exit<R, E>,
    elapsed: Duration.Duration,
  ) => Effect.Effect<void>;
  readonly onEmpty?: Effect.Effect<void>;
}

// ============================================================================
// Errors
// ============================================================================

/** @public */
export class QueueShutdownError extends Data.TaggedError(
  "QueueShutdownError",
)<{
  readonly queue: string;
}> {}

// ============================================================================
// Backwards-compat type alias for ProcessGroup
// ============================================================================

/** @public */
export type QueueRef<
  _Name extends string,
  T,
  R,
  E = never,
> = QueueHandle<T, R, E>;

// ============================================================================
// Internal Utilities
// ============================================================================

function iterableToArray<A>(input: Iterable<A>): ReadonlyArray<A> {
  return Array.from(input);
}

// ============================================================================
// Internal Item Wrapper
// ============================================================================

interface InternalItem<T> {
  readonly item: T;
  readonly retries: number;
  readonly priority: Priority;
  readonly enqueuedAt: number;
  readonly key: string | undefined;
}

// ============================================================================
// Core: QueueResource.make
// ============================================================================

const makeQueueEffect = <T, R, E>(
  config: QueueResourceConfig<T, R, E>,
) =>
  Effect.gen(function* () {
    const queueName = config.name ?? "anonymous";
    const concurrency = config.concurrency ?? 5;
    const capacity = config.capacity ?? 50_000;
    const maxRetries = config.retries ?? Infinity;

    const highQueue = yield* Queue.bounded<InternalItem<T>>(capacity);
    const normalQueue = yield* Queue.bounded<InternalItem<T>>(capacity);
    const lowQueue = yield* Queue.bounded<InternalItem<T>>(capacity);

    const latch = yield* Latch.make(!(config.paused ?? false));
    const semaphore = yield* Semaphore.make(concurrency);
    const completedCount = yield* Ref.make(0);
    const isShutdownRef = yield* Ref.make(false);
    const activeKeys = yield* Ref.make(HashSet.empty<string>());

    let wakeSignal = yield* Deferred.make<void>();

    const workerFibers = yield* FiberSet.make<void>();
    const handlerFibers = yield* FiberSet.make<void>();

    // ─── Internal helpers ───

    const signalWake = Effect.gen(function* () {
      yield* Deferred.succeed(wakeSignal, undefined);
      wakeSignal = yield* Deferred.make<void>();
    });

    const queueForPriority = (priority: Priority) =>
      priority === "high"
        ? highQueue
        : priority === "low"
          ? lowQueue
          : normalQueue;

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
          if (config.key) {
            const k = config.key(item);
            const keys = yield* Ref.get(activeKeys);
            if (HashSet.has(keys, k)) continue;
            yield* Ref.update(activeKeys, HashSet.add(k));
          }
          toEnqueue.push({
            item,
            retries,
            priority,
            enqueuedAt: enqueuedAt ?? Date.now(),
            key: config.key ? config.key(item) : undefined,
          });
        }

        if (toEnqueue.length === 0) return;

        yield* Queue.offerAll(queueForPriority(priority), toEnqueue);
        yield* signalWake;

        if (config.onEnqueue) {
          yield* config
            .onEnqueue(
              toEnqueue.map((i) => i.item),
              priority,
            )
            .pipe(Effect.ignore);
        }

        if (config.persist) {
          yield* config
            .persist(
              toEnqueue.map((i) => i.item),
              priority,
            )
            .pipe(Effect.ignore);
        }
      });

    const enqueuePublic = (
      items: Iterable<T>,
      priority: Priority,
    ): Effect.Effect<void> => enqueueInternal(iterableToArray(items), priority);

    // ─── EffectContext (guarded) ───

    const makeEffectContext = (
      internal: InternalItem<T>,
    ): EffectContext<T> => {
      const isSameItem = (candidate: T): boolean => {
        if (candidate === internal.item) return true;
        if (config.key && internal.key && config.key(candidate) === internal.key)
          return true;
        return false;
      };

      const guardedEnqueue = (
        candidates: Iterable<T>,
        priority: Priority,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const items = iterableToArray(candidates);
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
        enqueuedAt: new Date(internal.enqueuedAt),
        priority: internal.priority,
      };
    };

    // ─── HandlerContext ───

    const makeHandlerContext = (
      internal: InternalItem<T>,
      exit: Exit.Exit<R, E>,
    ): HandlerContext<T> => ({
      retry: Effect.gen(function* () {
        if (internal.retries >= maxRetries) {
          if (config.onRetryExhausted) {
            const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
            yield* config.onRetryExhausted(internal.item, cause).pipe(
              Effect.ignore,
            );
          }
          return;
        }
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
      enqueuedAt: new Date(internal.enqueuedAt),
      priority: internal.priority,
    });

    // ─── Priority dispatch ───

    const takeNext: Effect.Effect<InternalItem<T>> = Effect.gen(function* () {
      const high = yield* Queue.poll(highQueue);
      if (Option.isSome(high)) return high.value;

      const normal = yield* Queue.poll(normalQueue);
      if (Option.isSome(normal)) return normal.value;

      const low = yield* Queue.poll(lowQueue);
      if (Option.isSome(low)) return low.value;

      yield* Deferred.await(wakeSignal);
      return yield* takeNext;
    });

    // ─── Item processing ───

    const processItem = (internal: InternalItem<T>): Effect.Effect<void> =>
      semaphore.withPermits(1)(
        Effect.gen(function* () {
          const start = Date.now();
          const ctx = makeEffectContext(internal);
          const exit = yield* Effect.exit(config.effect(internal.item, ctx));
          const elapsed = Duration.millis(Date.now() - start);

          yield* Ref.update(completedCount, (n) => n + 1);

          if (config.key && internal.key) {
            yield* Ref.update(activeKeys, HashSet.remove(internal.key));
          }

          if (config.onComplete) {
            yield* FiberSet.run(handlerFibers)(
              config.onComplete(internal.item, exit, elapsed).pipe(Effect.ignore),
            );
          }

          if (config.handler) {
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

    // ─── Worker loop ───

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

    // ─── Start workers ───

    for (let i = 0; i < concurrency; i++) {
      yield* FiberSet.run(workerFibers)(workerLoop(i));
    }

    // ─── Build public handle ───

    const queueHandle: QueueHandle<T, R, E> = {
      add: (items) => enqueuePublic(items, "normal"),
      prioritize: (items) => enqueuePublic(items, "high"),
      defer: (items) => enqueuePublic(items, "low"),

      size: Effect.gen(function* () {
        const h = yield* Queue.size(highQueue);
        const n = yield* Queue.size(normalQueue);
        const l = yield* Queue.size(lowQueue);
        return Math.max(0, h) + Math.max(0, n) + Math.max(0, l);
      }),

      sizes: Effect.gen(function* () {
        const h = yield* Queue.size(highQueue);
        const n = yield* Queue.size(normalQueue);
        const l = yield* Queue.size(lowQueue);
        return {
          high: Math.max(0, h),
          normal: Math.max(0, n),
          low: Math.max(0, l),
        };
      }),

      isEmpty: Effect.gen(function* () {
        const h = yield* Queue.size(highQueue);
        const n = yield* Queue.size(normalQueue);
        const l = yield* Queue.size(lowQueue);
        return h <= 0 && n <= 0 && l <= 0;
      }),

      completed: Ref.get(completedCount),

      pause: Effect.asVoid(latch.close),
      resume: Effect.asVoid(latch.open),

      shutdown: Effect.gen(function* () {
        yield* Ref.set(isShutdownRef, true);
        yield* signalWake;
      }),

      clear: Effect.gen(function* () {
        let count = 0;
        const drain = <A>(q: Queue.Queue<A>): Effect.Effect<void> =>
          Effect.gen(function* () {
            const item = yield* Queue.poll(q);
            if (Option.isSome(item)) {
              count++;
              yield* drain(q);
            }
          });
        yield* drain(highQueue);
        yield* drain(normalQueue);
        yield* drain(lowQueue);
        yield* Ref.set(completedCount, 0);
        return count;
      }),
    };

    // ─── Refill on empty ───

    if (config.refill) {
      const refillFn = config.refill;
      yield* FiberSet.run(workerFibers)(
        Effect.forever(
          Effect.gen(function* () {
            const empty = yield* queueHandle.isEmpty;
            if (empty) {
              const shutdown = yield* Ref.get(isShutdownRef);
              if (shutdown) return yield* Effect.interrupt;
              yield* refillFn(queueHandle).pipe(Effect.ignore);
              if (config.onEmpty) {
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

/** @public */
export const QueueResource = {
  make: makeQueueEffect,

  layer: <Self, T, R, E>(
    tag: Context.Key<Self, QueueHandle<T, R, E>>,
    config: QueueResourceConfig<T, R, E>,
  ) => Layer.effect(tag)(makeQueueEffect(config)),

  Service: <Self, T, R, E = never>() =>
  <const Name extends string>(
    name: Name,
    config: QueueResourceConfig<T, R, E>,
  ) => {
    const tag = Context.Service<Self, QueueHandle<T, R, E>>(name);
    const layer = Layer.effect(tag)(makeQueueEffect({ ...config, name }));
    return Object.assign(tag, { layer });
  },

  Tag: <Self, T, R, E = never>() =>
  <const Name extends string>(name: Name) =>
    Context.Service<Self, QueueHandle<T, R, E>>(name),
};
