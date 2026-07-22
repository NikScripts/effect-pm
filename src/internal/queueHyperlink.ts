/**
 * WorkPool — Effect-idiomatic managed priority queue with workers.
 *
 * Provides a three-level priority queue (high, normal, low) backed by bounded
 * Effect `Queue`s with configurable concurrency, optional start-gap throttling,
 * deduplication, and automatic re-enqueue retry (`attempts`). Workers are managed
 * fibers tracked by `FiberSet`; pause/resume is implemented via `Latch`; empty-queue
 * blocking uses a `Deferred` wake signal to avoid priority inversion.
 *
 * **Observability is via streams and reactive refs, not callbacks.** Every handle exposes
 * {@link QueueHandleApi.events} (discrete {@link QueueEvent}s), {@link QueueHandleApi.status}
 * (a `Subscribable` ref: `.get` for one-shot, `.changes` for live), and
 * {@link QueueHandleApi.metrics} (windowed stream). Subscribe with `Stream.runForEach` /
 * `Hyperlink.runForEachTag`; failures arrive typed on the `Failed`/`Exit`
 * events (`e.exit.pipe(Effect.catchTag(...))`). Retry is the `attempts` policy — for in-place
 * effect retry, put `Effect.retry` on your `effect`. For per-error disposition (retry vs
 * dead-letter vs drop), set the inline {@link QueueOnFailure | onFailure} control hook.
 *
 * **OTEL.** Beyond the observation streams, the engine registers Effect `Metric`s (per-queue
 * tagged `queue_*_total` counters, a `queue_in_flight` gauge, and a
 * `queue_processing_duration_ms` histogram) so a metric reader exports them to OpenTelemetry.
 *
 * ## Entry points
 *
 * | Function | Purpose |
 * |----------|---------|
 * | `WorkPool.make` | Scoped Effect producing a {@link QueueHandle} |
 * | `WorkPool.layer` | Builds a `Layer` from tag + config |
 * | `WorkPool.Service` | Class factory: tag + baked-in `.layer` |
 * | `WorkPool.Tag` | Class factory: pure identity tag (no layer) |
 *
 * ## Usage
 *
 * ```ts
 * import { Effect, Stream } from "effect"
 * import { WorkPool, Hyperlink } from "hyperlink-ts"
 *
 * // Declare service via class factory
 * const EmailQueue = WorkPool.Service<typeof EmailQueue, Email, SmtpError>()(
 *   "@app/EmailQueue",
 *   {
 *     effect: (email, ctx) => sendEmail(email).pipe(Effect.asVoid),
 *     concurrency: 5,
 *     attempts: 3, // auto re-enqueue failed items up to 3 attempts
 *   },
 * )
 *
 * // Use in program; observe lifecycle off the events stream
 * const program = Effect.gen(function*() {
 *   const queue = yield* EmailQueue
 *   yield* queue.events.pipe(
 *     Hyperlink.runForEachTag({
 *       Failed: ({ entry, cause }) => Effect.logError(`failed ${entry.entryId}`, cause),
 *     }),
 *     Effect.forkScoped,
 *   )
 *   yield* queue.add([email1, email2])
 * })
 *
 * program.pipe(Effect.provide(EmailQueue.layer))
 * ```
 *
 * @module internal/queueHyperlink
 * @internal
 */

import type { JsonSchema } from "effect";
import {
  Cause,
  Context,
  Data,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberSet,
  HashSet,
  Latch,
  Layer,
  Metric,
  Option,
  PubSub,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
  Types,
} from "effect";
import {
  RateLimiter as RateLimiterTag,
  RateLimiterError,
  RateLimitExceeded,
  type ConsumeResult,
  layer as rateLimiterLayer,
  layerStoreMemory,
} from "effect/unstable/persistence/RateLimiter";
import type { RateLimiter as EffectRateLimiter } from "effect/unstable/persistence/RateLimiter";
import { withLogScope } from "./logs/scope";
import { isJsonValue } from "./json";
import type { JsonValue } from "./json";
import { DurableQueueStore } from "../DurableQueueStore";
import type { LaneStore } from "./laneStore";
import { laneStoreFactoryFromConfig } from "./laneStoreFactory";
import { levelToDefaultPriority } from "./priorityMapping";
import {
  defaultQueueProjection,
  type QueueRuntimeProjection,
} from "./queueProjection";
import type {
  BuiltInTakeAlgorithm as BuiltInTakeAlgorithmInternal,
  CustomTakeAlgorithm as CustomTakeAlgorithmInternal,
  TakeAlgorithm as TakeAlgorithmInternal,
  TakeAlgorithmPick as TakeAlgorithmPickInternal,
  TakeAlgorithmPickContext as TakeAlgorithmPickContextInternal,
} from "./takeAlgorithm";
import type {
  DurableEntry,
  OfferResult,
} from "../DurableQueueStore";
import * as Hyperlink from "../Hyperlink";
import {
  configureLayer,
  configureWrapEffectField,
  foldConfiguredSpec,
  type ConfigPatch,
} from "../HyperlinkConfigure";
// Wire/error schemas live in a light module (effect-only) so the contract's Tag/spec is engine-free.
import {
  QueueItemCodecDescriptorSchema,
  QueueItemEncodingError,
  QueueMissingItemSchemaError,
} from "./queueSchema";
// Re-export for back-compat (consumers import these from the public WorkPool namespace / the barrel).
export {
  QueueItemCodecDescriptorSchema,
  QueueItemEncodingError,
  QueueMissingItemSchemaError,
} from "./queueSchema";

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
 * @category models
 * @public
 */
export type Priority = "high" | "normal" | "low";

/**
 * Built-in lane take algorithms for {@link WorkPoolConfigBase.takeAlgorithm}.
 *
 * - `"priority"` — lowest level index first (default; classic high → normal → low on 3 levels).
 * - `"strict-descending"` — highest level index first (can starve lower levels).
 * - `"weighted"` — virtual-time weighted fair queuing; level index is the weight (≥ 1).
 *
 * @category models
 * @public
 */
export type BuiltInTakeAlgorithm = BuiltInTakeAlgorithmInternal;

/**
 * Context passed to a {@link CustomTakeAlgorithm} on each non-blocking take.
 *
 * @category models
 * @public
 */
export type TakeAlgorithmPickContext = TakeAlgorithmPickContextInternal;

/**
 * Result of a custom take pick — which level to dequeue from and updated scheduler state.
 *
 * @category models
 * @public
 */
export type TakeAlgorithmPick = TakeAlgorithmPickInternal;

/**
 * User-supplied take algorithm. Return `undefined` when nothing should be taken (empty).
 *
 * @example
 * ```ts
 * const takeAlgorithm: CustomTakeAlgorithm = ({ nonEmpty, state }) => {
 *   const idx = typeof state === "number" ? state : 0;
 *   const pick = nonEmpty[idx % nonEmpty.length];
 *   return pick === undefined
 *     ? undefined
 *     : { level: pick.level, nextState: idx + 1 };
 * };
 * ```
 *
 * @category models
 * @public
 */
export type CustomTakeAlgorithm = CustomTakeAlgorithmInternal;

/**
 * Lane take algorithm: a built-in name or a custom pick function.
 *
 * @category models
 * @public
 */
export type TakeAlgorithm = TakeAlgorithmInternal;

/**
 * JSON-safe metadata for queue item wire encoding and typed group contracts.
 *
 * @category models
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
 * Annotation key carrying an item schema's **version** — the anchor for the `@vN` marker that
 * travels on released / handoff entries and the future upcast/migration history.
 *
 * @category item codecs
 * @public
 */
export const schemaVersionAnnotation = "schemaVersion";

/**
 * Stamp an item schema with its version. Bump it on any **breaking** change to the item shape;
 * evolve **additively** within a version (so a newer receiver still accepts same-version entries
 * from an older sender). The version flows into {@link makeQueueItemCodecDescriptor}'s `id`
 * (`…/item@vN`) and `version`, making every released/handoff entry self-describing.
 *
 * @category item codecs
 * @public
 */
export const withSchemaVersion = <S extends Schema.Top>(
  schema: S,
  version: number,
): S["Rebuild"] => schema.annotate({ schemaVersion: version });

/**
 * Read an item schema's {@link withSchemaVersion | version}; defaults to `1` when unannotated.
 *
 * @category item codecs
 * @public
 */
export const schemaVersionOf = (schema: Schema.Top): number => {
  const annotated = Schema.resolveAnnotations(schema)?.[schemaVersionAnnotation];
  return typeof annotated === "number" ? annotated : 1;
};

/**
 * Build a {@link QueueItemCodecDescriptor} from a live Effect `Schema` value. The descriptor's
 * `id` (`…/item@vN`) and `version` are taken from the schema's {@link withSchemaVersion} stamp
 * (default `1`), so the descriptor self-describes the schema version for handoff / drift checks.
 *
 * @category item codecs
 * @public
 */
export const makeQueueItemCodecDescriptor = <T>(
  key: string,
  itemSchema: Schema.Codec<T, unknown, never, never>,
  options?: { readonly version?: string },
): QueueItemCodecDescriptor => {
  const version = schemaVersionOf(itemSchema);
  const wrapped = Schema.toStandardJSONSchemaV1(itemSchema);
  const jsonSchema = wrapped["~standard"].jsonSchema.input({ target: "draft-07" });
  return {
    id: `${key}/item@v${String(version)}`,
    version: options?.version ?? String(version),
    encoding: "json",
    jsonSchema,
  };
};

/**
 * Single-item enqueue failed schema validation before the queue mutated.
 *
 * @category errors
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
 * @category errors
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
 *
 * @category models
 * @public
 */
export type QueueReleaseEncodingError = QueueMissingItemSchemaError | QueueItemEncodingError;

/**
 * Enqueue a single item or a readonly batch of items.
 *
 * @typeParam E - Validation errors when {@link WorkPoolConfig.itemSchema} is set
 * @typeParam R - Dependencies needed to encode items (schema requirements) when called from the ambient program
 *
 * @category models
 * @public
 */
export interface QueueEnqueue<T, E = never, R = never> {
  (item: T): Effect.Effect<void, E, R>;
  (items: ReadonlyArray<T>): Effect.Effect<void, E, R>;
  // Union overload: lets a `T | ReadonlyArray<T>` argument resolve directly (the engine impl already
  // accepts the union), so callers holding the decoded union don't need an `Array.isArray` narrowing.
  (itemOrItems: T | ReadonlyArray<T>): Effect.Effect<void, E, R>;
}

/**
 * Re-inject existing {@link QueueEntry}s (single or array) — the inverse of `release`, and the
 * input you get straight off the {@link QueueHandleApi.events} stream. Unlike {@link QueueEnqueue}
 * (raw items `T`, you pick the priority), each entry re-enters at **its own** `priority` with its
 * **`attempts`** count preserved (so a job mid-retry keeps its budget). For handoff / event
 * round-trips: `yield* queue.enqueue(event.entries)`.
 *
 * @category models
 * @public
 */
export interface QueueEnqueueEntries<T, R = never> {
  (entry: QueueEntry<T>): Effect.Effect<void, never, R>;
  (entries: ReadonlyArray<QueueEntry<T>>): Effect.Effect<void, never, R>;
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
 * @typeParam EEnqueue - Errors from schema-backed enqueue validation (see {@link WorkPoolConfig.itemSchema})
 * @typeParam R - Dependencies required while running the worker `effect` and the enqueue helpers
 *
 * @example
 * ```ts
 * const queue = yield* MyQueue
 * yield* queue.add(item1)
 * yield* queue.add([item2, item3])
 * yield* queue.prioritize(urgentItem)
 * const pending = yield* queue.size.get
 * yield* queue.pause
 * ```
 *
 * @public
 */
export interface QueueHandleApi<
  in out T,
  E = never,
  EEnqueue = never,
  R = never,
  A = void,
> {
  /** Enqueue items at **normal** priority. */
  readonly add: QueueEnqueue<T, EEnqueue, R>;
  /** Enqueue items at **high** priority (processed before normal and low). */
  readonly prioritize: QueueEnqueue<T, EEnqueue, R>;
  /** Enqueue items at **low** priority (processed after high and normal). */
  readonly defer: QueueEnqueue<T, EEnqueue, R>;

  /**
   * Re-inject existing {@link QueueEntry}s (e.g. straight off {@link events}, or from
   * `release`), each at its own priority with its `attempts` preserved. The event-stream
   * round-trip and the basis for queue handoff.
   */
  readonly enqueue: QueueEnqueueEntries<T, R>;

  /** Total pending items across all priority levels. */
  readonly size: Hyperlink.Subscribable<number>;
  /** Pending item count per priority level. */
  readonly sizes: Effect.Effect<{
    readonly high: number;
    readonly normal: number;
    readonly low: number;
  }>;
  /** Whether all priority queues are empty. */
  readonly isEmpty: Hyperlink.Subscribable<boolean>;
  /** Total items that have finished processing (success or failure). */
  readonly completed: Effect.Effect<number>;

  /**
   * Live **lifecycle events** — a fan-out stream of discrete {@link QueueEvent}s (entry /
   * worker / queue). Each consumer gets its own subscription; backed by a sliding buffer, so a
   * slow subscriber never backpressures the worker (lossy under load — enable a durable store
   * for guaranteed delivery). Subscribe for dashboards / CLI `--watch` / a TUI.
   */
  readonly events: Stream.Stream<QueueEvent<T, E, A>>;

  /**
   * Live **current-state snapshot** — a reactive `ref` backed by a `SubscriptionRef`. Read once via
   * {@link Hyperlink.Subscribable.get `.get`} (recomputed from authoritative sources) or subscribe via
   * {@link Hyperlink.Subscribable.changes `.changes`} (dashboards / `--watch` / TUI). Each change
   * snapshot is accurate truth (not an event accumulation); a new subscriber gets the current value
   * immediately.
   */
  readonly status: Hyperlink.Subscribable<QueueStatus>;

  /**
   * Live **windowed metrics** stream — one {@link QueueMetrics} per window. Windows are
   * **dynamic**: a max duration bounds staleness, but a window flushes early on a significant
   * event (release/drain/clear/dead-letter/drop/shutdown), with a small floor coalescing
   * bursts. Counts are accumulated inline at the source (accurate, never undercounts under
   * load); `windowMillis` is the actual elapsed window. The UI-facing metrics surface.
   */
  readonly metrics: Stream.Stream<QueueMetrics>;

  /**
   * Fork the worker pool. Idempotent — safe to call multiple times.
   * Only needed when {@link WorkPoolConfigBase.autoStart} was `false`; otherwise workers already started at acquisition.
   *
   * After {@link shutdown}, `start` is a no-op (warning logged).
   */
  readonly start: Effect.Effect<void, never, R>;

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
   * Permanently stop the queue (graceful). Returns immediately after **initiating** shutdown:
   * status `phase` → `"draining"`, new enqueues are rejected (logged + dropped), and once the
   * queue is empty + idle it emits `ShutdownComplete` and `phase` → `"off"`. How already-queued
   * items are handled is set by {@link WorkPoolConfigBase.shutdownMode} (`"drain"` processes
   * them, the default; `"finishActive"` discards them, emitting a `Dropped` event). In-flight
   * items always finish. Idempotent — a second call is a no-op. Emits `ShutdownRequested` /
   * `ShutdownComplete` on the {@link QueueHandleApi.events} stream.
   */
  readonly shutdown: Effect.Effect<void>;
  /**
   * Drain all pending items from all priority queues and reset the completed
   * counter. Returns the number of items cleared. Workers remain alive.
   */
  readonly clear: Effect.Effect<number, never, R>;
  /**
   * Export pending entries for handoff and remove them from this queue.
   *
   * This first release scope is pending-only: in-flight items finish on the
   * source queue.
   */
  readonly release: (options?: QueueReleaseOptions) => Effect.Effect<ReadonlyArray<QueueEntry<T>>, never, R>;
  /**
   * Export pending entries for remote/wire handoff.
   *
   * Requires `itemSchema`; local decoded handoff can use {@link QueueHandleApi.release}.
   */
  readonly releaseEncoded: (options?: QueueReleaseOptions) =>
    Effect.Effect<ReadonlyArray<QueueEncodedEntry>, QueueReleaseEncodingError, R>;
  /** Remove pending entries and route them to a dead-letter path. */
  readonly deadLetter: (
    selector: QueueEntrySelector<T> | QueueEntry<T>,
    options: QueueRouteOptions,
  ) => Effect.Effect<ReadonlyArray<QueueEntry<T>>, never, R>;
  /** Remove pending entries without preserving them for handoff. */
  readonly drop: (
    selector: QueueEntrySelector<T> | QueueEntry<T>,
    options: QueueRouteOptions,
  ) => Effect.Effect<ReadonlyArray<QueueEntry<T>>, never, R>;
}

/**
 * Priority queue surface for `yield*`able queue services (`T`, `E`, enqueue errors `EEnqueue`, requirements `R` last).
 *
 * @public
 */
export type EngineQueueHandle<
  T,
  E = never,
  EEnqueue = never,
  R = never,
  A = void,
> = QueueHandleApi<T, E, EEnqueue, R, A> & QueueHandlePhantomWorkerFailures<E>;

/**
 * TEMP (M1a): keep the public `QueueHandle` name resolving to the engine handle so the rename lands
 * green. M1b replaces this with the canonical contract handle `QueueHandle<Payload, Success, Error,
 * Requirements>` (the named projection of `ServiceOf<QueueInstanceSpec<F>>`). @internal
 */
export type QueueHandle<
  T,
  E = never,
  EEnqueue = never,
  R = never,
  A = void,
> = EngineQueueHandle<T, E, EEnqueue, R, A>;

/**
 * Engine handle — includes custom-queue hooks used by {@link CustomQueueHyperlink}.
 *
 * @internal
 */
export interface QueueEngineHandle<
  T,
  E = never,
  EEnqueue = never,
  R = never,
  A = void,
> extends EngineQueueHandle<T, E, EEnqueue, R, A> {
  /** Enqueue at an explicit lane index (custom queues). */
  readonly enqueueAtLevel: (
    items: T | ReadonlyArray<T>,
    level: number,
  ) => Effect.Effect<void, EEnqueue, R>;
  /** Raw per-lane occupancy (`levelSizes[i]` = count at lane `i`). */
  readonly levelSizes: Effect.Effect<ReadonlyArray<number>, never, R>;
}

/**
 *
 * @category models
 * @public
 */
export interface QueueEntryTimestamps {
  readonly enqueuedAt: DateTime.Utc;
  readonly startedAt?: DateTime.Utc;
  readonly completedAt?: DateTime.Utc;
  readonly interruptedAt?: DateTime.Utc;
}

/**
 *
 * @category models
 * @public
 */
export interface QueueEntry<T> {
  readonly item: T;
  readonly entryId: string;
  readonly key?: string;
  readonly priority: Priority;
  /** Numeric lane index when enqueued on a multi-level (custom) queue. */
  readonly level?: number;
  readonly attempts: number;
  readonly timestamps: QueueEntryTimestamps;
  readonly batchId?: string;
  readonly releaseId?: string;
  readonly sourceHyperlinkId?: string;
  readonly attributes?: { readonly [key: string]: unknown };
}

/**
 *
 * @category models
 * @public
 */
export interface QueueBatch<T> {
  readonly entries: ReadonlyArray<QueueEntry<T>>;
  readonly priority: Priority;
  readonly batchId?: string;
}

/**
 *
 * @category models
 * @public
 */
export interface QueueEncodedEntry {
  readonly payload: JsonValue;
  readonly item: QueueItemCodecDescriptor;
  readonly entryId: string;
  readonly key?: string;
  readonly priority: Priority;
  readonly attempts: number;
  readonly timestamps: QueueEntryTimestamps;
  readonly batchId?: string;
  readonly releaseId?: string;
  readonly sourceHyperlinkId?: string;
  readonly attributes?: { readonly [key: string]: unknown };
}

/**
 *
 * @category models
 * @public
 */
export interface QueueEntrySelector<T> {
  readonly entryId?: string;
  readonly key?: string;
  readonly item?: T;
}

/**
 *
 * @category models
 * @public
 */
export interface QueueReleaseOptions {
  readonly scope?: "pendingOnly";
  readonly releaseId?: string;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

/**
 *
 * @category models
 * @public
 */
export interface QueueRouteOptions {
  readonly reason: string;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

// (The per-event payload interfaces and `QueueControls` that the removed lifecycle callbacks
// used are gone — observe lifecycle via the `events` stream and its {@link QueueEvent} union.)

/**
 * The current-state snapshot — the element of {@link QueueHandleApi.status}. Instantaneous
 * truth (per-priority pending sizes, paused, in-flight, lifetime completed), recomputed from
 * authoritative sources. Mirrors the encodable `queueStatus` contract schema.
 *
 * @category models
 * @public
 */
export interface QueueStatus {
  readonly sizes: {
    readonly high: number;
    readonly normal: number;
    readonly low: number;
  };
  readonly paused: boolean;
  readonly inFlight: number;
  readonly completed: number;
  /**
   * Lifecycle phase — orthogonal to `paused` (a running queue can be paused):
   * - `"running"` — accepting and processing items.
   * - `"draining"` — `shutdown` was called; not accepting new items, winding down in-flight (and,
   *   in `"drain"` mode, the remaining queued items).
   * - `"off"` — fully shut down (empty + idle); the terminal state a UI renders as stopped.
   */
  readonly phase: "running" | "draining" | "off";
}

/**
 * Windowed metrics — the element of {@link QueueHandleApi.metrics}. Per-window counts (deltas)
 * plus the as-of-window-end `inFlight`, throughput, and average latency. Windows are dynamic
 * (variable `windowMillis`). Mirrors the encodable `queueMetrics` contract schema.
 *
 * @category models
 * @public
 */
export interface QueueMetrics {
  readonly windowStart: DateTime.Utc;
  readonly windowEnd: DateTime.Utc;
  readonly windowMillis: number;
  readonly enqueued: number;
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly dropped: number;
  readonly rateLimitExceeded: number;
  readonly inFlight: number;
  readonly throughputPerSec: number;
  /**
   * Average **queue wait** (enqueued → worker pickup) this window, **per priority**, in ms.
   * Per-priority because wait depends on how loaded each priority lane is; a priority is absent
   * when it had no completions this window. (Execution time is ~priority-independent, so it's
   * reported overall, not per priority.)
   */
  readonly avgWaitMillis: {
    readonly high?: number;
    readonly normal?: number;
    readonly low?: number;
  };
  /** Average **worker execution** (pickup → done) this window, ms, overall. Absent if no completions. */
  readonly avgExecutionMillis?: number;
  /** Average **end-to-end** time (enqueued → done = wait + execution) this window, ms, overall. Absent if no completions. */
  readonly avgTotalMillis?: number;
}

/**
 * The live **lifecycle event** union — the element of {@link QueueHandleApi.events}. A discrete
 * fact emitted as the queue runs; subscribe to observe (dashboard / CLI `--watch` / TUI). The
 * worker outcome is recorded **once**: `Completed` carries the typed `success` value (`A`) and
 * `Failed` the typed `Cause<E>`, so a subscriber can `Effect.failCause(e.cause).pipe(
 * Effect.catchTags(...))` on a failure (there is no separate `Exit` event — reconstruct
 * `Exit<A, E>` from the two if needed). `E` defaults to `unknown` and `A` to `void` for the
 * erased / wire form. The non-streamable `retry` affordance the old callbacks received is
 * dropped — a subscriber holds the handle to drive control.
 *
 * @category models
 * @public
 */
export type QueueEvent<T, E = unknown, A = void> =
  | { readonly _tag: "Start"; readonly key: string }
  | {
      readonly _tag: "Enqueued";
      readonly entries: ReadonlyArray<QueueEntry<T>>;
      readonly priority: Priority;
      readonly batchId?: string;
    }
  | { readonly _tag: "Started"; readonly entry: QueueEntry<T> }
  | {
      readonly _tag: "Completed";
      readonly entry: QueueEntry<T>;
      /** The worker's typed success value (the `Exit.value` of a successful run). */
      readonly success: A;
      readonly elapsed: Duration.Duration;
    }
  | {
      readonly _tag: "Failed";
      readonly entry: QueueEntry<T>;
      readonly cause: Cause.Cause<E>;
      readonly elapsed: Duration.Duration;
    }
  | {
      readonly _tag: "RetryScheduled";
      readonly entry: QueueEntry<T>;
      readonly cause: Cause.Cause<E>;
      readonly nextAttempt: number;
    }
  | {
      readonly _tag: "RetryExhausted";
      readonly entry: QueueEntry<T>;
      readonly cause: Cause.Cause<E>;
    }
  | { readonly _tag: "Drained"; readonly key: string; readonly completed: number }
  | { readonly _tag: "Cleared"; readonly key: string; readonly count: number }
  | {
      readonly _tag: "ShutdownRequested";
      readonly key: string;
      /** How the wind-down treats already-queued items (see `shutdownMode`). */
      readonly mode: "drain" | "finishActive";
      /** Items still pending when shutdown was requested. */
      readonly pending: number;
    }
  | {
      readonly _tag: "ShutdownComplete";
      readonly key: string;
      /** Total items completed over the queue's lifetime. */
      readonly completed: number;
    }
  | {
      readonly _tag: "Released";
      readonly key: string;
      readonly releaseId: string;
      readonly entries: ReadonlyArray<QueueEntry<T>>;
    }
  | {
      readonly _tag: "DeadLettered";
      readonly key: string;
      readonly entries: ReadonlyArray<QueueEntry<T>>;
      readonly reason: string;
    }
  | {
      readonly _tag: "Dropped";
      readonly key: string;
      readonly entries: ReadonlyArray<QueueEntry<T>>;
      readonly reason: string;
    }
  | {
      readonly _tag: "RateLimitExceeded";
      readonly key: string;
      readonly entry: QueueEntry<T>;
      readonly limitKey: string;
      readonly algorithm: "fixed-window" | "token-bucket";
      readonly outcome: "delayed" | "rejected";
    };

/**
 * The engine-facing store recorder — Storage-free semantic writes the engine calls at the
 * `publishEvent` sites. Built by toolkit layers from
 * {@link materializeEngineQueueStoreForTag} / {@link materializeEngineQueueStoreForItem}
 * (`Store.effects` + {@link Store.catchWriteErrors} + {@link Store.provideContext}). Each narrow
 * write funnels to the shared `event.append`; `record` is the base append alias for queue-level
 * facts without a narrow write. @internal
 */
export type QueueStoreWriter<T, _E = unknown, _A = void> = import("./store/queueStoreSpec").MaterializedEngineQueueStore<
  Schema.Codec<T, unknown, never, never>
>;

/**
 * Queue declaration metadata for {@link WorkPoolDefinition} and
 * {@link WorkPoolServiceDefinition}.
 *
 * @category models
 * @public
 */
export interface WorkPoolMetadata<
  Id extends string,
  T,
  E = never,
  EEnqueue = never,
  R = never,
> {
  readonly id: Id;
  readonly kind: "queue";
  readonly tag: Context.Service<Id, EngineQueueHandle<T, E, EEnqueue, R>>;
  /**
   * Serializable item codec metadata when {@link WorkPoolConfig.itemSchema}
   * was provided on {@link WorkPool.Service}. Used by typed the process manager
   * contracts for remote discovery and drift checks.
   */
  readonly item?: QueueItemCodecDescriptor;
}

/**
 * Canonical queue declaration.
 *
 * @category models
 * @public
 */
export type WorkPoolDefinition<
  Id extends string,
  T,
  E = never,
  EEnqueue = never,
  R = never,
> = Context.Service<Id, EngineQueueHandle<T, E, EEnqueue, R>> &
  WorkPoolMetadata<Id, T, E, EEnqueue, R>;

/**
 * Class-based queue service declaration from {@link WorkPool.Service}.
 *
 * @category models
 * @public
 */
export interface WorkPoolServiceDefinition<
  Self,
  Id extends string,
  T,
  E = never,
  EEnqueue = never,
  R = never,
> extends Context.ServiceClass<Self, Id, EngineQueueHandle<T, E, EEnqueue, R>>,
    Omit<WorkPoolMetadata<Id, T, E, EEnqueue, R>, "tag"> {
  readonly tag: Context.Key<Self, EngineQueueHandle<T, E, EEnqueue, R>>;
  readonly layer: Layer.Layer<Self, never, R>;
  /** Factory defaults before configure layers (`HyperlinkConfigure` module). */
  readonly defaultSpec: WorkPoolConfig<T, E, R>;
  /**
   * Append a configure patch; merge with {@link layer} before scope acquisition.
   */
  readonly configure: (
    patch: ConfigPatch<WorkPoolConfig<T, E, R>>,
  ) => Layer.Layer<never>;
  /**
   * Patch only the worker `effect`: `fn(previous) => next` (item + {@link EffectContext}).
   */
  readonly wrapWorker: (
    fn: (
      previous: WorkPoolConfig<T, E, R>["effect"],
    ) => WorkPoolConfig<T, E, R>["effect"],
  ) => Layer.Layer<never>;
}

/**
 * Context passed to the `effect` callback during item processing.
 *
 * Provides **guarded** enqueue operations for spawning derived/follow-up work.
 * Attempting to enqueue the same item (by reference or by `key`) logs a warning
 * and silently drops the item to prevent infinite processing loops.
 *
 * For intentional re-processing, fail the worker `effect` (auto re-enqueue applies up to
 * {@link WorkPoolConfigBase.attempts}) or re-inject via `queue.enqueue` off the events stream.
 *
 * @typeParam T - Item type
 *
 * @category models
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
 * Configuration for {@link WorkPool.make}.
 *
 * @typeParam T - Item type
 * @typeParam E - Failure channel surfaced as `Exit` failures from the worker `effect`
 * @typeParam R - Dependencies required while running the worker `effect`
 *
 * @public
 */
/**
 * Effect {@link RateLimiter.consume} options for queue workers, with optional
 * `key` (defaults to queue name) and telemetry controls.
 *
 * @remarks
 * Field names match `effect/unstable/persistence` `RateLimiter` (`window`, not
 * `duration`). New upstream consume fields flow through when Effect adds them.
 *
 * @category models
 * @public
 */
export type WorkPoolRateLimitOptions = Omit<
  Parameters<EffectRateLimiter["consume"]>[0],
  "key"
> & {
  /** Shared limit bucket (default: queue `name` / service id). */
  readonly key?: string;
};

/** @public Re-export of Effect rate-limiter consume metadata. */
export type { ConsumeResult } from "effect/unstable/persistence/RateLimiter";

/**
 * Shared queue configuration fields (see {@link WorkPoolConfig}).
 *
 * @category models
 * @public
 */
export interface WorkPoolConfigBase<T> {
  /** Queue name used for log annotations and error messages. @default "anonymous" */
  readonly name?: string;
  /** Start with processing paused. Call `resume` to begin. @default false */
  readonly paused?: boolean;
  /**
   * When `false`, worker fibers are **not** forked until
   * {@link QueueHandleApi.start} runs. Enqueue still succeeds; items accumulate until workers exist.
   * `pause` / `resume` update the latch before or after `start` — workers observe it once forked.
   *
   * @default true (preserve historic behavior: fork workers as soon as the queue scope acquires).
   */
  readonly autoStart?: boolean;
  /** Max items processing concurrently (worker count). @default 5 */
  readonly concurrency?: number;
  /**
   * Optional Effect `RateLimiter` on item workers (before concurrency semaphore).
   * Omitted = no rate limit (only `concurrency`).
   */
  readonly rateLimit?: WorkPoolRateLimitOptions;
  /** Max items per priority queue (bounded backpressure). @default 50_000 */
  readonly capacity?: number;
  /**
   * Number of priority lanes. The default queue uses 3 (`high`=0, `normal`=1, `low`=2).
   *
   * @default 3
   */
  readonly levelCount?: number;
  /**
   * How workers pick among non-empty lanes when taking the next item. `"priority"` is strict
   * lowest-index-first (the default 3-level behavior). `"weighted"` and `"strict-descending"`
   * apply to all configured levels; a {@link CustomTakeAlgorithm} function is also accepted.
   *
   * @default "priority"
   */
  readonly takeAlgorithm?: TakeAlgorithm;
  /**
   * Extract a deduplication key from each item. When set, items with a key
   * already in-flight (enqueued or processing) are silently dropped.
   * The key is released after the worker `effect` completes.
   */
  readonly key?: (item: T) => string;
  /**
   * Max **attempts** for an item — the initial try plus automatic re-enqueues. On failure the
   * worker re-enqueues the item at its **own priority**, preserving its attempt count, until
   * `attempts` is reached; then it's exhausted (emits a `RetryExhausted` event). Observe the
   * `RetryScheduled` / `RetryExhausted` lifecycle on the {@link QueueHandleApi.events} stream.
   *
   * In-place retry of the worker effect is a separate concern — put `Effect.retry(...)` on your
   * `effect`.
   *
   * @default 1 (try once; no auto re-enqueue)
   */
  readonly attempts?: number;
  /**
   * How {@link QueueHandleApi.shutdown} winds down. Either way it stops accepting new items
   * immediately (status `phase` → `"draining"`), lets in-flight items finish, and once the queue
   * is empty + idle emits `ShutdownComplete` and sets `phase` → `"off"`. They differ on the
   * **already-queued** items:
   * - `"drain"` — process the remaining queued items first (graceful; nothing is lost). **Default.**
   * - `"finishActive"` — discard the queued items (emit a `Dropped` event for them) and only let
   *   the in-flight ones finish (fast stop; with future persistence the discarded items are what a
   *   restart would rebuild).
   *
   * @default "drain"
   */
  readonly shutdownMode?: "drain" | "finishActive";
}

// Durability is **presence-driven**, with no config field: provide a `DurableQueueStore` layer
// and, with an `itemSchema` present, the store becomes the source of truth — enqueue persists, a
// feeder leases work into the workers, completion/failure update the store, a restart recovers
// in-flight work (at-least-once + dedup key). Absence of the layer = the normal ephemeral in-memory
// queue; to keep one queue ephemeral in an app with a durable store, scope the layer so that queue
// doesn't receive it. The dead-letter budget derives from the queue's `attempts` (SSOT);
// lease/poll use engine defaults for now (moving onto the backend layer next).

/**
 * Per-error disposition returned by {@link WorkPoolConfigWithoutItemSchema.onFailure}.
 *
 * - `"retry"` — re-enqueue the item at its own priority, honoring the `attempts` budget
 *   (emits `RetryScheduled`, or `RetryExhausted` once the budget is spent).
 * - `"deadLetter"` — emit a `DeadLettered` event; do **not** re-enqueue.
 * - `"drop"` — emit a `Dropped` event; do **not** re-enqueue.
 * - `"default"` — fall back to the queue's policy (auto re-enqueue when `attempts` is set,
 *   otherwise log a warning).
 *
 * @category models
 * @public
 */
export type QueueFailureDisposition = "retry" | "deadLetter" | "drop" | "default";

/**
 * Optional inline failure hook — the one legitimate control callback (a stream is after-the-fact
 * and can't decide disposition). Runs in the worker `R` on each failed item, returning a
 * {@link QueueFailureDisposition}. Observation still belongs on the `events` stream; this is
 * **control**.
 *
 * @category models
 * @public
 */
export interface QueueOnFailure<T, E, R> {
  (
    entry: QueueEntry<T>,
    cause: Cause.Cause<E>,
  ): Effect.Effect<QueueFailureDisposition, never, R>;
}

/**
 * **Self-refill** — load work into the queue from a source (DB, …) on start and/or whenever it
 * drains empty (a self-feeding queue). `load` receives the queue handle and runs in the worker `R`,
 * **best-effort** (failures are logged, not fatal). This is the toolkit equivalent of the legacy
 * `onStart` / `onDrained` lifecycle hooks — a defining queue *behavior* (a pull source), distinct
 * from after-the-fact observation on the `events` stream.
 *
 * @public
 */
export interface QueueRefill<T, E, EEnqueue, R, A = void> {
  /** Run `load` once when the worker pool starts (bootstrap). @default false */
  readonly onStart?: boolean;
  /** Run `load` each time the queue drains to empty (re-poll the source). @default false */
  readonly onDrained?: boolean;
  /** Load + enqueue work. Handle its own errors (best-effort). */
  readonly load: (queue: EngineQueueHandle<T, E, EEnqueue, R, A>) => Effect.Effect<void, never, R>;
}

/**
 * Queue configuration **without** {@link WorkPoolConfigBase} item schema.
 * Enqueue helpers on {@link QueueHandle} and the {@link EffectContext} do not fail with
 * schema validation errors.
 *
 * @category models
 * @public
 */
export type WorkPoolConfigWithoutItemSchema<T, E, R> = WorkPoolConfigBase<T> & {
  readonly itemSchema?: undefined;
  /**
   * Process each item. Receives a guarded {@link EffectContext} for spawning
   * derived work. The exit of this effect determines success/failure for the item;
   * the success channel is always **`void`**.
   */
  readonly effect: (item: T, ctx: EffectContext<T, never, R>) => Effect.Effect<void, E, R>;
  /** Optional inline per-error disposition. See {@link QueueOnFailure}. */
  readonly onFailure?: QueueOnFailure<T, E, R>;
  /** Optional self-refill from a source on start / drain. See {@link QueueRefill}. */
  readonly refill?: QueueRefill<T, E, never, R>;
};

/**
 * Queue configuration **with** {@link WorkPoolConfigBase} item schema.
 * Public enqueue operations and {@link EffectContext} enqueue helpers can fail with
 * {@link QueueItemValidationError} or {@link QueueBatchValidationError}.
 *
 * @public
 */
/**
 * Enqueue validation errors when {@link WorkPoolConfigWithItemSchema.itemSchema} is set.
 *
 * @public
 */
export type QueueEnqueueErrors = QueueItemValidationError | QueueBatchValidationError;

/**
 * A {@link WorkPool} config that carries an explicit `itemSchema` (typed items over the wire).
 * @category models
 * @public
 */
export type WorkPoolConfigWithItemSchema<T, E, R, A = void> = WorkPoolConfigBase<T> & {
  readonly itemSchema: Schema.Codec<T, unknown, never, never>;
  /**
   * Process each item. The **success channel `A`** is driven by the tag's `success` wire schema
   * (default `void`): with a `success` schema the worker must return `Effect<A, E, R>` and that
   * value rides `Completed.success` / `store.completed`; without one it stays `Effect<void, E, R>`.
   */
  readonly effect: (item: T, ctx: EffectContext<T, QueueEnqueueErrors, R>) => Effect.Effect<A, E, R>;
  /** Optional inline per-error disposition. See {@link QueueOnFailure}. */
  readonly onFailure?: QueueOnFailure<T, E, R>;
  /** Optional self-refill from a source on start / drain. See {@link QueueRefill}. */
  readonly refill?: QueueRefill<T, E, QueueEnqueueErrors, R, A>;
  /**
   * Internal store recorder — the engine records each published event through its narrow, semantic
   * writes ({@link QueueStoreWriter}) at the source (`publishEvent`) so no burst is dropped by a late
   * `Stream.fromPubSub` subscription. Wired by `WorkPool.layer` from the baked-in store. @internal
   */
  readonly store?: QueueStoreWriter<T, E, A>;
};

/**
 * Configuration for {@link WorkPool.make}.
 *
 * @typeParam T - Item type
 * @typeParam E - Worker `effect` failure channel
 * @typeParam R - Dependencies required while running the worker `effect`
 *
 * @category models
 * @public
 */
export type WorkPoolConfig<T, E, R, A = void> =
  | WorkPoolConfigWithoutItemSchema<T, E, R>
  | WorkPoolConfigWithItemSchema<T, E, R, A>;

/**
 * @public Config fields for {@link WorkPool.make} / {@link WorkPool.Service} without `effect`.
 *
 * @category models
 * @public
 */
export type WorkPoolOptionsWithoutItemSchema<T, E, R> = Omit<
  WorkPoolConfigWithoutItemSchema<T, E, R>,
  "effect"
>;

/**
 * @public Config fields when `itemSchema` is set (still omit `effect`).
 *
 * @category models
 * @public
 */
export type WorkPoolOptionsWithItemSchema<T, E, R> = Omit<
  WorkPoolConfigWithItemSchema<T, E, R>,
  "effect"
>;

/**
 * @public Worker body passed as the second argument to queue factories.
 *
 * @category models
 * @public
 */
export type QueueWorkerEffect<T, E, EEnqueue = never, R = never> = (
  item: T,
  ctx: EffectContext<T, EEnqueue, R>,
) => Effect.Effect<void, E, R>;

// ============================================================================
// Errors
// ============================================================================

/**
 * Indicates an enqueue was attempted after the queue was shut down.
 * In practice this is logged as a warning and the items are dropped —
 * this error type exists for programmatic detection in tests/monitoring.
 *
 * @category errors
 * @public
 */
export class QueueShutdownError extends Data.TaggedError(
  "QueueShutdownError",
)<{
  readonly queue: string;
}> {}

// ============================================================================
// Internal Utilities
// ============================================================================

const isReadonlyArray = <A>(input: A | ReadonlyArray<A>): input is ReadonlyArray<A> =>
  Array.isArray(input);

const queueHyperlinkKind = "queue" as const;

type EnqueueErrOf<C> = C extends WorkPoolConfigWithItemSchema<
  infer _T,
  infer _E,
  infer _R,
  infer _A
>
  ? QueueEnqueueErrors
  : never;

/**
 * Enqueue error channel for a queue configuration (never when no `itemSchema`).
 *
 * @category models
 * @public
 */
export type InferQueueEnqueueError<C> = EnqueueErrOf<C>;

/**
 * Infer item type **`T`** from an inline `{ effect: (item, ctx) => … }` config.
 *
 * @remarks
 * **`effect`** parameter positions use **`any`** in the constraint so TypeScript accepts
 * the concrete **`ctx`** (`EffectContext`) without pretending it is **`unknown`**.
 *
 * @category models
 * @public
 */
export type InferQueueItem<
  C extends { readonly effect: (...args: any[]) => unknown },
> = Parameters<C["effect"]>[0];

/**
 * Infer worker **`E`** (failure channel) from `effect`'s **`Effect`** return type.
 *
 * @category models
 * @public
 */
export type InferQueueWorkerError<
  C extends { readonly effect: (...args: any[]) => Effect.Effect<any, any, any> },
> = Effect.Error<ReturnType<C["effect"]>>;

/**
 * Infer worker **`A`** (success channel) from `effect`'s **`Effect`** return type — the value that
 * rides `Completed.success` / `store.completed`. `void` when the worker returns `Effect<void, …>`.
 *
 * @public
 */
export type InferQueueWorkerSuccess<
  C extends { readonly effect: (...args: any[]) => Effect.Effect<any, any, any> },
> = Effect.Success<ReturnType<C["effect"]>>;

type NormalizeQueueRequirements<R> = unknown extends R
  ? [R] extends [unknown]
    ? never
    : R
  : R;

/** Requirements contributed by the optional `onFailure` control hook, if present. */
type InferQueueOnFailureRequirements<C> = C extends {
  readonly onFailure: (...args: any[]) => Effect.Effect<any, any, infer R>;
}
  ? R
  : never;

/**
 * Service requirements for the queue worker: those declared on the `effect`, unioned with any
 * declared on the optional `onFailure` control hook. (Observation is via the `events` stream —
 * it contributes no requirements.)
 *
 * @category models
 * @public
 */
export type InferQueueWorkerRequirements<
  C extends { readonly effect: (...args: any[]) => Effect.Effect<any, any, any> },
> = NormalizeQueueRequirements<
  Effect.Services<ReturnType<C["effect"]>> | InferQueueOnFailureRequirements<C>
>;


const hasItemSchema = <T, E, R, A = void>(
  config: WorkPoolConfig<T, E, R, A>,
): config is WorkPoolConfigWithItemSchema<T, E, R, A> => config.itemSchema !== undefined;

/**
 * @public Merged config shape for positional queue factories.
 *
 * @category models
 * @public
 */
export type QueueConfigFromEffect<
  F extends QueueWorkerEffect<any, any, any, any>,
  O extends
    | WorkPoolOptionsWithoutItemSchema<any, any, any>
    | WorkPoolOptionsWithItemSchema<any, any, any>
    | undefined = undefined,
> = { readonly effect: F } & (O extends undefined ? unknown : O);

/**
 * Runtime config for {@link makeQueueRuntime}, parameterized by the
 * enqueue error channel carried on the public/context enqueue helpers.
 *
 * @internal
 */
type QueueRuntimeConfig<T, E, EEnqueue, R, A = void> = WorkPoolConfigBase<T> & {
  readonly effect: (item: T, ctx: EffectContext<T, EEnqueue, R>) => Effect.Effect<A, E, R>;
  readonly onFailure?: QueueOnFailure<T, E, R>;
  readonly refill?: QueueRefill<T, E, EEnqueue, R, A>;
  /** Internal store recorder — see {@link WorkPoolConfigWithItemSchema.store}. @internal */
  readonly store?: QueueStoreWriter<T, E, A>;
};

type ReleaseEntryEncoder<T> = (
  internal: InternalItem<T>,
  releaseId: string,
  attributes: Record<string, unknown> | undefined,
) => Effect.Effect<QueueEncodedEntry, QueueItemEncodingError>;

/** Item ⇄ durable payload codec for {@link WorkPoolConfigBase.persist} (built from `itemSchema`). */
type PersistCodec<T> = {
  readonly encode: (item: T) => Exit.Exit<unknown, unknown>;
  readonly decode: (json: unknown) => Exit.Exit<T, unknown>;
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
  readonly entryId: string;
  /** Number of times this item has been re-enqueued via retry. */
  readonly retries: number;
  /** Lane index the item was originally enqueued at. */
  readonly level: number;
  /** Timestamp (ms since epoch) when the item first entered the queue. */
  readonly enqueuedAt: number;
  /** Cached dedup key (avoids recomputing `config.key` on each check). */
  readonly key: string | undefined;
}

const queueEntryFromInternal = <T>(
  internal: InternalItem<T>,
  timestamps?: Partial<Omit<QueueEntryTimestamps, "enqueuedAt">>,
  metadata?: Pick<QueueEntry<T>, "releaseId" | "sourceHyperlinkId" | "attributes">,
  levelToPriority: (level: number) => Priority = levelToDefaultPriority,
): QueueEntry<T> => ({
  item: internal.item,
  entryId: internal.entryId,
  key: internal.key,
  priority: levelToPriority(internal.level),
  level: internal.level,
  attempts: internal.retries + 1,
  timestamps: {
    enqueuedAt: DateTime.makeUnsafe(internal.enqueuedAt),
    ...timestamps,
  },
  ...metadata,
});

const isQueueEntry = <T>(value: QueueEntrySelector<T> | QueueEntry<T>): value is QueueEntry<T> =>
  "entryId" in value && "priority" in value && "timestamps" in value;

// ============================================================================
// Core Implementation
// ============================================================================

// The closure captures the resolved limiter (see acquireQueueRateLimitAwait), so it requires only
// `R` (from emitExceeded) — not RateLimiterTag.
type RateLimitAwait<T, R> = (
  internal: InternalItem<T>,
) => Effect.Effect<void, RateLimiterError, R>;

interface RateLimitExceededEmit<T> {
  readonly internal: InternalItem<T>;
  readonly limitKey: string;
  readonly algorithm: "fixed-window" | "token-bucket";
  readonly outcome: "delayed" | "rejected";
  readonly consume?: ConsumeResult;
  readonly error?: RateLimiterError;
}

/**
 * In-memory {@link RateLimiterTag} + store layers for queues with `rateLimit` set.
 * Merged automatically on {@link WorkPool.Service} `.layer` when `rateLimit` is
 * present; compose at the app root for Redis via `RateLimiter.layerStoreRedis`.
 *
 * @category layers & serving
 * @public
 */
export const queueRateLimiterLayer = Layer.provide(rateLimiterLayer, layerStoreMemory);

/** @internal */
const layerWithQueueRateLimiterIfNeeded = <A, E, R>(
  layer: Layer.Layer<A, E, R>,
  config: Pick<WorkPoolConfigBase<unknown>, "rateLimit">,
): Layer.Layer<A, E, R> =>
  config.rateLimit === undefined
    ? layer
    : Layer.provide(layer, queueRateLimiterLayer);

const resolveRateLimitConsumeOptions = (
  queueName: string,
  rateLimit: WorkPoolRateLimitOptions,
): Parameters<EffectRateLimiter["consume"]>[0] => {
  const { key: limitKey, ...rest } = rateLimit;
  return {
    ...rest,
    key: limitKey ?? queueName,
    algorithm: rateLimit.algorithm ?? "fixed-window",
    onExceeded: rateLimit.onExceeded ?? "delay",
    tokens: rateLimit.tokens,
  };
};

const assertValidRateLimit = (rateLimit: WorkPoolRateLimitOptions): void => {
  if (!(rateLimit.limit > 0) || !Number.isFinite(rateLimit.limit)) {
    throw new Error(
      `WorkPool rateLimit.limit must be a positive number, got ${String(rateLimit.limit)}`,
    );
  }
  const windowMs = Duration.toMillis(Duration.fromInputUnsafe(rateLimit.window));
  if (!(windowMs > 0) || !Number.isFinite(windowMs)) {
    throw new Error(
      `WorkPool rateLimit.window must be positive, got ${String(rateLimit.window)}`,
    );
  }
  if (rateLimit.tokens !== undefined) {
    if (!(rateLimit.tokens > 0) || !Number.isFinite(rateLimit.tokens)) {
      throw new Error(
        `WorkPool rateLimit.tokens must be a positive number, got ${String(rateLimit.tokens)}`,
      );
    }
  }
};

const isRateLimitExceededReason = (
  reason: RateLimiterError["reason"],
): reason is RateLimitExceeded => reason._tag === "RateLimitExceeded";

const acquireQueueRateLimitAwait = <T, R>(
  queueName: string,
  rateLimit: WorkPoolRateLimitOptions,
  emitExceeded: (payload: RateLimitExceededEmit<T>) => Effect.Effect<void, never, R>,
): Effect.Effect<RateLimitAwait<T, R>, never, RateLimiterTag> =>
  Effect.gen(function* () {
    assertValidRateLimit(rateLimit);
    const limiter = yield* RateLimiterTag;
    const consumeOptions = resolveRateLimitConsumeOptions(queueName, rateLimit);
    const onExceeded = consumeOptions.onExceeded ?? "delay";

    return (internal: InternalItem<T>) =>
      onExceeded === "fail"
        ? limiter.consume(consumeOptions).pipe(
            Effect.flatMap(() => Effect.void),
            Effect.catchTag("RateLimiterError", (error) =>
              Effect.gen(function* () {
                if (isRateLimitExceededReason(error.reason)) {
                  yield* emitExceeded({
                    internal,
                    limitKey: consumeOptions.key,
                    algorithm: consumeOptions.algorithm ?? "fixed-window",
                    outcome: "rejected",
                    error,
                  });
                }
                return yield* error;
              }),
            ),
          )
        : Effect.gen(function* () {
            const result = yield* limiter.consume(consumeOptions);
            if (!Duration.isZero(result.delay)) {
              yield* emitExceeded({
                internal,
                limitKey: consumeOptions.key,
                algorithm: consumeOptions.algorithm ?? "fixed-window",
                outcome: "delayed",
                consume: result,
              });
              yield* Effect.sleep(result.delay);
            }
          });
  });

/**
 * Internal factory: creates the scoped Effect that produces a {@link QueueHandle}.
 *
 * Architecture:
 * - Three bounded `Queue<InternalItem<T>>` (one per priority level)
 * - N worker fibers (managed by `FiberSet`) that loop: latch → take → latch → process
 * - Optional deferred fork via {@link WorkPoolConfigBase.autoStart}: when `false`,
 *   call {@link QueueHandleApi.start} to fork the worker pool.
 * - Drain wake: waits until queues drain empty after processed work (not cold-start empty) — emits a `Drained` event.
 * - Worker wake (`takeNext`): enqueue / shutdown — avoids priority inversion vs racing priority queues.
 * - Refill wake: drain-to-empty after an item completes (or after {@link QueueHandleApi.clear}) — independent of idle worker waits.
 * - `Latch` gates worker entry (pause/resume)
 * - `Semaphore` for concurrency control within the worker pool
 * - Optional Effect `RateLimiter` when `rateLimit` is set on config
 * - Lifecycle facts are published to the `events` PubSub (fan-out; never block workers)
 */
const validateItemsWithSchema = <T>(
  queueName: string,
  itemSchema: Schema.Codec<T, unknown, never, never>,
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

/** Extension point for {@link CustomQueueHyperlink} and other queue presets. @internal */
interface BuildQueueEngineBindings<T, E, EEnqueue, R, A = void> {
  readonly config: QueueRuntimeConfig<T, E, EEnqueue, R, A>;
  readonly validateForEnqueue: ValidateForEnqueue<T, EEnqueue>;
  readonly encodeForRelease: ReleaseEntryEncoder<T> | undefined;
  readonly persistCodec: PersistCodec<T> | undefined;
  /** Override config `levelCount` when wiring a custom preset. */
  readonly levelCount?: number;
  /** Fully custom lane store; when omitted, derived from config `levelCount` + `takeAlgorithm`. */
  readonly makeLaneStore?: (
    capacity: number,
  ) => Effect.Effect<LaneStore<InternalItem<T>>>;
  /** Observe + enqueue projection (default: 3-level `{ high, normal, low }`). */
  readonly projection?: QueueRuntimeProjection<
    { readonly high: number; readonly normal: number; readonly low: number },
    QueueStatus
  >;
}

/**
 * Wire the shared queue runtime with lane-store and priority-mapping options.
 *
 * @internal
 */
function buildQueueEngine<T, E, EEnqueue, R, A = void>(
  bindings: BuildQueueEngineBindings<T, E, EEnqueue, R, A>,
): Effect.Effect<QueueEngineHandle<T, E, EEnqueue, R, A>, never, Scope.Scope | R> {
  const levelCount = bindings.levelCount ?? bindings.config.levelCount ?? 3;
  const makeLaneStore =
    bindings.makeLaneStore ??
    laneStoreFactoryFromConfig<InternalItem<T>>({
      levelCount,
      takeAlgorithm: bindings.config.takeAlgorithm,
    });
  const projection = bindings.projection ?? defaultQueueProjection;
  return makeQueueRuntime(
    bindings.config,
    bindings.validateForEnqueue,
    bindings.encodeForRelease,
    bindings.persistCodec,
    makeLaneStore,
    projection,
  );
}

type MakeQueueEffectResult<C extends WorkPoolConfig<any, any, any, any>> =
  [C] extends [WorkPoolConfigWithItemSchema<any, any, any, any>]
    ? EngineQueueHandle<
        InferQueueItem<C>,
        InferQueueWorkerError<C>,
        QueueEnqueueErrors,
        InferQueueWorkerRequirements<C>,
        InferQueueWorkerSuccess<C>
      >
    : EngineQueueHandle<
        InferQueueItem<C>,
        InferQueueWorkerError<C>,
        never,
        InferQueueWorkerRequirements<C>,
        InferQueueWorkerSuccess<C>
      >;

const makeQueueEffectWithoutSchema = <
  const C extends WorkPoolConfigWithoutItemSchema<any, any, any>,
>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  EngineQueueHandle<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    never,
    InferQueueWorkerRequirements<C>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
> =>
  buildQueueEngine({
    config,
    validateForEnqueue: (items, _operation) => Effect.succeed(items),
    encodeForRelease: undefined,
    persistCodec: undefined,
  });

const makeQueueEffectWithSchema = <
  const C extends WorkPoolConfigWithItemSchema<any, any, any, any>,
>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  EngineQueueHandle<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    QueueEnqueueErrors,
    InferQueueWorkerRequirements<C>,
    InferQueueWorkerSuccess<C>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
> => {
  const queueName = config.name ?? "anonymous";
  const descriptor = makeQueueItemCodecDescriptor(queueName, config.itemSchema);
  // keep the validation/error codec id in lockstep with the descriptor's versioned id.
  const codecId = descriptor.id;
  const encodeItem = Schema.encodeUnknownExit(config.itemSchema);
  const encodeForRelease = (
    internal: InternalItem<InferQueueItem<C>>,
    releaseId: string,
    attributes?: Record<string, unknown>,
  ) => {
    const encoded = encodeItem(internal.item);
    return Exit.match(encoded, {
      onSuccess: (payload) =>
        isJsonValue(payload)
          ? Effect.succeed({
              ...queueEntryFromInternal(internal, undefined, { releaseId, attributes }),
              payload,
              item: descriptor,
            })
          : Effect.fail(
              new QueueItemEncodingError({
                queue: queueName,
                entryId: internal.entryId,
                message: "encoded item is not JSON-compatible",
                codecId,
              }),
            ),
      onFailure: (cause) =>
        Effect.fail(
          new QueueItemEncodingError({
            queue: queueName,
            entryId: internal.entryId,
            message: Cause.pretty(cause),
            codecId,
          }),
        ),
    });
  };
  return buildQueueEngine({
    config,
    validateForEnqueue: (items, operation) =>
      validateItemsWithSchema(queueName, config.itemSchema, codecId, items, operation),
    encodeForRelease,
    persistCodec: { encode: encodeItem, decode: Schema.decodeUnknownExit(config.itemSchema) },
  });
};

const makeQueueEffectFromConfig = (
  config: WorkPoolConfig<any, any, any, any>,
): Effect.Effect<
  EngineQueueHandle<unknown, unknown, unknown, unknown, unknown>,
  never,
  // Internal erased boundary: the worker's requirement is `any` here (the config is
  // `any`-typed at this dispatch). `any` — not `unknown` — is the honest erasure: it stays
  // assignable both ways, and the precise `R` is preserved on the public `makeQueueEffect`
  // overloads. (`unknown` would assert an unprovidable service → `missingEffectContext`.)
  Scope.Scope | any
> =>
  hasItemSchema(config)
    ? makeQueueEffectWithSchema(config)
    : makeQueueEffectWithoutSchema(config);

function makeQueueEffect<
  F extends QueueWorkerEffect<any, any, any, any>,
  O extends
    | WorkPoolOptionsWithoutItemSchema<any, any, any>
    | WorkPoolOptionsWithItemSchema<any, any, any>
    | undefined = undefined,
>(
  effect: F,
  options?: O,
): Effect.Effect<
  MakeQueueEffectResult<QueueConfigFromEffect<F, O>>,
  never,
  Scope.Scope | InferQueueWorkerRequirements<QueueConfigFromEffect<F, O>>
>;
function makeQueueEffect<const C extends WorkPoolConfig<any, any, any, any>>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  MakeQueueEffectResult<C>,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
>;
function makeQueueEffect(
  effectOrConfig: QueueWorkerEffect<any, any, any, any> | WorkPoolConfig<any, any, any, any>,
  options?: WorkPoolOptionsWithoutItemSchema<any, any, any> | WorkPoolOptionsWithItemSchema<any, any, any>,
): Effect.Effect<
  EngineQueueHandle<unknown, unknown, unknown, unknown, unknown>,
  never,
  // Erased overload-impl boundary — the precise `R` (`Scope.Scope |
  // InferQueueWorkerRequirements<...>`) is on the overloads above; here the worker
  // requirement is `any`, not `unknown` (see {@link makeQueueEffectFromConfig}).
  Scope.Scope | any
> {
  if (typeof effectOrConfig === "function") {
    const config = { ...(options ?? {}), effect: effectOrConfig };
    return makeQueueEffectFromConfig(config);
  }
  return makeQueueEffectFromConfig(effectOrConfig);
}

type ValidateForEnqueue<T, EEnqueue> = (
  items: ReadonlyArray<T>,
  operation: "add" | "prioritize" | "defer",
) => Effect.Effect<ReadonlyArray<T>, EEnqueue>;

const makeQueueRuntime = <T, E, EEnqueue, R, A = void>(
  config: QueueRuntimeConfig<T, E, EEnqueue, R, A>,
  validateForEnqueue: ValidateForEnqueue<T, EEnqueue>,
  encodeForRelease: ReleaseEntryEncoder<T> | undefined,
  persistCodec: PersistCodec<T> | undefined,
  // Injected lane structure — the only lane-specific dependency. The default queue passes the FIFO
  // factory; CustomQueueHyperlink passes the weighted one. The engine imports neither impl (only the
  // `LaneStore` type), so a bundle pulls only the lane store it actually wires.
  makeLaneStore: (
    capacity: number,
  ) => Effect.Effect<LaneStore<InternalItem<T>>>,
  projection: QueueRuntimeProjection<
    { readonly high: number; readonly normal: number; readonly low: number },
    QueueStatus
  > = defaultQueueProjection,
): Effect.Effect<QueueEngineHandle<T, E, EEnqueue, R, A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const queueName = config.name ?? "anonymous";
    const concurrency = config.concurrency ?? 5;
    const shutdownMode = config.shutdownMode ?? "drain";
    const capacity = config.capacity ?? 50_000;
    const logScopeTag = { key: queueName };
    const tapLogs = <A2, E2, R2>(eff: Effect.Effect<A2, E2, R2>): Effect.Effect<A2, E2, R2> =>
      withLogScope(logScopeTag)(eff);
    // `attempts` → max auto re-enqueues (= attempts - 1). Unset → no auto re-enqueue budget.
    const maxRetries =
      config.attempts !== undefined ? Math.max(0, config.attempts - 1) : Infinity;
    // The worker auto re-enqueues failed items at their priority, up to `maxRetries`, whenever
    // `attempts` is set. Observe outcomes via the `events` stream; drive custom per-error
    // disposition by handling `Failed`/`Exit` there.
    const autoReEnqueue = config.attempts !== undefined;
    // ─── Allocate internal state ───
    // The lane store is injected (FIFO for the default queue, weighted for CustomQueueHyperlink); the
    // rest of the engine drives it lane-agnostically through the `LaneStore` interface.
    const laneStore = yield* makeLaneStore(capacity);

    // ─── Durability (presence-driven: a DurableQueueStore in context) ───
    // The layer is the switch — no config flag. A `DurableQueueStore` in context makes the store
    // the source of truth (enqueue persists, a feeder leases work into the lanes, completion/failure
    // update the store, boot recovers in-flight work). It requires an `itemSchema` so the payload
    // can serialize; a store in context without a codec is a misconfiguration we surface. No store
    // → the in-memory lanes are the queue, exactly as before. In-memory durability is a
    // contradiction, so this stays serviceOption rather than a baked-in default.
    const durableStoreOption = yield* Effect.serviceOption(DurableQueueStore);
    if (Option.isSome(durableStoreOption) && persistCodec === undefined) {
      yield* Effect.logWarning(
        `Queue "${queueName}" not durable: a DurableQueueStore is in context but the queue has no itemSchema (the payload must serialize)`,
      );
    }
    const persist =
      Option.isSome(durableStoreOption) && persistCodec !== undefined
        ? {
            store: durableStoreOption.value,
            codec: persistCodec,
            leaseMillis: 300_000,
            maxAttempts: (config.attempts ?? 0) + 1,
            pollInterval: Duration.millis(100),
          }
        : undefined;

    const levelToPriority = projection.levelToPriority;
    const levelOf = projection.priorityToLevel;

    // Outstanding work per lane. Durable: the store is the truth (3-level counts). In-memory: lanes.
    const levelSizes: Effect.Effect<ReadonlyArray<number>> =
      persist === undefined
        ? laneStore.sizes
        : persist.store
            .sizes(queueName)
            .pipe(
              Effect.map(({ high, normal, low }) => [high, normal, low]),
              Effect.catch(() => Effect.succeed([0, 0, 0])),
            );

    const projectedSizes = Effect.map(levelSizes, (levels) =>
      projection.projectSizes(levels),
    );

    const totalPending = Effect.map(levelSizes, (levels) =>
      projection.totalPending(levels),
    );

    // Latch: open = workers run, closed = workers block before next item.
    // Starts closed when `paused: true` so items can accumulate before processing.
    const latch = yield* Latch.make(!(config.paused ?? false));

    // Concurrency gate: workers acquire a permit before processing.
    const semaphore = yield* Semaphore.make(concurrency);

    // Counters and state flags
    const completedCount = yield* Ref.make(0);
    const isShutdownRef = yield* Ref.make(false);

    // ─── Fan-out lifecycle events ───
    // A sliding PubSub: publishing never blocks the worker (drops oldest when a subscriber
    // lags), so the fan-out `events` stream can't backpressure or OOM the queue. Guaranteed
    // delivery stays on the durable store tier. Each `events` consumer subscribes
    // independently via `Stream.fromPubSub`.
    const eventsHub = yield* PubSub.sliding<QueueEvent<T, E, A>>(1024);

    // ─── Windowed metrics (.metrics) ───
    // Counters are accumulated INLINE in publishEvent (synchronous, at the source), never by
    // consuming the lossy events hub — so metrics never undercount under load. Windows are
    // dynamic: `metricsWindowMax` bounds staleness, a significant event flushes early, and
    // `metricsWindowMin` floors the cadence so a burst (e.g. a takeAll storm) doesn't spam.
    const metricsWindowMax = Duration.seconds(5);
    const metricsWindowMin = Duration.millis(100);
    const metricsHub = yield* PubSub.sliding<QueueMetrics>(256);
    const nowMs: Effect.Effect<number> = Effect.clockWith(
      (c) => c.currentTimeMillis,
    );
    interface PerPriorityAccum {
      readonly high: number;
      readonly normal: number;
      readonly low: number;
    }
    const zeroPerPriority: PerPriorityAccum = { high: 0, normal: 0, low: 0 };
    interface WindowAccum {
      readonly startedAt: number;
      readonly enqueued: number;
      readonly started: number;
      readonly completed: number;
      readonly failed: number;
      readonly retried: number;
      readonly deadLettered: number;
      readonly dropped: number;
      readonly rateLimitExceeded: number;
      // wait (enqueued → pickup), summed + counted PER PRIORITY
      readonly waitSumMs: PerPriorityAccum;
      readonly waitCount: PerPriorityAccum;
      // execution (pickup → done), summed + counted OVERALL
      readonly executionSumMs: number;
      readonly executionCount: number;
      // total (enqueued → done), summed + counted OVERALL
      readonly totalSumMs: number;
      readonly totalCount: number;
    }
    const freshAccum = (startedAt: number): WindowAccum => ({
      startedAt,
      enqueued: 0,
      started: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      deadLettered: 0,
      dropped: 0,
      rateLimitExceeded: 0,
      waitSumMs: zeroPerPriority,
      waitCount: zeroPerPriority,
      executionSumMs: 0,
      executionCount: 0,
      totalSumMs: 0,
      totalCount: 0,
    });
    // Wait = startedAt − enqueuedAt (ms). Undefined if the entry was never started (shouldn't
    // happen for a Completed/Failed event, but the timestamp is optional on the type).
    const waitMsOf = (entry: QueueEntry<T>): number | undefined =>
      entry.timestamps.startedAt !== undefined
        ? DateTime.toEpochMillis(entry.timestamps.startedAt) -
          DateTime.toEpochMillis(entry.timestamps.enqueuedAt)
        : undefined;
    // Fold one completed/failed entry's latency (wait per-priority + execution/total overall).
    const foldLatency = (
      acc: WindowAccum,
      entry: QueueEntry<T>,
      elapsed: Duration.Duration,
    ): WindowAccum => {
      const execution = Duration.toMillis(elapsed);
      const wait = waitMsOf(entry);
      const pr = entry.priority;
      return {
        ...acc,
        waitSumMs:
          wait !== undefined
            ? { ...acc.waitSumMs, [pr]: acc.waitSumMs[pr] + wait }
            : acc.waitSumMs,
        waitCount:
          wait !== undefined
            ? { ...acc.waitCount, [pr]: acc.waitCount[pr] + 1 }
            : acc.waitCount,
        executionSumMs: acc.executionSumMs + execution,
        executionCount: acc.executionCount + 1,
        totalSumMs:
          wait !== undefined ? acc.totalSumMs + wait + execution : acc.totalSumMs,
        totalCount: wait !== undefined ? acc.totalCount + 1 : acc.totalCount,
      };
    };
    const accumulate = (acc: WindowAccum, event: QueueEvent<T, E, A>): WindowAccum => {
      switch (event._tag) {
        case "Enqueued":
          return { ...acc, enqueued: acc.enqueued + event.entries.length };
        case "Started":
          return { ...acc, started: acc.started + 1 };
        case "Completed":
          return foldLatency(
            { ...acc, completed: acc.completed + 1 },
            event.entry,
            event.elapsed,
          );
        case "Failed":
          return foldLatency(
            { ...acc, failed: acc.failed + 1 },
            event.entry,
            event.elapsed,
          );
        case "RetryScheduled":
          return { ...acc, retried: acc.retried + 1 };
        case "DeadLettered":
          return { ...acc, deadLettered: acc.deadLettered + event.entries.length };
        case "Dropped":
          return { ...acc, dropped: acc.dropped + event.entries.length };
        case "RateLimitExceeded":
          return { ...acc, rateLimitExceeded: acc.rateLimitExceeded + 1 };
        default:
          return acc;
      }
    };
    // Events that should close the metrics window early (the UI wants to see their effect now).
    const isSignificant = (event: QueueEvent<T, E, A>): boolean =>
      event._tag === "Drained" ||
      event._tag === "Cleared" ||
      event._tag === "Released" ||
      event._tag === "DeadLettered" ||
      event._tag === "Dropped" ||
      event._tag === "ShutdownRequested" ||
      event._tag === "ShutdownComplete";

    // ─── OTEL metrics (Effect `Metric` → exported by the runtime's metric reader) ───
    // The cumulative counterparts to the windowed `.metrics` stream: that stream is for live UI,
    // these feed OpenTelemetry. Tagged per-queue so multiple queues stay distinct series.
    const metricAttributes = { queue: queueName };
    const enqueuedCounter = Metric.counter("queue_enqueued_total", {
      incremental: true,
      description: "Items enqueued",
      attributes: metricAttributes,
    });
    const startedCounter = Metric.counter("queue_started_total", {
      incremental: true,
      description: "Items started by a worker",
      attributes: metricAttributes,
    });
    const completedCounter = Metric.counter("queue_completed_total", {
      incremental: true,
      description: "Items completed successfully",
      attributes: metricAttributes,
    });
    const failedCounter = Metric.counter("queue_failed_total", {
      incremental: true,
      description: "Items whose worker effect failed",
      attributes: metricAttributes,
    });
    const retriedCounter = Metric.counter("queue_retried_total", {
      incremental: true,
      description: "Failed items re-enqueued for retry",
      attributes: metricAttributes,
    });
    const deadLetteredCounter = Metric.counter("queue_dead_lettered_total", {
      incremental: true,
      description: "Items routed to the dead-letter disposition",
      attributes: metricAttributes,
    });
    const droppedCounter = Metric.counter("queue_dropped_total", {
      incremental: true,
      description: "Items dropped",
      attributes: metricAttributes,
    });
    const rateLimitExceededCounter = Metric.counter("queue_rate_limit_exceeded_total", {
      incremental: true,
      description: "Worker rate-limit rejections",
      attributes: metricAttributes,
    });
    const inFlightGauge = Metric.gauge("queue_in_flight", {
      description: "Items currently processing",
      attributes: metricAttributes,
    });
    const latencyBoundaries = Metric.exponentialBoundaries({
      start: 1,
      factor: 2,
      count: 12,
    });
    // Worker execution time (pickup → done). Named *processing* historically; it is execution.
    const executionHistogram = Metric.histogram("queue_processing_duration_ms", {
      description: "Item worker execution duration (pickup → done) in milliseconds",
      attributes: metricAttributes,
      boundaries: latencyBoundaries,
    });
    // Queue wait (enqueued → pickup), tagged by priority per update so OTEL can break it down.
    const waitHistogram = Metric.histogram("queue_wait_duration_ms", {
      description: "Item queue wait (enqueued → pickup) in milliseconds",
      attributes: metricAttributes,
      boundaries: latencyBoundaries,
    });
    // End-to-end (enqueued → done = wait + execution).
    const totalHistogram = Metric.histogram("queue_total_duration_ms", {
      description: "Item end-to-end duration (enqueued → done) in milliseconds",
      attributes: metricAttributes,
      boundaries: latencyBoundaries,
    });
    // Record the latency histograms for a completed/failed entry: execution always; wait (tagged
    // by priority) and total only when the entry was started (so wait is well-defined).
    const recordLatency = (
      entry: QueueEntry<T>,
      elapsed: Duration.Duration,
    ): Effect.Effect<void> => {
      const execution = Duration.toMillis(elapsed);
      const wait = waitMsOf(entry);
      return Effect.gen(function* () {
        yield* Metric.update(executionHistogram, execution);
        if (wait !== undefined) {
          yield* Metric.update(
            Metric.withAttributes(waitHistogram, { priority: entry.priority }),
            wait,
          );
          yield* Metric.update(totalHistogram, wait + execution);
        }
      });
    };
    // Mirror each accumulated event onto its OTEL counter (same dispatch as `accumulate`).
    const recordEventMetric = (event: QueueEvent<T, E, A>): Effect.Effect<void> => {
      switch (event._tag) {
        case "Enqueued":
          return Metric.update(enqueuedCounter, event.entries.length);
        case "Started":
          return Metric.update(startedCounter, 1);
        case "Completed":
          return Effect.andThen(
            Metric.update(completedCounter, 1),
            recordLatency(event.entry, event.elapsed),
          );
        case "Failed":
          return Effect.andThen(
            Metric.update(failedCounter, 1),
            recordLatency(event.entry, event.elapsed),
          );
        case "RetryScheduled":
          return Metric.update(retriedCounter, 1);
        case "DeadLettered":
          return Metric.update(deadLetteredCounter, event.entries.length);
        case "Dropped":
          return Metric.update(droppedCounter, event.entries.length);
        case "RateLimitExceeded":
          return Metric.update(rateLimitExceededCounter, 1);
        default:
          return Effect.void;
      }
    };
    const windowStartMs = yield* nowMs;
    const windowAccum = yield* Ref.make(freshAccum(windowStartMs));
    let metricsFlush = yield* Deferred.make<void>();
    const requestMetricsFlush: Effect.Effect<void> = Effect.asVoid(
      Deferred.succeed(metricsFlush, undefined),
    );

    // Store side of `publishEvent`: dispatch each event to the recorder's narrow, semantic write
    // (`store.completed(entry, elapsed)`, …); queue-level facts without a narrow write ride the base
    // `record`. The hub fan-out above is untouched — only the store side changed.
    const recordToStore = (
      store: QueueStoreWriter<T, E, A>,
      event: QueueEvent<T, E, A>,
    ): Effect.Effect<void> => {
      switch (event._tag) {
        case "Enqueued":
          return store.enqueued(event.entries, event.priority, event.batchId);
        case "Started":
          return store.started(event.entry);
        case "Completed":
          return store.completed(event.entry, event.success, event.elapsed);
        case "Failed":
          return store.failed(event.entry, event.cause, event.elapsed);
        case "RetryScheduled":
          return store.retryScheduled(event.entry, event.cause, event.nextAttempt);
        case "RetryExhausted":
          return store.retryExhausted(event.entry, event.cause);
        default:
          return store.record(event);
      }
    };

    const publishEvent = (event: QueueEvent<T, E, A>): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.update(windowAccum, (acc) => accumulate(acc, event));
        yield* recordEventMetric(event);
        yield* PubSub.publish(eventsHub, event);
        // Persist to the resource store at the source, so no burst is dropped by a late subscriber.
        if (config.store !== undefined) yield* recordToStore(config.store, event);
        if (isSignificant(event)) yield* requestMetricsFlush;
      });

    const emitMetricsWindow: Effect.Effect<void> = Effect.gen(function* () {
      const now = yield* nowMs;
      const acc = yield* Ref.getAndSet(windowAccum, freshAccum(now));
      const windowMillis = now - acc.startedAt;
      const inFlight = yield* Ref.get(inFlightRef);
      const metrics: QueueMetrics = {
        windowStart: DateTime.makeUnsafe(acc.startedAt),
        windowEnd: DateTime.makeUnsafe(now),
        windowMillis,
        enqueued: acc.enqueued,
        started: acc.started,
        completed: acc.completed,
        failed: acc.failed,
        retried: acc.retried,
        deadLettered: acc.deadLettered,
        dropped: acc.dropped,
        rateLimitExceeded: acc.rateLimitExceeded,
        inFlight,
        throughputPerSec:
          windowMillis > 0 ? (acc.completed / windowMillis) * 1000 : 0,
        // wait per priority — each lane present only if it had completions this window
        avgWaitMillis: {
          ...(acc.waitCount.high > 0
            ? { high: acc.waitSumMs.high / acc.waitCount.high }
            : {}),
          ...(acc.waitCount.normal > 0
            ? { normal: acc.waitSumMs.normal / acc.waitCount.normal }
            : {}),
          ...(acc.waitCount.low > 0
            ? { low: acc.waitSumMs.low / acc.waitCount.low }
            : {}),
        },
        ...(acc.executionCount > 0
          ? { avgExecutionMillis: acc.executionSumMs / acc.executionCount }
          : {}),
        ...(acc.totalCount > 0
          ? { avgTotalMillis: acc.totalSumMs / acc.totalCount }
          : {}),
      };
      yield* PubSub.publish(metricsHub, metrics);
    });

    // ─── Current-state snapshot (.status) ───
    // A SubscriptionRef recomputed from authoritative sources (queue sizes + the refs below),
    // so every snapshot is accurate truth even though the events that trigger refreshes are
    // lossy. `paused`/`inFlight` are tracked here because the latch/semaphore don't expose them.
    const pausedRef = yield* Ref.make(config.paused ?? false);
    const inFlightRef = yield* Ref.make(0);
    // Lifecycle phase, orthogonal to paused. `shutdown` advances running → draining → off.
    const phaseRef = yield* Ref.make<"running" | "draining" | "off">("running");
    const computeStatus = Effect.gen(function* () {
      const levels = yield* levelSizes;
      return projection.buildStatus({
        levels,
        paused: yield* Ref.get(pausedRef),
        inFlight: yield* Ref.get(inFlightRef),
        completed: yield* Ref.get(completedCount),
        phase: yield* Ref.get(phaseRef),
      });
    });
    const statusRef = yield* SubscriptionRef.make(yield* computeStatus);
    const refreshStatus = Effect.flatMap(computeStatus, (s) =>
      SubscriptionRef.set(statusRef, s),
    );
    const statusSub: Hyperlink.Subscribable<QueueStatus> = {
      get: computeStatus,
      changes: SubscriptionRef.changes(statusRef),
    };
    // Total outstanding (durable store when persisting, else lanes); used by shutdown finalization.
    const totalPendingEffect = totalPending;
    // Finalize shutdown once the queue has drained empty AND no item is in flight: flip
    // draining → off (exactly once), emit `ShutdownComplete`, and refresh the snapshot so its
    // `phase` reads `"off"`. Called after each item finishes and at shutdown initiation (covers
    // the already-idle case). The `getAndSet` guard makes the transition idempotent.
    const finalizeShutdownIfDrained: Effect.Effect<void> = Effect.gen(function* () {
      if ((yield* Ref.get(phaseRef)) !== "draining") return;
      const pending = yield* totalPendingEffect;
      const inFlight = yield* Ref.get(inFlightRef);
      if (pending > 0 || inFlight > 0) return;
      const previous = yield* Ref.getAndSet(phaseRef, "off");
      if (previous !== "draining") return; // another fiber finalized first
      yield* publishEvent({
        _tag: "ShutdownComplete",
        key: queueName,
        completed: yield* Ref.get(completedCount),
      });
      yield* refreshStatus;
      yield* Effect.logInfo(`Queue "${queueName}" shut down (off)`);
    });
    // One fiber recomputes the snapshot on each lifecycle event (covers enqueue/start/exit/
    // drain/release/clear); pause/resume refresh inline (they emit no event). Tied to the
    // queue scope, so it's interrupted on teardown. Subscribe **synchronously** (not the lazy
    // `Stream.fromPubSub` inside the fork) so the very first event can't be dropped by a
    // subscription race — a mutating op right after acquire must still refresh the snapshot.
    const statusEvents = yield* PubSub.subscribe(eventsHub);
    yield* Effect.forkScoped(
      Stream.runForEach(Stream.fromSubscription(statusEvents), () => refreshStatus),
    );

    // Dynamic-window metrics timer: emit when a significant event requests a flush OR the max
    // window elapses (whichever first), then hold for the min window to coalesce bursts.
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* Effect.race(
            Effect.sleep(metricsWindowMax),
            Deferred.await(metricsFlush),
          );
          metricsFlush = yield* Deferred.make<void>();
          yield* emitMetricsWindow;
          yield* Effect.sleep(metricsWindowMin);
        }),
      ),
    );

    // Dedup: set of keys currently in-flight (enqueued or processing).
    // A key is added on enqueue and removed after processing completes.
    const activeKeys = yield* Ref.make(HashSet.empty<string>());

    // Worker wake: enqueue / shutdown unblock `takeNext` waiters on empty queues.
    let workerWakeSignal = yield* Deferred.make<void>();
    // Drain wake: distinct so idle workers never pulse a spurious Drained event.
    let drainWakeSignal = yield* Deferred.make<void>();

    // Managed fiber collections. Scope close interrupts all fibers automatically.
    const workerFibers = yield* FiberSet.make<void>();
    /** Set before workers process items (autoStart or manual `start`). */
    const queueHandleSlot: { current?: EngineQueueHandle<T, E, EEnqueue, R, A> } = {};

    const rateLimitLog =
      config.rateLimit === undefined
        ? "rateLimit=off"
        : `rateLimit=${String(config.rateLimit.limit)}/${Duration.format(Duration.fromInputUnsafe(config.rateLimit.window))} key=${config.rateLimit.key ?? queueName} algo=${config.rateLimit.algorithm ?? "fixed-window"} onExceeded=${config.rateLimit.onExceeded ?? "delay"}`;
    yield* Effect.logDebug(
      `Queue "${queueName}" initializing: concurrency=${String(concurrency)}, capacity=${String(capacity)}, ${rateLimitLog}`,
    );

    let entrySeq = 0;
    let releaseSeq = 0;

    const nextEntryId = (): string => {
      entrySeq++;
      return `${queueName}-entry-${String(entrySeq)}`;
    };

    const nextReleaseId = (): string => {
      releaseSeq++;
      return `${queueName}-release-${String(releaseSeq)}`;
    };

    const emitRateLimitExceeded = (
      payload: RateLimitExceededEmit<T>,
    ): Effect.Effect<void, never, R> =>
      Effect.gen(function* () {
        const entry = queueEntryFromInternal(payload.internal);

        yield* publishEvent({
          _tag: "RateLimitExceeded",
          key: queueName,
          entry,
          limitKey: payload.limitKey,
          algorithm: payload.algorithm,
          outcome: payload.outcome,
        });
      });

    // ─── Internal: wake signals (workers vs drain monitor) ───

    /** Complete the current worker wake signal and allocate a fresh one. */
    const signalWorkerWake = Effect.gen(function* () {
      yield* Deferred.succeed(workerWakeSignal, undefined);
      workerWakeSignal = yield* Deferred.make<void>();
    });

    /** Complete the current drain wake signal and allocate a fresh one. */
    const signalDrainWake = Effect.gen(function* () {
      yield* Deferred.succeed(drainWakeSignal, undefined);
      drainWakeSignal = yield* Deferred.make<void>();
    });

    /** Shutdown must unblock both `takeNext` waiters and the drain monitor. */
    const signalShutdownWake = Effect.gen(function* () {
      yield* signalWorkerWake;
      yield* signalDrainWake;
    });

    /** Wake drain monitor when all priority queues are empty (after work drains). */
    const wakeDrainedIfAllQueuesEmpty = Effect.gen(function* () {
      if (yield* laneStore.isEmpty) {
        yield* signalDrainWake;
      }
    });

    // ─── Internal: enqueue logic ───

    /**
     * Core enqueue path. Handles:
     * 1. Shutdown check (warn + drop)
     * 2. Dedup key check (skip duplicates)
     * 3. Offer to the target lane
     * 4. Wake sleeping workers (`takeNext` waiters)
     * 5. Publish the `Enqueued` event
     */
    const enqueueInternal = (
      items: ReadonlyArray<T>,
      level: number,
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

        // Durable path: the store is the dedup authority and the source of truth — persist each
        // item (not the in-memory lane); the feeder leases them into the workers. Skips in-memory
        // `activeKeys` / dedupe analytics (the store dedups on `dedupKey`).
        if (persist !== undefined) {
          const now =
            enqueuedAt ?? (yield* Effect.clockWith((c) => c.currentTimeMillis));
          const persisted: Array<InternalItem<T>> = [];
          const priority = levelToPriority(level);
          for (const item of items) {
            const internal: InternalItem<T> = {
              item,
              entryId: nextEntryId(),
              retries,
              level,
              enqueuedAt: now,
              key: config.key !== undefined ? config.key(item) : undefined,
            };
            const result = yield* Exit.match(persist.codec.encode(item), {
              onSuccess: (payload) =>
                isJsonValue(payload)
                  ? persist.store
                      .offer({
                        id: internal.entryId,
                        key: queueName,
                        dedupKey: internal.key,
                        priority,
                        payload,
                      })
                      .pipe(
                        Effect.catch((error) =>
                          Effect.as(
                            Effect.logError(
                              `Queue "${queueName}" persist offer failed: ${String(error)}`,
                            ),
                            "deduplicated" as OfferResult,
                          ),
                        ),
                      )
                  : Effect.as(
                      Effect.logError(
                        `Queue "${queueName}" persist skipped: encoded item is not JSON-compatible`,
                      ),
                      "deduplicated" as OfferResult,
                    ),
              onFailure: (cause) =>
                Effect.as(
                  Effect.logError(
                    `Queue "${queueName}" persist encode failed: ${Cause.pretty(cause)}`,
                  ),
                  "deduplicated" as OfferResult,
                ),
            });
            if (result !== "deduplicated") persisted.push(internal);
          }
          if (persisted.length === 0) return;
          yield* publishEvent({
            _tag: "Enqueued",
            entries: persisted.map((internal) =>
              queueEntryFromInternal(internal, undefined, undefined, levelToPriority),
            ),
            priority: levelToPriority(level),
          });
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
            entryId: nextEntryId(),
            retries,
            level,
            enqueuedAt: enqueuedAt ?? (yield* Effect.clockWith((c) => c.currentTimeMillis)),
            key: config.key !== undefined ? config.key(item) : undefined,
          });
        }

        if (toEnqueue.length === 0) return;

        yield* Effect.forEach(toEnqueue, (i) => laneStore.offer(i, i.level), {
          discard: true,
        });
        yield* signalWorkerWake;

        yield* publishEvent({
          _tag: "Enqueued",
          entries: toEnqueue.map((internal) =>
            queueEntryFromInternal(internal, undefined, undefined, levelToPriority),
          ),
          priority: levelToPriority(level),
        });
      });

    /** Public enqueue: validate (when configured), then delegate to internal. */
    const enqueuePublic = (
      items: T | ReadonlyArray<T>,
      priority: Priority,
      operation: "add" | "prioritize" | "defer",
    ) =>
      Effect.flatMap(validateForEnqueue(normalizeEnqueueInput(items), operation), (validated) =>
        enqueueInternal(validated, levelOf(priority)),
      );

    const enqueueAtLevelPublic = (
      items: T | ReadonlyArray<T>,
      level: number,
    ) =>
      Effect.flatMap(validateForEnqueue(normalizeEnqueueInput(items), "add"), (validated) =>
        enqueueInternal(validated, level),
      );

    /**
     * Re-inject existing entries (the `release`/events round-trip). Reuses `enqueueInternal`
     * per entry, preserving each entry's **priority**, **attempts** (via the retry count), and
     * original **enqueuedAt**; the dedup `key` is recomputed identically by `config.key`. A new
     * `entryId` is minted (the re-injection is a fresh enqueue on this queue).
     */
    const enqueueEntries = (
      input: QueueEntry<T> | ReadonlyArray<QueueEntry<T>>,
    ): Effect.Effect<void, never, R> => {
      const entries = Array.isArray(input)
        ? (input as ReadonlyArray<QueueEntry<T>>)
        : [input as QueueEntry<T>];
      return Effect.forEach(
        entries,
        (entry) =>
          enqueueInternal(
            [entry.item],
            entry.level ?? levelOf(entry.priority),
            Math.max(0, entry.attempts - 1),
            DateTime.toEpochMillis(entry.timestamps.enqueuedAt),
          ),
        { discard: true },
      );
    };

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
            yield* enqueueInternal(validated, levelOf(priority));
          }
        });

      return {
        add: (items) => guardedEnqueue(items, "normal", "add"),
        prioritize: (items) => guardedEnqueue(items, "high", "prioritize"),
        defer: (items) => guardedEnqueue(items, "low", "defer"),
        attempts: internal.retries + 1,
        enqueuedAt: internal.enqueuedAt,
        priority: levelToPriority(internal.level),
      };
    };

    const retryInternal = (
      internal: InternalItem<T>,
      exit: Exit.Exit<A, E>,
    ): Effect.Effect<void, never, R> =>
      Effect.gen(function* () {
        const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
        const entry = queueEntryFromInternal(internal);
        if (internal.retries >= maxRetries) {
          yield* publishEvent({ _tag: "RetryExhausted", entry, cause });
          yield* Effect.logDebug(
            `Retry exhausted for item in queue "${queueName}" after ${String(internal.retries + 1)} attempts`,
          );
          return;
        }
        yield* publishEvent({
          _tag: "RetryScheduled",
          entry,
          cause,
          nextAttempt: internal.retries + 2,
        });
        yield* releaseActiveKey(internal);
        yield* enqueueInternal(
          [internal.item],
          internal.level,
          internal.retries + 1,
          internal.enqueuedAt,
        );
      });

    // ─── Internal: priority dispatch ───

    /**
     * Take the next item in strict priority order (high → normal → low).
     * If all queues are empty, blocks on the wake signal then re-polls.
     * This avoids the priority inversion that `Effect.race(take, take, take)` would cause.
     */
    const takeNext: Effect.Effect<InternalItem<T>> = Effect.gen(function* () {
      const polled = yield* laneStore.poll;
      if (Option.isSome(polled)) return polled.value;

      // All empty. If shutdown was requested there's nothing left to take (drain is complete, or
      // finishActive already discarded the queued items) — interrupt this worker so it exits.
      if (yield* Ref.get(isShutdownRef)) return yield* Effect.interrupt;
      // Otherwise wait for an enqueue/shutdown wake then re-poll in priority order.
      yield* Deferred.await(workerWakeSignal);
      return yield* takeNext;
    });

    // ─── Internal: item processing ───

    /**
     * Process a single item within the semaphore gate.
     * 1. Run user's `effect` and capture Exit
     * 2. Increment completed counter
     * 3. Release dedup key
     * 4. Publish the `Exit` / `Completed` / `Failed` events
     * 5. Auto re-enqueue on failure up to `attempts`, else log the unhandled failure
     */
    // Durable terminal hooks — no-ops when persist is off. `persistComplete` removes a finished
    // entry; `persistFail` lets the store requeue (feeder re-leases) or dead-letter at maxAttempts.
    const persistComplete = (entryId: string): Effect.Effect<void> =>
      persist === undefined
        ? Effect.void
        : persist.store
            .complete(entryId)
            .pipe(
              Effect.catch((error) =>
                Effect.logError(
                  `Queue "${queueName}" persist complete failed: ${String(error)}`,
                ),
              ),
            );
    const persistFail = (entryId: string): Effect.Effect<void> =>
      persist === undefined
        ? Effect.void
        : persist.store
            .fail(entryId, { maxAttempts: persist.maxAttempts })
            .pipe(
              Effect.asVoid,
              Effect.catch((error) =>
                Effect.logError(
                  `Queue "${queueName}" persist fail failed: ${String(error)}`,
                ),
              ),
            );
    const processItemBody = (internal: InternalItem<T>): Effect.Effect<void, never, R> =>
      Effect.gen(function* () {
          const start = yield* Effect.clockWith((c) => c.currentTimeMillis);
          const startedAt = DateTime.makeUnsafe(start);
          yield* publishEvent({
            _tag: "Started",
            entry: queueEntryFromInternal(internal, { startedAt }),
          });
          yield* Metric.update(
            inFlightGauge,
            yield* Ref.updateAndGet(inFlightRef, (n) => n + 1),
          );
          const ctx = makeEffectContext(internal);
          const exit = yield* Effect.exit(config.effect(internal.item, ctx));
          const end = yield* Effect.clockWith((c) => c.currentTimeMillis);
          const completedAt = DateTime.makeUnsafe(end);
          const elapsed = Duration.millis(end - start);

          yield* Ref.update(completedCount, (n) => n + 1);

          // Release dedup key BEFORE the auto re-enqueue below. The re-enqueue
          // must observe a free dedupe key so its `HashSet.has` check passes.
          if (config.key !== undefined && internal.key !== undefined) {
            yield* Ref.update(activeKeys, HashSet.remove(internal.key));
          }

          const entry = queueEntryFromInternal(internal, { startedAt, completedAt });
          // fan-out the worker outcome once (unconditional — observe via the `events` stream).
          // `Completed` carries the worker's typed success value (`exit.value`); `Failed` the
          // typed `Cause`. No separate `Exit` event — the two already encode success-vs-failure.
          yield* publishEvent(
            Exit.isSuccess(exit)
              ? { _tag: "Completed", entry, success: exit.value, elapsed }
              : { _tag: "Failed", entry, cause: exit.cause, elapsed },
          );
          yield* Metric.update(
            inFlightGauge,
            yield* Ref.updateAndGet(inFlightRef, (n) => Math.max(0, n - 1)),
          );

          // Failure disposition. `onFailure` (if set) decides per error; otherwise the queue's
          // default policy applies. Runs in the main fiber after the dedup key was released
          // above, so any re-enqueue's `added` correctly follows the `released` (preserving the
          // dedupe-key seq invariant).
          if (Exit.isFailure(exit)) {
            const disposition =
              config.onFailure !== undefined
                ? yield* config.onFailure(entry, exit.cause)
                : "default";
            switch (disposition) {
              case "retry":
                // Durable: the store owns retry (requeue/DLQ); in-memory: re-enqueue the lane.
                if (persist !== undefined) {
                  yield* persistFail(internal.entryId);
                } else {
                  yield* retryInternal(internal, exit);
                }
                break;
              case "deadLetter":
                yield* Effect.asVoid(
                  routePending(entry, { reason: "onFailure" }, "dead-lettered"),
                );
                yield* persistComplete(internal.entryId);
                break;
              case "drop":
                yield* Effect.asVoid(
                  routePending(entry, { reason: "onFailure" }, "dropped"),
                );
                yield* persistComplete(internal.entryId);
                break;
              case "default":
                if (autoReEnqueue) {
                  if (persist !== undefined) {
                    yield* persistFail(internal.entryId);
                  } else {
                    yield* retryInternal(internal, exit);
                  }
                } else {
                  yield* Effect.logWarning(
                    `Item failed in queue "${queueName}" (no \`attempts\` set; observe via \`events\`)`,
                  ).pipe(Effect.annotateLogs("cause", Cause.pretty(exit.cause)));
                  yield* persistComplete(internal.entryId);
                }
                break;
            }
          } else {
            // success — remove the durable entry
            yield* persistComplete(internal.entryId);
          }

          yield* wakeDrainedIfAllQueuesEmpty;
      }).pipe(
        // attribute every log emitted while processing this item (engine + user effect) to it
        Effect.annotateLogs({ "queue.entryId": internal.entryId }),
      );

    const skipRateLimitedItem = (internal: InternalItem<T>): Effect.Effect<void, never, R> =>
      Effect.gen(function* () {
        if (config.key !== undefined && internal.key !== undefined) {
          yield* Ref.update(activeKeys, HashSet.remove(internal.key));
        }
      });

    const processItem = (internal: InternalItem<T>): Effect.Effect<void, never, R> =>
      Effect.gen(function* () {
        if (rateLimitAwait !== undefined) {
          // rateLimitAwait already holds the resolved limiter — no per-item layer provide.
          const proceed = yield* rateLimitAwait(internal).pipe(
            Effect.as(true),
            Effect.catchTag("RateLimiterError", () =>
              skipRateLimitedItem(internal).pipe(Effect.as(false)),
            ),
          );
          if (!proceed) {
            // a skipped item still drains the queue — check whether shutdown can now finalize
            yield* finalizeShutdownIfDrained;
            return;
          }
        }
        yield* semaphore.withPermits(1)(processItemBody(internal));
        // item finished + inFlight decremented — if shutting down and now idle, flip to "off"
        yield* finalizeShutdownIfDrained;
      });

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
      withLogScope(logScopeTag)(
        Effect.annotateLogs(
          Effect.forever(
            Effect.gen(function* () {
              // On shutdown: `finishActive` stops pulling immediately (queued items were already
              // discarded); `drain` keeps pulling until empty, where `takeNext` interrupts. So we
              // only short-circuit here for finishActive — drain falls through to drain the queue.
              if (yield* Ref.get(isShutdownRef)) {
                if (shutdownMode === "finishActive") return yield* Effect.interrupt;
              }

              yield* latch.await;
              const internal = yield* takeNext;
              yield* latch.await;
              yield* processItem(internal);
            }),
          ),
          { "queue.worker": String(workerId) },
        ),
      );

    const autoStart = config.autoStart ?? true;
    const workersStartedRef = yield* Ref.make(false);

    // Build the rate-limiter layer ONCE into the queue scope (a Context, not a per-call Layer
    // provide) so every item shares the same limiter — and so strictEffectProvide is satisfied.
    const rateLimitContext =
      config.rateLimit === undefined
        ? undefined
        : yield* Layer.build(queueRateLimiterLayer);
    const rateLimitAwait: RateLimitAwait<T, R> | undefined =
      config.rateLimit === undefined || rateLimitContext === undefined
        ? undefined
        : yield* Effect.provide(
            acquireQueueRateLimitAwait<T, R>(
              queueName,
              config.rateLimit,
              emitRateLimitExceeded,
            ),
            rateLimitContext,
          );

    // Durable feeder: leases the top-priority available entry from the store and offers it into the
    // in-memory lanes (which drive concurrency / rate-limit / workers as usual). Blocks on a full
    // bounded lane (natural flow control); polls when the store is empty. A poisoned payload (decode
    // failure) is dropped from the store so it can't wedge the feeder.
    const feederLoop: Effect.Effect<void, never, R> | undefined =
      persist === undefined
        ? undefined
        : Effect.forever(
            Effect.gen(function* () {
              // finishActive → stop feeding at once; drain → keep feeding until the store empties.
              if (yield* Ref.get(isShutdownRef)) {
                if (shutdownMode === "finishActive") return yield* Effect.interrupt;
              }
              const taken = yield* persist.store
                .take({ key: queueName, leaseMillis: persist.leaseMillis })
                .pipe(
                  Effect.catch((error) =>
                    Effect.as(
                      Effect.logError(
                        `Queue "${queueName}" persist take failed: ${String(error)}`,
                      ),
                      Option.none<DurableEntry>(),
                    ),
                  ),
                );
              if (Option.isNone(taken)) {
                // empty + shutting down (drain) → done; otherwise idle-poll
                if (yield* Ref.get(isShutdownRef)) return yield* Effect.interrupt;
                yield* Effect.sleep(persist.pollInterval);
                return;
              }
              const entry = taken.value;
              yield* Exit.match(persist.codec.decode(entry.payload), {
                onSuccess: (item) => {
                  const level = levelOf(entry.priority);
                  return Effect.andThen(
                    laneStore.offer(
                      {
                        item,
                        entryId: entry.id,
                        retries: Math.max(0, entry.attempts - 1),
                        level,
                        enqueuedAt: entry.enqueuedAtMillis,
                        key: entry.dedupKey ?? undefined,
                      },
                      level,
                    ),
                    // wake a worker blocked in `takeNext` (offer alone doesn't signal)
                    signalWorkerWake,
                  );
                },
                onFailure: (cause) =>
                  persist.store.complete(entry.id).pipe(
                    Effect.catch(() => Effect.void),
                    Effect.andThen(
                      Effect.logError(
                        `Queue "${queueName}" persist decode failed (dropped ${entry.id}): ${Cause.pretty(cause)}`,
                      ),
                    ),
                  ),
              });
            }),
          );

    // Self-refill (optional): load work from a source on start / drain — best-effort (logged).
    const refillConfig = config.refill;
    const runRefill = (
      handle: EngineQueueHandle<T, E, EEnqueue, R, A>,
    ): Effect.Effect<void, never, R> =>
      refillConfig === undefined ? Effect.void : refillConfig.load(handle);

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

      // Reclaim work whose lease survived a previous crash/restart before feeding resumes.
      if (persist !== undefined) {
        yield* persist.store
          .recover(queueName)
          .pipe(Effect.catch(() => Effect.succeed(0)));
      }

      for (let i = 0; i < concurrency; i++) {
        yield* FiberSet.run(workerFibers)(workerLoop(i));
      }
      if (feederLoop !== undefined) {
        yield* FiberSet.run(workerFibers)(feederLoop);
      }

      yield* Effect.logDebug(
        `Queue "${queueName}" worker pool started (${String(concurrency)} workers)`,
      );
      const handle = queueHandleSlot.current;
      if (handle === undefined) {
        return yield* Effect.die(
          new Error(`Queue "${queueName}" internal error: handle not wired before drain monitor`),
        );
      }

      yield* publishEvent({ _tag: "Start", key: queueName });

      // Bootstrap refill (onStart): forked so a slow source load doesn't block startup.
      if (refillConfig?.onStart === true) {
        yield* FiberSet.run(workerFibers)(runRefill(handle));
      }

      // Drain monitor: emits `Drained` whenever pending work drains to empty.
      yield* FiberSet.run(workerFibers)(
        Effect.forever(
          Effect.gen(function* () {
            yield* Deferred.await(drainWakeSignal);

            const shutdown = yield* Ref.get(isShutdownRef);
            if (shutdown) return yield* Effect.interrupt;

            const empty = yield* handle.isEmpty.get;
            if (empty) {
              yield* Effect.logDebug(`Queue "${queueName}" drained`);
              const completed = yield* Ref.get(completedCount);
              yield* publishEvent({
                _tag: "Drained",
                key: queueName,
                completed,
              });
              // Self-refill on drain: re-poll the source (drives the self-feeding loop).
              if (refillConfig?.onDrained === true) {
                yield* runRefill(handle);
              }
            }
          }),
        ),
      );
    });

    const matchesSelector = (
      internal: InternalItem<T>,
      selector: QueueEntrySelector<T> | QueueEntry<T>,
    ): boolean => {
      if (isQueueEntry(selector)) {
        return internal.entryId === selector.entryId;
      }
      if (selector.entryId !== undefined && internal.entryId !== selector.entryId) {
        return false;
      }
      if (selector.key !== undefined && internal.key !== selector.key) {
        return false;
      }
      if (selector.item !== undefined && internal.item !== selector.item) {
        return false;
      }
      return selector.entryId !== undefined || selector.key !== undefined || selector.item !== undefined;
    };

    const releaseActiveKey = (internal: InternalItem<T>) =>
      internal.key === undefined
        ? Effect.void
        : Ref.update(activeKeys, HashSet.remove(internal.key));

    // finishActive shutdown: drain every pending lane, release their dedup keys, and emit one
    // `Dropped` event for the discarded entries (reason "shutdown"), so only in-flight items
    // remain to finish. (drain mode skips this — it processes the queued items instead.)
    const discardPendingOnShutdown: Effect.Effect<void> = Effect.gen(function* () {
      const drained = yield* laneStore.drain;
      const discarded: Array<QueueEntry<T>> = [];
      for (const internal of drained) {
        yield* releaseActiveKey(internal);
        discarded.push(queueEntryFromInternal(internal));
      }
      if (discarded.length > 0) {
        yield* publishEvent({
          _tag: "Dropped",
          key: queueName,
          entries: discarded,
          reason: "shutdown",
        });
      }
    });

    const restoreActiveKey = (internal: InternalItem<T>) =>
      internal.key === undefined
        ? Effect.void
        : Ref.update(activeKeys, HashSet.add(internal.key));

    const restorePending = (items: ReadonlyArray<InternalItem<T>>): Effect.Effect<void> =>
      Effect.gen(function* () {
        // Durable: put drained entries back into the store (where they came from), not the lanes.
        if (persist !== undefined) {
          const { codec, store } = persist;
          yield* Effect.forEach(
            items,
            (item) =>
              Exit.match(codec.encode(item.item), {
                onSuccess: (payload) =>
                  isJsonValue(payload)
                    ? store
                        .offer({
                          id: item.entryId,
                          key: queueName,
                          dedupKey: item.key,
                          priority: levelToPriority(item.level),
                          payload,
                        })
                        .pipe(Effect.asVoid, Effect.catch(() => Effect.void))
                    : Effect.void,
                onFailure: () => Effect.void,
              }),
            { discard: true },
          );
          return;
        }
        for (const item of items) {
          yield* laneStore.offer(item, item.level);
          yield* restoreActiveKey(item);
        }
        if (items.length > 0) {
          yield* signalWorkerWake;
        }
      });

    const extractPending = (
      select: (internal: InternalItem<T>) => boolean,
    ): Effect.Effect<ReadonlyArray<InternalItem<T>>> =>
      Effect.gen(function* () {
        const extracted = yield* laneStore.extractMatching(select);
        for (const item of extracted) {
          yield* releaseActiveKey(item);
        }
        return extracted;
      });

    // Durable extraction for the control verbs: pulls the matching **available** backlog out of the
    // store (in-flight/leased work is left to the workers) and decodes it back to InternalItems.
    // entryId / key selectors map to the store; an item-only selector can't match serialized rows.
    const extractPendingPersist = (
      selector?: QueueEntrySelector<T>,
    ): Effect.Effect<ReadonlyArray<InternalItem<T>>> => {
      if (persist === undefined) return Effect.succeed([]);
      const { codec, store } = persist;
      const match =
        selector === undefined
          ? ({} as { id?: string; key?: string })
          : selector.entryId !== undefined
            ? { id: selector.entryId }
            : selector.key !== undefined
              ? { key: selector.key }
              : undefined;
      if (match === undefined) return Effect.succeed([]);
      return store.drain(queueName, match).pipe(
        Effect.catch(() => Effect.succeed([] as ReadonlyArray<DurableEntry>)),
        Effect.map((entries) =>
          entries.flatMap((entry) => {
            const decoded = codec.decode(entry.payload);
            return Exit.isSuccess(decoded)
              ? [
                  {
                    item: decoded.value,
                    entryId: entry.id,
                    retries: Math.max(0, entry.attempts - 1),
                    level: levelOf(entry.priority),
                    enqueuedAt: entry.enqueuedAtMillis,
                    key: entry.dedupKey ?? undefined,
                  } satisfies InternalItem<T>,
                ]
              : [];
          }),
        ),
      );
    };

    const releasePending = (options?: QueueReleaseOptions): Effect.Effect<ReadonlyArray<QueueEntry<T>>, never, R> =>
      Effect.gen(function* () {
        const releaseId = options?.releaseId ?? nextReleaseId();
        const internals =
          persist !== undefined
            ? yield* extractPendingPersist()
            : yield* extractPending(() => true);
        const entries = internals.map((internal) =>
          queueEntryFromInternal(internal, undefined, {
            releaseId,
            attributes: options?.attributes,
          })
        );
        if (entries.length > 0) {
          yield* publishEvent({
            _tag: "Released",
            key: queueName,
            releaseId,
            entries,
          });
        }
        yield* wakeDrainedIfAllQueuesEmpty;
        return entries;
      });

    const releaseEncodedPending = (
      options?: QueueReleaseOptions,
    ): Effect.Effect<ReadonlyArray<QueueEncodedEntry>, QueueReleaseEncodingError, R> =>
      Effect.gen(function* () {
        if (encodeForRelease === undefined) {
          return yield* new QueueMissingItemSchemaError({ queue: queueName });
        }
        const releaseId = options?.releaseId ?? nextReleaseId();
        const internals =
          persist !== undefined
            ? yield* extractPendingPersist()
            : yield* extractPending(() => true);
        const encoded = yield* Effect.forEach(
          internals,
          (internal) => encodeForRelease(internal, releaseId, options?.attributes),
        ).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* restorePending(internals);
              return yield* error;
            })
          ),
        );
        if (encoded.length > 0) {
          const entries = internals.map((internal) =>
            queueEntryFromInternal(internal, undefined, {
              releaseId,
              attributes: options?.attributes,
            })
          );
          yield* publishEvent({
            _tag: "Released",
            key: queueName,
            releaseId,
            entries,
          });
        }
        yield* wakeDrainedIfAllQueuesEmpty;
        return encoded;
      });

    const routePending = (
      selector: QueueEntrySelector<T> | QueueEntry<T>,
      options: QueueRouteOptions,
      kind: "dead-lettered" | "dropped",
    ): Effect.Effect<ReadonlyArray<QueueEntry<T>>, never, R> =>
      Effect.gen(function* () {
        const internals = isQueueEntry(selector)
          ? []
          : persist !== undefined
            ? yield* extractPendingPersist(selector)
            : yield* extractPending((internal) => matchesSelector(internal, selector));
        const entries = isQueueEntry(selector)
          ? [selector]
          : internals.map((internal) =>
              queueEntryFromInternal(internal, undefined, { attributes: options.attributes })
            );
        if (entries.length > 0) {
          yield* publishEvent(
            kind === "dead-lettered"
              ? {
                  _tag: "DeadLettered",
                  key: queueName,
                  entries,
                  reason: options.reason,
                }
              : {
                  _tag: "Dropped",
                  key: queueName,
                  entries,
                  reason: options.reason,
                },
          );
        }
        yield* wakeDrainedIfAllQueuesEmpty;
        return entries;
      });

    // ─── Build public handle ───

    const queueHandle: QueueEngineHandle<T, E, EEnqueue, R, A> = {
      add: (items: T | ReadonlyArray<T>) => enqueuePublic(items, "normal", "add"),
      prioritize: (items: T | ReadonlyArray<T>) => enqueuePublic(items, "high", "prioritize"),
      defer: (items: T | ReadonlyArray<T>) => enqueuePublic(items, "low", "defer"),
      enqueue: (input: QueueEntry<T> | ReadonlyArray<QueueEntry<T>>) =>
        enqueueEntries(input),
      enqueueAtLevel: enqueueAtLevelPublic,
      levelSizes,

      // `size`/`isEmpty` are reactive Subscribables (the contract shape) — `.get` keeps the
      // authoritative one-shot computation (so internal drain reads are unchanged) and `.changes`
      // projects the live `status` stream. The toolkit adapter passes these through untouched.
      size: {
        get: totalPendingEffect,
        changes: Stream.map(
          statusSub.changes,
          (s) => s.sizes.high + s.sizes.normal + s.sizes.low,
        ),
      },

      sizes: projectedSizes,

      isEmpty: {
        get: Effect.map(levelSizes, (levels) => projection.isEmptyLevels(levels)),
        changes: Stream.map(
          statusSub.changes,
          (s) => s.sizes.high + s.sizes.normal + s.sizes.low === 0,
        ),
      },

      // Counter incremented after each item completes processing
      completed: Ref.get(completedCount),

      // Live lifecycle events — each consumer gets its own subscription
      events: Stream.fromPubSub(eventsHub),

      // Current-state snapshot — ref shape matching `Hyperlink.ref(queueStatus)` on the contract.
      status: statusSub,

      // Windowed metrics stream (dynamic windows)
      metrics: Stream.fromPubSub(metricsHub),

      start: tapLogs(forkProcessingFibers).pipe(Effect.asVoid),

      // Close latch → workers block on next iteration before taking items
      pause: latch.close.pipe(
        Effect.andThen(Ref.set(pausedRef, true)),
        Effect.andThen(refreshStatus),
        Effect.asVoid,
      ),

      // Open latch → blocked workers proceed to take + process
      resume: latch.open.pipe(
        Effect.andThen(Ref.set(pausedRef, false)),
        Effect.andThen(refreshStatus),
        Effect.asVoid,
      ),

      // Graceful shutdown: stop accepting items (phase → draining), wind down per `shutdownMode`,
      // and once empty + idle finalize to "off" (see `finalizeShutdownIfDrained`). Idempotent —
      // only the first call (running → draining) does the work.
      shutdown: tapLogs(Effect.gen(function* () {
        const previous = yield* Ref.getAndSet(phaseRef, "draining");
        if (previous !== "running") return; // already draining or off
        yield* Ref.set(isShutdownRef, true);
        const pending = yield* totalPendingEffect;
        yield* publishEvent({
          _tag: "ShutdownRequested",
          key: queueName,
          mode: shutdownMode,
          pending,
        });
        yield* Effect.logInfo(
          `Queue "${queueName}" shutting down (${shutdownMode})`,
        );
        if (shutdownMode === "finishActive") {
          // discard the queued items up front so only in-flight remain.
          yield* discardPendingOnShutdown;
        } else {
          // drain: open the latch (and clear paused) so a paused queue still drains its backlog,
          // rather than hanging in "draining" forever.
          yield* latch.open;
          yield* Ref.set(pausedRef, false);
        }
        yield* signalShutdownWake; // unblock takeNext waiters + the drain monitor
        yield* requestMetricsFlush;
        yield* refreshStatus; // snapshot now reads phase = "draining"
        yield* finalizeShutdownIfDrained; // already empty + idle? straight to "off"
      })),

      clear: tapLogs(Effect.gen(function* () {
        // Durable: the store is the truth — clear it (count = removed), then purge the stale
        // in-memory copies the feeder had leased so workers don't process them.
        if (persist !== undefined) {
          const cleared = yield* persist.store
            .clear(queueName)
            .pipe(Effect.catch(() => Effect.succeed(0)));
          // Purge the stale in-memory copies the feeder had leased (the store is the truth).
          yield* laneStore.drain;
          yield* Ref.set(completedCount, 0);
          yield* publishEvent({ _tag: "Cleared", key: queueName, count: cleared });
          yield* Effect.logDebug(
            `Queue "${queueName}" cleared ${String(cleared)} items`,
          );
          yield* wakeDrainedIfAllQueuesEmpty;
          return cleared;
        }
        const drained = yield* laneStore.drain;
        const count = drained.length;
        if (config.key !== undefined) {
          for (const internal of drained) {
            if (internal.key !== undefined) {
              yield* Ref.update(activeKeys, HashSet.remove(internal.key));
            }
          }
        }
        yield* Ref.set(completedCount, 0);
        yield* publishEvent({ _tag: "Cleared", key: queueName, count });
        yield* Effect.logDebug(`Queue "${queueName}" cleared ${String(count)} items`);
        yield* wakeDrainedIfAllQueuesEmpty;
        return count;
      })),

      release: (options) => releasePending(options),

      releaseEncoded: (options) => releaseEncodedPending(options),

      deadLetter: (selector, options) => routePending(selector, options, "dead-lettered"),

      drop: (selector, options) => routePending(selector, options, "dropped"),
    };

    queueHandleSlot.current = queueHandle;

    if (autoStart) {
      yield* tapLogs(forkProcessingFibers);
    }

    return queueHandle;
  });

// ============================================================================
// Public API
// ============================================================================

const queueHyperlinkLayerFromConfig = (
  tag: Context.Key<any, EngineQueueHandle<any, any, any, any, any>>,
  config: WorkPoolConfig<any, any, any, any>,
): Layer.Layer<any, never, any> => {
  const resourceId = config.name ?? "anonymous";
  const defaultSpec = { ...config, name: resourceId };
  return layerWithQueueRateLimiterIfNeeded(
    Layer.effect(tag)(
      foldConfiguredSpec(resourceId, defaultSpec).pipe(
        Effect.flatMap(makeQueueEffectFromConfig),
      ),
    ),
    defaultSpec,
  );
};

function queueHyperlinkLayer<
  Self,
  F extends QueueWorkerEffect<any, any, any, any>,
  O extends
    | WorkPoolOptionsWithoutItemSchema<any, any, any>
    | WorkPoolOptionsWithItemSchema<any, any, any>
    | undefined = undefined,
>(
  tag: Context.Key<Self, EngineQueueHandle<any, any, any, any>>,
  effect: F,
  options?: O,
): Layer.Layer<Self, never, InferQueueWorkerRequirements<QueueConfigFromEffect<F, O>>>;
function queueHyperlinkLayer<Self, const C extends WorkPoolConfig<any, any, any>>(
  tag: Context.Key<
    Self,
    EngineQueueHandle<
      InferQueueItem<C>,
      InferQueueWorkerError<C>,
      InferQueueEnqueueError<C>,
      InferQueueWorkerRequirements<C>
    >
  >,
  config: C,
): Layer.Layer<Self, never, InferQueueWorkerRequirements<C>>;
function queueHyperlinkLayer(
  tag: Context.Key<any, EngineQueueHandle<any, any, any, any>>,
  effectOrConfig: QueueWorkerEffect<any, any, any, any> | WorkPoolConfig<any, any, any>,
  options?: WorkPoolOptionsWithoutItemSchema<any, any, any> | WorkPoolOptionsWithItemSchema<any, any, any>,
): Layer.Layer<any, never, any> {
  if (typeof effectOrConfig === "function") {
    return queueHyperlinkLayerFromConfig(tag, { ...(options ?? {}), effect: effectOrConfig });
  }
  return queueHyperlinkLayerFromConfig(tag, effectOrConfig);
}

const queueServiceLayerFromDefaultSpec = <
  Self,
  const Name extends string,
  C extends WorkPoolConfig<any, any, any>,
  H,
>(
  base: Context.Service<Self, H>,
  resourceId: Name,
  defaultSpec: C,
  run: (config: C) => Effect.Effect<H, never, Scope.Scope | InferQueueWorkerRequirements<C>>,
): Layer.Layer<Self, never, InferQueueWorkerRequirements<C>> =>
  Layer.effect(base)(
    foldConfiguredSpec(resourceId, defaultSpec).pipe(Effect.flatMap(run)),
  );

const queueServiceConfigure = <C extends WorkPoolConfig<any, any, any>>(
  resourceId: string,
  patch: ConfigPatch<C>,
): Layer.Layer<never> => configureLayer(resourceId, patch);

const queueServiceWrapWorker = <C extends WorkPoolConfig<any, any, any>>(
  resourceId: string,
  fn: (previous: C["effect"]) => C["effect"],
): Layer.Layer<never> => configureWrapEffectField(resourceId, fn);

const queueHyperlinkServiceWithoutSchema = <
  Self,
  const Name extends string,
  const C extends WorkPoolConfigWithoutItemSchema<any, any, any>,
>(
  name: Name,
  config: C,
): WorkPoolServiceDefinition<
  Self,
  Name,
  InferQueueItem<C>,
  InferQueueWorkerError<C>,
  never,
  InferQueueWorkerRequirements<C>
> => {
  const named = { ...config, name } satisfies C & { readonly name: Name };
  const base = Context.Service<
    Self,
    EngineQueueHandle<
      InferQueueItem<C>,
      InferQueueWorkerError<C>,
      never,
      InferQueueWorkerRequirements<C>
    >
  >()(name);
  type Spec = WorkPoolConfig<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    InferQueueWorkerRequirements<C>
  >;
  type ServiceDef = WorkPoolServiceDefinition<
    Self,
    Name,
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    never,
    InferQueueWorkerRequirements<C>
  >;
  const wrapWorker: ServiceDef["wrapWorker"] = (fn) => queueServiceWrapWorker<Spec>(name, fn);
  return Object.assign(base, {
    id: name,
    kind: queueHyperlinkKind,
    tag: base,
    defaultSpec: named,
    configure: (patch: ConfigPatch<Spec>) => queueServiceConfigure(name, patch),
    wrapWorker,
    layer: layerWithQueueRateLimiterIfNeeded(
      queueServiceLayerFromDefaultSpec(
        base,
        name,
        named,
        makeQueueEffectWithoutSchema,
      ),
      named,
    ),
  }) satisfies ServiceDef;
};

const queueHyperlinkServiceWithSchema = <
  Self,
  const Name extends string,
  const C extends WorkPoolConfigWithItemSchema<any, any, any>,
>(
  name: Name,
  config: C,
): WorkPoolServiceDefinition<
  Self,
  Name,
  InferQueueItem<C>,
  InferQueueWorkerError<C>,
  QueueEnqueueErrors,
  InferQueueWorkerRequirements<C>
> => {
  const named = { ...config, name } satisfies C & { readonly name: Name };
  const base = Context.Service<
    Self,
    EngineQueueHandle<
      InferQueueItem<C>,
      InferQueueWorkerError<C>,
      QueueEnqueueErrors,
      InferQueueWorkerRequirements<C>
    >
  >()(name);
  const item = makeQueueItemCodecDescriptor(name, config.itemSchema);
  type Spec = WorkPoolConfig<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    InferQueueWorkerRequirements<C>
  >;
  type ServiceDef = WorkPoolServiceDefinition<
    Self,
    Name,
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    QueueEnqueueErrors,
    InferQueueWorkerRequirements<C>
  >;
  const wrapWorker: ServiceDef["wrapWorker"] = (fn) => queueServiceWrapWorker<Spec>(name, fn);
  return Object.assign(base, {
    id: name,
    kind: queueHyperlinkKind,
    tag: base,
    defaultSpec: named,
    configure: (patch: ConfigPatch<Spec>) => queueServiceConfigure(name, patch),
    wrapWorker,
    layer: layerWithQueueRateLimiterIfNeeded(
      queueServiceLayerFromDefaultSpec(
        base,
        name,
        named,
        makeQueueEffectWithSchema,
      ),
      named,
    ),
    item,
  }) satisfies ServiceDef;
};

// ============================================================================
// Engine flat surface
//
// The public `WorkPool` namespace (`src/WorkPool.ts`) re-exports these under their
// public names: `makeQueueEffect` → `make`, {@link Service}, {@link queueSchemaGroup} → `Schema`,
// {@link queueErrorsGroup} → `Errors`, and `queueRateLimiterLayer` → `rateLimiterLayer`.
// `queueHyperlinkLayer` / {@link Tag} are engine primitives kept for internal reuse — the public
// namespace surfaces the *contract's* `Tag` / `layer` instead. Flat exports (not an object literal)
// so `import * as WorkPool` member access tree-shakes: `WorkPool.Tag` pulls no engine code.
// ============================================================================

export { makeQueueEffect, queueHyperlinkLayer, buildQueueEngine };

/**
 * Engine class factory: creates a Context tag with a baked-in `.layer`. Surfaced publicly as
 * {@link WorkPool.Service}.
 *
 * The returned value is both a `Context.Service` (yieldable tag) and has a `.layer` property for
 * providing the queue to your program. When `itemSchema` is set, the declaration also exposes
 * {@link WorkPoolDefinition.item} for typed process-manager contracts.
 *
 * @internal
 */
export const Service = <Self, T, E = never>() => {
    // Callable surface uses overloads; runtime dispatcher is a single function + cast.
    type WorkPoolServiceFactory = {
      <
        const Name extends string,
        F extends QueueWorkerEffect<T, E, any, any>,
        O extends
          | WorkPoolOptionsWithoutItemSchema<T, E, any>
          | WorkPoolOptionsWithItemSchema<T, E, any>
          | undefined,
      >(
        name: Name,
        effect: F,
        options?: O,
      ): WorkPoolServiceDefinition<
        Self,
        Name,
        InferQueueItem<QueueConfigFromEffect<F, O>>,
        InferQueueWorkerError<QueueConfigFromEffect<F, O>>,
        InferQueueEnqueueError<QueueConfigFromEffect<F, O>>,
        NormalizeQueueRequirements<InferQueueWorkerRequirements<QueueConfigFromEffect<F, O>>>
      >;
      <const Name extends string, R>(
        name: Name,
        config: WorkPoolConfigWithoutItemSchema<T, E, R>,
      ): WorkPoolServiceDefinition<Self, Name, T, E, never, NormalizeQueueRequirements<R>>;
      <const Name extends string, R>(
        name: Name,
        config: WorkPoolConfigWithItemSchema<T, E, R>,
      ): WorkPoolServiceDefinition<Self, Name, T, E, QueueEnqueueErrors, NormalizeQueueRequirements<R>>;
    };

    const queueHyperlinkServiceImpl = (
      name: string,
      effect: QueueWorkerEffect<T, E, any, any> | WorkPoolConfig<T, E, any>,
      options?: WorkPoolOptionsWithoutItemSchema<T, E, any> | WorkPoolOptionsWithItemSchema<T, E, any>,
    ) => {
      if (typeof effect === "function") {
        if (options !== undefined && options.itemSchema !== undefined) {
          return queueHyperlinkServiceWithSchema(name, {
            ...options,
            effect,
            name,
            itemSchema: options.itemSchema,
          });
        }
        return queueHyperlinkServiceWithoutSchema(name, { ...(options ?? {}), effect, name });
      }
      if (hasItemSchema(effect)) {
        return queueHyperlinkServiceWithSchema(name, { ...effect, name });
      }
      const { itemSchema: _itemSchema, ...rest } = effect;
      return queueHyperlinkServiceWithoutSchema(name, { ...rest, name });
    };

    return queueHyperlinkServiceImpl as WorkPoolServiceFactory;
  };

/**
 * Engine identity-tag factory (no default layer). The public `WorkPool.Tag` comes from the
 * contract; this engine primitive is kept for internal reuse.
 *
 * @internal
 */
export const Tag = <Self, T, E = never, R = never>() =>
<const Name extends string>(name: Name) => {
  const base = Context.Service<Self, EngineQueueHandle<T, E, never, R>>()(name);
  return Object.assign(base, {
    id: name,
    kind: queueHyperlinkKind,
    tag: base,
  });
};

/**
 * Codec-descriptor helpers, surfaced publicly as `WorkPool.Schema`.
 *
 * @internal
 */
export const queueSchemaGroup = {
  descriptor: QueueItemCodecDescriptorSchema,
  makeDescriptor: makeQueueItemCodecDescriptor,
};

/**
 * Queue error classes, surfaced publicly as `WorkPool.Errors`.
 *
 * @internal
 */
export const queueErrorsGroup = {
  QueueItemValidationError,
  QueueBatchValidationError,
  QueueMissingItemSchemaError,
  QueueItemEncodingError,
  QueueShutdownError,
};
