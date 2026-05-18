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
 * const EmailQueue = QueueResource.Service<typeof EmailQueue, Email, SmtpError, HttpClient.HttpClient>()(
 *   "@app/EmailQueue",
 *   {
 *     effect: (email, ctx) => sendEmail(email).pipe(Effect.asVoid),
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

import type { JsonSchema } from "effect";
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
  Schema,
  Scope,
  Semaphore,
  Types,
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
 * JSON-safe metadata for queue item wire encoding and typed group contracts.
 *
 * @public
 */
export interface QueueItemCodecDescriptor {
  /** Stable codec id, e.g. `"@app/EmailQueue/item@v1"`. */
  readonly id: string;
  /** Version string for drift checks (bump when encoded shape breaks). */
  readonly version: string;
  /** Wire encoding; `"json"` is the only supported value today. */
  readonly encoding: "json";
  /** Draft-07 JSON Schema for the **encoded** item payload. */
  readonly jsonSchema: JsonSchema.JsonSchema;
}

/**
 * Runtime schema for {@link QueueItemCodecDescriptor}.
 *
 * @public
 */
export const QueueItemCodecDescriptorSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  encoding: Schema.Literal("json"),
  jsonSchema: Schema.Unknown,
});

/**
 * Build a {@link QueueItemCodecDescriptor} from a live Effect `Schema` value.
 *
 * @public
 */
export const makeQueueItemCodecDescriptor = <T>(
  queueId: string,
  itemSchema: Schema.Decoder<T, never>,
  options?: { readonly version?: string },
): QueueItemCodecDescriptor => {
  const wrapped = Schema.toStandardJSONSchemaV1(itemSchema);
  const jsonSchema = wrapped["~standard"].jsonSchema.input({ target: "draft-07" });
  return {
    id: `${queueId}/item@v1`,
    version: options?.version ?? "1.0.0",
    encoding: "json",
    jsonSchema,
  };
};

/**
 * Single-item enqueue failed schema validation before the queue mutated.
 *
 * @public
 */
export class QueueItemValidationError extends Data.TaggedError("QueueItemValidationError")<{
  readonly queue: string;
  readonly operation: "add" | "prioritize" | "defer";
  readonly input: unknown;
  readonly message: string;
  readonly codecId?: string;
}> {}

/**
 * Batch enqueue failed schema validation under atomic semantics (no items enqueued).
 *
 * @public
 */
export class QueueBatchValidationError extends Data.TaggedError("QueueBatchValidationError")<{
  readonly queue: string;
  readonly operation: "add" | "prioritize" | "defer";
  readonly mode: "atomic";
  readonly failures: ReadonlyArray<{
    readonly index: number;
    readonly input: unknown;
    readonly message: string;
  }>;
  readonly codecId?: string;
}> {}

/**
 * Enqueue a single item or a readonly batch of items.
 *
 * @typeParam E - Validation errors when {@link QueueResourceConfig.itemSchema} is set
 * @typeParam R - Dependencies needed to run enqueue-time hooks (`persist`, `onEnqueue`, …) when called from the ambient program
 *
 * @public
 */
export interface QueueEnqueue<T, E = never, R = never> {
  (item: T): Effect.Effect<void, E, R>;
  (items: ReadonlyArray<T>): Effect.Effect<void, E, R>;
}

/**
 * Keeps **`E`** (worker failure channel) nominally observable on {@link QueueHandle}
 * without adding runtime surface area.
 *
 * @internal
 */
export type QueueHandlePhantomWorkerFailures<E = never> = {
  readonly _phantomWorkerEffectFailure?: Types.NoInfer<E>;
};

/**
 * The service interface returned from `yield* MyQueue`.
 *
 * All observation methods (`size`, `sizes`, `isEmpty`, `completed`) and lifecycle
 * actions (`start`, `pause`, `resume`, `shutdown`, `clear`) are effectful properties —
 * access them with `yield*` directly (no function call parentheses).
 *
 * Enqueue methods accept either a single item or a readonly array of items.
 *
 * @typeParam T - Item type processed by this queue
 * @typeParam E - Recoverable/item failure channel of the worker `effect`
 * @typeParam EEnqueue - Errors from schema-backed enqueue validation (see {@link QueueResourceConfig.itemSchema})
 * @typeParam R - Dependencies required while running worker `effect`, `handler`, hooks, and enqueue helpers
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
export interface QueueHandleApi<
  in out T,
  EEnqueue = never,
  R = never,
> {
  /** Enqueue items at **normal** priority. */
  readonly add: QueueEnqueue<T, EEnqueue, R>;
  /** Enqueue items at **high** priority (processed before normal and low). */
  readonly prioritize: QueueEnqueue<T, EEnqueue, R>;
  /** Enqueue items at **low** priority (processed after high and normal). */
  readonly defer: QueueEnqueue<T, EEnqueue, R>;

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
   * Fork the worker pool (and `refill` monitor when configured). Idempotent — safe to call multiple times.
   * Only needed when {@link QueueResourceConfigBase.autoStart} was `false`; otherwise workers already started at acquisition.
   *
   * After {@link shutdown}, `start` is a no-op (warning logged).
   */
  readonly start: Effect.Effect<void, never, R>;

  /**
   * Invoke {@link QueueResourceConfigBase.refill} once when configured (manual bootstrap).
   * Automatic empty-triggered refill wakes only after queues drain empty following processed work (or after {@link QueueHandleApi.clear});
   * enqueue wakes workers, not the refill monitor. Does **not** run on cold start while queues stay empty.
   */
  readonly refill: Effect.Effect<void, never, R>;

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
 * Priority queue surface for `yield*`able queue services (`T`, `E`, enqueue errors `EEnqueue`, requirements `R` last).
 *
 * @public
 */
export type QueueHandle<
  T,
  E = never,
  EEnqueue = never,
  R = never,
> = QueueHandleApi<T, EEnqueue, R> & QueueHandlePhantomWorkerFailures<E>;

/**
 * Queue declaration metadata for {@link QueueResourceDefinition} and
 * {@link QueueResourceServiceDefinition}.
 *
 * @public
 */
export interface QueueResourceMetadata<
  Id extends string,
  T,
  E = never,
  EEnqueue = never,
  R = never,
> {
  readonly id: Id;
  readonly kind: "queue";
  readonly tag: Context.Service<Id, QueueHandle<T, E, EEnqueue, R>>;
  /**
   * Serializable item codec metadata when {@link QueueResourceConfig.itemSchema}
   * was provided on {@link QueueResource.Service}. Used by typed {@link ProcessGroup}
   * contracts for remote discovery and drift checks.
   */
  readonly item?: QueueItemCodecDescriptor;
}

/**
 * Canonical queue declaration that can be registered with a typed
 * ProcessGroup.
 *
 * @public
 */
export type QueueResourceDefinition<
  Id extends string,
  T,
  E = never,
  EEnqueue = never,
  R = never,
> = Context.Service<Id, QueueHandle<T, E, EEnqueue, R>> &
  QueueResourceMetadata<Id, T, E, EEnqueue, R>;

/**
 * Class-based queue service declaration from {@link QueueResource.Service}.
 *
 * @public
 */
export interface QueueResourceServiceDefinition<
  Self,
  Id extends string,
  T,
  E = never,
  EEnqueue = never,
  R = never,
> extends Context.ServiceClass<Self, Id, QueueHandle<T, E, EEnqueue, R>>,
    Omit<QueueResourceMetadata<Id, T, E, EEnqueue, R>, "tag"> {
  readonly tag: Context.Key<Self, QueueHandle<T, E, EEnqueue, R>>;
  readonly layer: Layer.Layer<Self, never, R>;
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
export interface EffectContext<T, EEnqueue = never, R = never> {
  /** Enqueue derived items at normal priority. Self-enqueue is warned and dropped. */
  readonly add: QueueEnqueue<T, EEnqueue, R>;
  /** Enqueue derived items at high priority. Self-enqueue is warned and dropped. */
  readonly prioritize: QueueEnqueue<T, EEnqueue, R>;
  /** Enqueue derived items at low priority. Self-enqueue is warned and dropped. */
  readonly defer: QueueEnqueue<T, EEnqueue, R>;
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
export interface HandlerContext<T, EEnqueue = never, R = never> {
  /**
   * Re-enqueue this item at the same priority (back of the line).
   * Respects the `retries` limit — when exhausted, `onRetryExhausted` is called
   * and the item is NOT re-enqueued.
   */
  readonly retry: Effect.Effect<void, never, R>;
  /** Enqueue items at normal priority (unguarded). */
  readonly add: QueueEnqueue<T, EEnqueue, R>;
  /** Enqueue items at high priority (unguarded). */
  readonly prioritize: QueueEnqueue<T, EEnqueue, R>;
  /** Enqueue items at low priority (unguarded). */
  readonly defer: QueueEnqueue<T, EEnqueue, R>;
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
 * @typeParam E - Failure channel surfaced as `Exit` failures from the worker `effect`
 * @typeParam R - Dependencies required while running callbacks (`effect`, `handler`, and queue hooks forked alongside workers)
 *
 * @public
 */
/**
 * Shared queue configuration fields (see {@link QueueResourceConfig}).
 *
 * @public
 */
export interface QueueResourceConfigBase<T, E, R> {
  /** Queue name used for log annotations and error messages. @default "anonymous" */
  readonly name?: string;
  /** Start with processing paused. Call `resume` to begin. @default false */
  readonly paused?: boolean;
  /**
   * When `false`, worker fibers (and the optional `refill` fiber) are **not** forked until
   * {@link QueueHandleApi.start} runs. Enqueue still succeeds; items accumulate until workers exist.
   * `pause` / `resume` update the latch before or after `start` — workers observe it once forked.
   *
   * @default true (preserve historic behavior: fork workers as soon as the queue scope acquires).
   */
  readonly autoStart?: boolean;
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
  ) => Effect.Effect<void, never, R>;
  /**
   * Persist items on enqueue (before processing). Called with the batch and
   * priority level. Errors are logged and swallowed (fire-and-forget).
   */
  readonly persist?: (
    items: ReadonlyArray<T>,
    priority: Priority,
  ) => Effect.Effect<void, never, R>;
  /**
   * Hook: fired after item(s) are enqueued. Receives the batch and priority.
   * Fire-and-forget — errors are logged and swallowed.
   */
  readonly onEnqueue?: (
    items: ReadonlyArray<T>,
    priority: Priority,
  ) => Effect.Effect<void, never, R>;
  /**
   * Hook: fired after each item's effect completes. Receives the item, its
   * Exit, and the elapsed Duration. Runs in a forked fiber (non-blocking).
   * Errors are logged and swallowed.
   */
  readonly onComplete?: (
    item: T,
    exit: Exit.Exit<void, E>,
    elapsed: Duration.Duration,
  ) => Effect.Effect<void, never, R>;
  /**
   * Hook: fired when all priority queues become empty (after drain, not idle).
   * Fire-and-forget — errors are logged and swallowed.
   */
  readonly onEmpty?: Effect.Effect<void, never, R>;
}

/**
 * Queue configuration **without** {@link QueueResourceConfigBase} item schema.
 * Enqueue helpers on {@link QueueHandle} and hook contexts do not fail with
 * schema validation errors.
 *
 * @public
 */
export type QueueResourceConfigWithoutItemSchema<T, E, R> = QueueResourceConfigBase<T, E, R> & {
  readonly itemSchema?: undefined;
  /**
   * Process each item. Receives a guarded {@link EffectContext} for spawning
   * derived work. The exit of this effect determines success/failure for the item;
   * the success channel is always **`void`**.
   */
  readonly effect: (item: T, ctx: EffectContext<T, never, R>) => Effect.Effect<void, E, R>;
  /**
   * Handle each item's result. **Always forked** — runs in its own fiber and
   * never blocks the worker from processing the next item.
   */
  readonly handler?: (
    item: T,
    exit: Exit.Exit<void, E>,
    ctx: HandlerContext<T, never, R>,
  ) => Effect.Effect<void, any, R>;
  /**
   * Refill the queue from an external source when all priority queues are empty.
   * Receives the queue handle for re-enqueuing. Errors are logged and swallowed.
   */
  readonly refill?: (queue: QueueHandle<T, E, never, R>) => Effect.Effect<void, never, R>;
};

/**
 * Queue configuration **with** {@link QueueResourceConfigBase} item schema.
 * Public enqueue operations and hook context enqueue helpers can fail with
 * {@link QueueItemValidationError} or {@link QueueBatchValidationError}.
 *
 * @public
 */
/**
 * Enqueue validation errors when {@link QueueResourceConfigWithItemSchema.itemSchema} is set.
 *
 * @public
 */
export type QueueEnqueueErrors = QueueItemValidationError | QueueBatchValidationError;

export type QueueResourceConfigWithItemSchema<T, E, R> = QueueResourceConfigBase<T, E, R> & {
  readonly itemSchema: Schema.Decoder<T, never>;
  readonly effect: (item: T, ctx: EffectContext<T, QueueEnqueueErrors, R>) => Effect.Effect<void, E, R>;
  readonly handler?: (
    item: T,
    exit: Exit.Exit<void, E>,
    ctx: HandlerContext<T, QueueEnqueueErrors, R>,
  ) => Effect.Effect<void, any, R>;
  readonly refill?: (queue: QueueHandle<T, E, QueueEnqueueErrors, R>) => Effect.Effect<void, never, R>;
};

/**
 * Configuration for {@link QueueResource.make}.
 *
 * @typeParam T - Item type
 * @typeParam E - Worker `effect` failure channel
 * @typeParam R - Dependencies required while running callbacks
 *
 * @public
 */
export type QueueResourceConfig<T, E, R> =
  | QueueResourceConfigWithoutItemSchema<T, E, R>
  | QueueResourceConfigWithItemSchema<T, E, R>;

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

const queueResourceKind = "queue" as const;

type EnqueueErrOf<C> = C extends QueueResourceConfigWithItemSchema<infer _T, infer _E, infer _R>
  ? QueueEnqueueErrors
  : never;

/**
 * Enqueue error channel for a queue configuration (never when no `itemSchema`).
 *
 * @public
 */
export type InferQueueEnqueueError<C> = EnqueueErrOf<C>;

/**
 * Infer item type **`T`** from an inline `{ effect: (item, ctx) => … }` config.
 *
 * @remarks
 * **`effect`** parameter positions use **`any`** in the constraint so TypeScript accepts
 * the concrete **`ctx`** (`EffectContext` / **`HandlerContext`**) without pretending it is **`unknown`**.
 *
 * @public
 */
export type InferQueueItem<
  C extends { readonly effect: (...args: any[]) => unknown },
> = Parameters<C["effect"]>[0];

/**
 * Infer worker **`E`** (failure channel) from `effect`'s **`Effect`** return type.
 *
 * @public
 */
export type InferQueueWorkerError<
  C extends { readonly effect: (...args: any[]) => Effect.Effect<void, any, any> },
> = Effect.Error<ReturnType<C["effect"]>>;

type InferOptionalHandlerRequirements<C> = [C] extends [{
  readonly handler: infer HF;
}]
  ? HF extends (...args: any) => Effect.Effect<any, infer _Eh, infer HReq>
    ? HReq
    : never
  : never;

/**
 * Union of service requirements declared on the worker **`effect`** and optional **`handler`**.
 *
 * @public
 */
export type InferQueueWorkerRequirements<
  C extends { readonly effect: (...args: any[]) => Effect.Effect<void, any, any> },
> = InferOptionalHandlerRequirements<C> | Effect.Services<ReturnType<C["effect"]>>;


const hasItemSchema = <T, E, R>(
  config: QueueResourceConfig<T, E, R>,
): config is QueueResourceConfigWithItemSchema<T, E, R> => config.itemSchema !== undefined;

/**
 * Runtime callbacks and hooks for {@link makeQueueRuntime}, parameterized by the
 * enqueue error channel carried on public/hook enqueue helpers.
 *
 * @internal
 */
type QueueRuntimeConfig<T, E, EEnqueue, R> = QueueResourceConfigBase<T, E, R> & {
  readonly effect: (item: T, ctx: EffectContext<T, EEnqueue, R>) => Effect.Effect<void, E, R>;
  readonly handler?: (
    item: T,
    exit: Exit.Exit<void, E>,
    ctx: HandlerContext<T, EEnqueue, R>,
  ) => Effect.Effect<void, any, R>;
  readonly refill?: (queue: QueueHandle<T, E, EEnqueue, R>) => Effect.Effect<void, never, R>;
};

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
 * - Optional deferred fork via {@link QueueResourceConfigBase.autoStart}: when `false`,
 *   call {@link QueueHandleApi.start} to fork workers (and the refill fiber when configured).
 * - Optional {@link QueueHandleApi.refill} invokes {@link QueueResourceConfigBase.refill} manually;
 *   automatic refill waits on a dedicated wake until queues drain empty after processed work (not cold-start empty).
 * - Worker wake (`takeNext`): enqueue / shutdown — avoids priority inversion vs racing priority queues.
 * - Refill wake: drain-to-empty after an item completes (or after {@link QueueHandleApi.clear}) — independent of idle worker waits.
 * - `Latch` gates worker entry (pause/resume)
 * - `Semaphore` for concurrency control within the worker pool
 * - Handler effects are forked into a separate `FiberSet` (never block workers)
 */
const validateItemsWithSchema = <T>(
  queueName: string,
  itemSchema: Schema.Decoder<T, never>,
  codecId: string,
  items: ReadonlyArray<T>,
  operation: "add" | "prioritize" | "defer",
): Effect.Effect<ReadonlyArray<T>, QueueEnqueueErrors> => {
  const decodeItem = Schema.decodeUnknownExit(itemSchema);
  if (items.length === 1) {
    const input = items[0];
    const exit = decodeItem(input);
    return Exit.match(exit, {
      onSuccess: (value) => Effect.succeed([value]),
      onFailure: (cause) =>
        Effect.fail(
          new QueueItemValidationError({
            queue: queueName,
            operation,
            input,
            message: Cause.pretty(cause),
            codecId,
          }),
        ),
    });
  }
  return Effect.gen(function* () {
    const decoded: T[] = [];
    const failures: Array<{
      readonly index: number;
      readonly input: unknown;
      readonly message: string;
    }> = [];
    for (let i = 0; i < items.length; i++) {
      const input = items[i];
      const exit = decodeItem(input);
      if (Exit.isSuccess(exit)) {
        decoded.push(exit.value);
      } else {
        failures.push({
          index: i,
          input,
          message: Cause.pretty(exit.cause),
        });
      }
    }
    if (failures.length > 0) {
      return yield* Effect.failCause(
        Cause.fail(
          new QueueBatchValidationError({
            queue: queueName,
            operation,
            mode: "atomic",
            failures,
            codecId,
          }),
        ),
      );
    }
    return decoded;
  });
};

type MakeQueueEffectResult<C extends QueueResourceConfig<any, any, any>> = QueueHandle<
  InferQueueItem<C>,
  InferQueueWorkerError<C>,
  C extends QueueResourceConfigWithItemSchema<any, any, any> ? QueueEnqueueErrors : never,
  InferQueueWorkerRequirements<C>
>;

const makeQueueEffectWithoutSchema = <
  const C extends QueueResourceConfigWithoutItemSchema<any, any, any>,
>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  QueueHandle<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    never,
    InferQueueWorkerRequirements<C>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
> =>
  makeQueueRuntime(
    config,
    (items, _operation) => Effect.succeed(items),
  );

const makeQueueEffectWithSchema = <
  const C extends QueueResourceConfigWithItemSchema<any, any, any>,
>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  QueueHandle<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    QueueEnqueueErrors,
    InferQueueWorkerRequirements<C>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
> => {
  const queueName = config.name ?? "anonymous";
  const codecId = `${queueName}/item@v1`;
  return makeQueueRuntime<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    QueueEnqueueErrors,
    InferQueueWorkerRequirements<C>
  >(config, (items, operation) =>
    validateItemsWithSchema(queueName, config.itemSchema, codecId, items, operation),
  );
};

function makeQueueEffect<const C extends QueueResourceConfig<any, any, any>>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  MakeQueueEffectResult<C>,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
>;

/** @internal widening — public typing comes from the `const C` overload above */
function makeQueueEffect(
  config: QueueResourceConfig<any, any, any>,
): Effect.Effect<
  QueueHandle<unknown, unknown, unknown, unknown>,
  never,
  Scope.Scope | unknown
> {
  return hasItemSchema(config)
    ? makeQueueEffectWithSchema(config)
    : makeQueueEffectWithoutSchema(config);
}

type ValidateForEnqueue<T, EEnqueue> = (
  items: ReadonlyArray<T>,
  operation: "add" | "prioritize" | "defer",
) => Effect.Effect<ReadonlyArray<T>, EEnqueue>;

const makeQueueRuntime = <T, E, EEnqueue, R>(
  config: QueueRuntimeConfig<T, E, EEnqueue, R>,
  validateForEnqueue: ValidateForEnqueue<T, EEnqueue>,
): Effect.Effect<QueueHandle<T, E, EEnqueue, R>, never, Scope.Scope | R> =>
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

    // Worker wake: enqueue / shutdown unblock `takeNext` waiters on empty queues.
    let workerWakeSignal = yield* Deferred.make<void>();
    // Refill wake: distinct so idle workers never pulse the refill monitor (they share no Deferred with workers).
    let refillWakeSignal = yield* Deferred.make<void>();

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

    // ─── Internal: wake signals (workers vs refill monitor) ───

    /** Complete the current worker wake signal and allocate a fresh one. */
    const signalWorkerWake = Effect.gen(function* () {
      yield* Deferred.succeed(workerWakeSignal, undefined);
      workerWakeSignal = yield* Deferred.make<void>();
    });

    /** Complete the current refill wake signal and allocate a fresh one. */
    const signalRefillWake = Effect.gen(function* () {
      yield* Deferred.succeed(refillWakeSignal, undefined);
      refillWakeSignal = yield* Deferred.make<void>();
    });

    /** Shutdown must unblock both `takeNext` waiters and the refill fiber. */
    const signalShutdownWake = Effect.gen(function* () {
      yield* signalWorkerWake;
      yield* signalRefillWake;
    });

    /** Wake refill monitor when all priority queues are empty (after work drains). */
    const wakeRefillIfAllQueuesEmpty = Effect.gen(function* () {
      const h = yield* Queue.size(highQueue);
      const n = yield* Queue.size(normalQueue);
      const l = yield* Queue.size(lowQueue);
      if (Math.max(0, h) + Math.max(0, n) + Math.max(0, l) === 0) {
        yield* signalRefillWake;
      }
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
     * 4. Wake sleeping workers (`takeNext` waiters)
     * 5. Fire hooks (onEnqueue, persist)
     */
    const enqueueInternal = (
      items: ReadonlyArray<T>,
      priority: Priority,
      retries = 0,
      enqueuedAt?: number,
    ): Effect.Effect<void, never, R> =>
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
        yield* signalWorkerWake;

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

    /** Public enqueue: validate (when configured), then delegate to internal. */
    const enqueuePublic = (
      items: T | ReadonlyArray<T>,
      priority: Priority,
      operation: "add" | "prioritize" | "defer",
    ) =>
      Effect.flatMap(validateForEnqueue(normalizeEnqueueInput(items), operation), (validated) =>
        enqueueInternal(validated, priority),
      );

    // ─── Internal: EffectContext (guarded) ───

    /**
     * Build the guarded context passed to the user's `effect` callback.
     * Self-enqueue detection uses reference equality and (if configured) key equality.
     */
    const makeEffectContext = (internal: InternalItem<T>): EffectContext<T, EEnqueue, R> => {
      const isSameItem = (candidate: T): boolean => {
        if (candidate === internal.item) return true;
        if (config.key !== undefined && internal.key !== undefined && config.key(candidate) === internal.key)
          return true;
        return false;
      };

      const guardedEnqueue = (
        candidates: T | ReadonlyArray<T>,
        priority: Priority,
        operation: "add" | "prioritize" | "defer",
      ) =>
        Effect.gen(function* () {
          const items = normalizeEnqueueInput(candidates);
          const safe = items.filter((c) => !isSameItem(c));
          if (safe.length < items.length) {
            yield* Effect.logWarning(
              `Self-enqueue detected in queue "${queueName}", item(s) dropped`,
            );
          }
          if (safe.length > 0) {
            const validated = yield* validateForEnqueue(safe, operation);
            yield* enqueueInternal(validated, priority);
          }
        });

      return {
        add: (items) => guardedEnqueue(items, "normal", "add"),
        prioritize: (items) => guardedEnqueue(items, "high", "prioritize"),
        defer: (items) => guardedEnqueue(items, "low", "defer"),
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
      exit: Exit.Exit<void, E>,
    ): HandlerContext<T, EEnqueue, R> => ({
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
      add: (items) => enqueuePublic(items, "normal", "add"),
      prioritize: (items) => enqueuePublic(items, "high", "prioritize"),
      defer: (items) => enqueuePublic(items, "low", "defer"),
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

      // All empty — wait for enqueue/shutdown wake then re-poll in priority order
      yield* Deferred.await(workerWakeSignal);
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
    const processItem = (internal: InternalItem<T>): Effect.Effect<void, never, R> =>
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

          yield* wakeRefillIfAllQueuesEmpty;
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
    const workerLoop = (workerId: number): Effect.Effect<void, never, R> =>
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

    const autoStart = config.autoStart ?? true;
    const workersStartedRef = yield* Ref.make(false);
    /** Set synchronously before `forkProcessingFibers` first runs (autoStart or manual `start`). */
    const queueHandleSlot: { current?: QueueHandle<T, E, EEnqueue, R> } = {};

    const forkProcessingFibers = Effect.gen(function* () {
      if (yield* Ref.get(isShutdownRef)) {
        yield* Effect.logWarning(
          `Queue "${queueName}" start ignored: queue already shut down`,
        );
        return;
      }

      const claimed = yield* Ref.modify(workersStartedRef, (started) =>
        started ? ([false, started] as const) : ([true, true] as const));

      if (!claimed) return;

      for (let i = 0; i < concurrency; i++) {
        yield* FiberSet.run(workerFibers)(workerLoop(i));
      }

      yield* recordLifecycleEvent("Started");
      yield* Effect.logDebug(
        `Queue "${queueName}" worker pool started (${String(concurrency)} workers)`,
      );

      if (config.refill !== undefined) {
        const refillFn = config.refill;
        const handle = queueHandleSlot.current;
        if (handle === undefined) {
          return yield* Effect.die(
            new Error(`Queue "${queueName}" internal error: handle not wired before refill fork`),
          );
        }

        yield* FiberSet.run(workerFibers)(
          Effect.forever(
            Effect.gen(function* () {
              yield* Deferred.await(refillWakeSignal);

              const shutdown = yield* Ref.get(isShutdownRef);
              if (shutdown) return yield* Effect.interrupt;

              const empty = yield* handle.isEmpty;
              if (empty) {
                yield* Effect.logDebug(`Queue "${queueName}" empty, triggering refill`);
                yield* refillFn(handle).pipe(Effect.ignore);
                if (config.onEmpty !== undefined) {
                  yield* config.onEmpty.pipe(Effect.ignore);
                }
              }
            }),
          ),
        );
      }
    });

    // ─── Build public handle ───

    const queueHandle: QueueHandle<T, E, EEnqueue, R> = {
      // Enqueue delegates — priority is the only difference
      add: (items: T | ReadonlyArray<T>) => enqueuePublic(items, "normal", "add"),
      prioritize: (items: T | ReadonlyArray<T>) => enqueuePublic(items, "high", "prioritize"),
      defer: (items: T | ReadonlyArray<T>) => enqueuePublic(items, "low", "defer"),

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

      start: forkProcessingFibers.pipe(Effect.asVoid),

      refill: Effect.gen(function* () {
        const fn = config.refill;
        if (fn === undefined) {
          yield* Effect.logWarning(
            `Queue "${queueName}" refill() ignored: no refill callback configured`,
          );
          return;
        }
        if (yield* Ref.get(isShutdownRef)) {
          yield* Effect.logWarning(`Queue "${queueName}" refill() ignored after shutdown`);
          return;
        }
        const handle = queueHandleSlot.current;
        if (handle === undefined) {
          return yield* Effect.die(
            new Error(`Queue "${queueName}" internal error: handle not wired before refill()`),
          );
        }
        yield* Effect.logDebug(`Queue "${queueName}" manual refill`);
        yield* fn(handle).pipe(Effect.ignore);
      }),

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
        Effect.andThen(signalShutdownWake),
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
        yield* wakeRefillIfAllQueuesEmpty;
        return count;
      }),
    };

    queueHandleSlot.current = queueHandle;

    if (autoStart) {
      yield* forkProcessingFibers;
    }

    return queueHandle;
  });

// ============================================================================
// Public API
// ============================================================================

function queueResourceLayer<Self, T, E, R>(
  tag: Context.Key<Self, QueueHandle<T, E, never, R>>,
  config: QueueResourceConfigWithoutItemSchema<T, E, R>,
): Layer.Layer<Self, never, R>;
function queueResourceLayer<Self, T, E, R>(
  tag: Context.Key<Self, QueueHandle<T, E, QueueEnqueueErrors, R>>,
  config: QueueResourceConfigWithItemSchema<T, E, R>,
): Layer.Layer<Self, never, R>;
function queueResourceLayer<Self, T, E, R>(
  tag: Context.Key<Self, QueueHandle<T, E, never | QueueEnqueueErrors, R>>,
  config: QueueResourceConfig<T, E, R>,
): Layer.Layer<Self, never, R> {
  return hasItemSchema(config)
    ? Layer.effect(tag)(makeQueueEffectWithSchema(config))
    : Layer.effect(tag)(makeQueueEffectWithoutSchema(config));
}

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
  layer: queueResourceLayer,

  /**
   * Class factory: creates a Context tag with a baked-in `.layer`.
   *
   * The returned value is both a `Context.Service` (yieldable tag) and has
   * a `.layer` property for providing the queue to your program.
   *
   * When `itemSchema` is set, the declaration also exposes {@link QueueResourceDefinition.item}
   * for typed {@link ProcessGroup} contracts.
   *
   * @example
   * ```ts
   * const EmailQueue = QueueResource.Service<typeof EmailQueue, Email, SmtpError, HttpClient.HttpClient>()(
   *   "@app/EmailQueue",
   *   { effect: (email) => sendEmail(email).pipe(Effect.asVoid), concurrency: 5 },
   * )
   *
   * // Use:
   * const queue = yield* EmailQueue
   * Effect.provide(EmailQueue.layer)
   * ```
   */
  Service: <Self, T, E = never, R = never>() => {
    function queueResourceService<const Name extends string>(
      name: Name,
      config: QueueResourceConfigWithoutItemSchema<T, E, R>,
    ): QueueResourceServiceDefinition<Self, Name, T, E, never, R>;
    function queueResourceService<const Name extends string>(
      name: Name,
      config: QueueResourceConfigWithItemSchema<T, E, R>,
    ): QueueResourceServiceDefinition<Self, Name, T, E, QueueEnqueueErrors, R>;
    function queueResourceService<const Name extends string>(
      name: Name,
      config: QueueResourceConfig<T, E, R>,
    ):
      | QueueResourceServiceDefinition<Self, Name, T, E, never, R>
      | QueueResourceServiceDefinition<Self, Name, T, E, QueueEnqueueErrors, R> {
      if (hasItemSchema(config)) {
        const named = { ...config, name } satisfies QueueResourceConfigWithItemSchema<T, E, R>;
        const base = Context.Service<Self, QueueHandle<T, E, QueueEnqueueErrors, R>>()(name);
        const item = makeQueueItemCodecDescriptor(name, config.itemSchema);
        return Object.assign(base, {
          id: name,
          kind: queueResourceKind,
          tag: base,
          layer: queueResourceLayer(base, named),
          item,
        });
      }
      const named = { ...config, name } satisfies QueueResourceConfigWithoutItemSchema<T, E, R>;
      const base = Context.Service<Self, QueueHandle<T, E, never, R>>()(name);
      return Object.assign(base, {
        id: name,
        kind: queueResourceKind,
        tag: base,
        layer: queueResourceLayer(base, named),
      });
    }
    return queueResourceService;
  },

  /**
   * Class factory: creates a pure identity Context tag (no default layer).
   *
   * Use with {@link QueueResource.layer} to provide implementations.
   * Useful for shared contracts, library interfaces, and dependency inversion.
   *
   * @example
   * ```ts
   * class JobQueue extends QueueResource.Tag<JobQueue, Job, JobError, never>()("@app/JobQueue") {}
   *
   * // Provide implementation separately:
   * const JobQueueLive = QueueResource.layer(JobQueue, { ... })
   * ```
   */
  Tag: <Self, T, E = never, R = never>() =>
  <const Name extends string>(name: Name) => {
    const base = Context.Service<Self, QueueHandle<T, E, never, R>>()(name);
    return Object.assign(base, {
      id: name,
      kind: queueResourceKind,
      tag: base,
    });
  },
};
