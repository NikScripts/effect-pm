/**
 * **Queue contract (control surface)** — the fixed-schema half of a queue's service
 * expressed as a {@link Hyperlink} {@link Spec}, so a queue can be driven **remotely** over
 * RPC through the toolkit's location-transparent layers (the same `yield* Tag` code runs
 * local or remote; only the layer changes).
 *
 * @remarks
 * This is the first slice of porting `WorkPool` onto the toolkit. It covers the
 * **control / observation** verbs only — `size`, `sizes`, `isEmpty`, `completed`, `start`,
 * `pause`, `resume`, `shutdown`, `clear` — all of which have fixed schemas (no item type).
 *
 * The **data-plane** verbs involve the per-queue item type `T` and its `itemSchema`: the
 * enqueue verbs (`add` / `prioritize` / `defer` / `enqueue`) and the entry-returning verbs
 * (`release` / `releaseEncoded` / `deadLetter` / `drop`) are all wired. `releaseEncoded`'s
 * failure channel is the engine's encode errors, which are `Schema.TaggedErrorClass` (both
 * yieldable and wire-encodable), so they cross RPC and `catchTag` works on the client. Each
 * queue instance is its **own** resource (its own RPC group, prefixed by its id) — built by
 * {@link defineQueueTag} from the shared control spec plus per-instance data procedures
 * whose payload/result schema **is** the instance's `itemSchema`, so Effect RPC validates
 * items natively on both sides (no codec descriptor, no manual encode/decode). This is the
 * "model B / fully per-instance" approach; the shared-spec + `key`-header path
 * ({@link Hyperlink.serveInstances}) remains for resources whose contract is identical
 * across instances (e.g. Gate).
 *
 * This module is the **public `WorkPool` namespace** — the `hyperlink-ts/WorkPool`
 * subpath and the barrel `export * as WorkPool` both resolve here. The light `Tag` / spec /
 * schemas live in this file (engine-free, tree-shakeable); the heavy engine lives in
 * `./internal/workPool` and is pulled in only by the runtime verbs (`layer` / `serve` /
 * `serveRemote` / `make`). Consume it as a module namespace:
 *
 *   import * as WorkPool from "hyperlink-ts/WorkPool";
 *   class Mail extends WorkPool.Tag<Mail>()("@app/Mail", { payload: JobSchema }) {}
 *
 * @module WorkPool
 */
import { DateTime, Effect, Layer, Option, Schema, Scope, Stream } from "effect";
import * as Hyperlink from "./Hyperlink";
import { specSym } from "./Hyperlink";
import { HistoryStore } from "./HistoryStore";
import type { HistoryReadOptions, HistoryStoreShape } from "./HistoryStore";
import type {
  HandlerContextOf,
  ImplOf,
  Local,
  Method,
  MethodAnnotations,
  NodeBoundTag,
  HyperlinkTag,
} from "./Hyperlink";
import type { NodeKey } from "./Node";
// Schemas from the light module — keeps the Tag/spec path engine-free (tree-shakeable).
import {
  QueueItemCodecDescriptorSchema,
  QueueItemEncodingError,
  QueueMissingItemSchemaError,
} from "./internal/workPoolSchema";
// The engine is used only by the runtime verbs (buildQueueImpl/layer/serve/serveRemote) below.
import { makeQueueEffect } from "./internal/workPool";
import { kind } from "./internal/workPoolKind";
import { retype } from "./internal/nodeServerCommon";
import {
  successOf,
  errorOf,
  stampQueueWireSchemas,
  stampQueueItemSchema,
  itemSchemaSym,
  type QueueItemSchemaCarrier,
} from "./internal/workPoolTagSchemas";
import {
  assertQueueInstanceSpec,
  assertPriorityInstanceSpec,
} from "./internal/workPoolSpecAssert";
import * as Store from "./Store";
import { facetStoreRegistration } from "./internal/store/facetStore";
import {
  makeQueueStoreAnalyticsContract,
  materializeEngineQueueStoreForTag,
  materializeEngineQueueStoreForItem,
  type QueueStoreAnalyticsContract,
  type QueueStoreTag,
} from "./internal/store/workPoolStoreSpec";
// The priority (N-level lane) engine — pulled in only by the priority runtime verbs below.
import { makePriorityEffect } from "./internal/workPoolPriority";
import type {
  WorkPoolPriorityHandle,
  WorkPoolPriorityLaneConfig,
  WorkPoolPriorityConfig,
  WorkPoolPriorityConfigWithItemSchema,
  WorkPoolPriorityConfigWithoutItemSchema,
  WorkPoolPriorityOptionsWithItemSchema,
  WorkPoolPriorityOptionsWithoutItemSchema,
  WorkPoolPriorityStatus,
} from "./internal/workPoolPriority";

/**
 * Priority-lane engine config — namespaced short form of
 * {@link WorkPoolPriorityConfig} (`import * as WorkPool` → `WorkPool.PriorityConfig`).
 *
 * @category models
 * @public
 */
export type PriorityConfig<T, E, R> = WorkPoolPriorityConfig<T, E, R>;
/** @category models @public */
export type PriorityConfigWithItemSchema<T, E, R> = WorkPoolPriorityConfigWithItemSchema<T, E, R>;
/** @category models @public */
export type PriorityConfigWithoutItemSchema<T, E, R> =
  WorkPoolPriorityConfigWithoutItemSchema<T, E, R>;
/** @category models @public */
export type PriorityOptionsWithItemSchema<T, E, R> =
  WorkPoolPriorityOptionsWithItemSchema<T, E, R>;
/** @category models @public */
export type PriorityOptionsWithoutItemSchema<T, E, R> =
  WorkPoolPriorityOptionsWithoutItemSchema<T, E, R>;
/**
 * Priority-lane handle — namespaced short form of {@link WorkPoolPriorityHandle}.
 *
 * @category models
 * @public
 */
export type PriorityHandle<T, E = never, EEnqueue = never, R = never> = WorkPoolPriorityHandle<
  T,
  E,
  EEnqueue,
  R
>;
/** @category models @public */
export type PriorityLaneConfig = WorkPoolPriorityLaneConfig;
/**
 * Priority-lane live status snapshot — namespaced short form of {@link WorkPoolPriorityStatus}.
 * Matches the wire shape of {@link priorityStatus}.
 *
 * @category models
 * @public
 */
export type PriorityStatus = WorkPoolPriorityStatus;
import type { StoreShapes } from "./internal/store/contractDef";
import type {
  QueueEnqueue,
  QueueEnqueueErrors,
  QueueEntry,
  QueueEntrySelector,
  QueueEvent,
  QueueHandle,
  QueueMetrics,
  QueueReleaseEncodingError,
  QueueReleaseOptions,
  WorkPoolConfigWithItemSchema,
  QueueRouteOptions,
  QueueStatus,
} from "./internal/workPool";
import type { JsonValue } from "./internal/json";
import { LogEntrySchema } from "./LogEntry";
import { configureLayer, foldConfiguredSpec } from "./HyperlinkConfigure";
import type { ConfigPatch } from "./HyperlinkConfigure";

/**
 * Log entry wire schema — alias of {@link LogEntrySchema}. Per-resource logs use {@link Hyperlink.logs}.
 *
 * @category wire schemas
 * @public
 */
export const queueLogEntry = LogEntrySchema;

/**
 * The per-priority pending counts returned by `sizes`.
 *
 * @category wire schemas
 * @public
 */
export const queueSizes = Schema.Struct({
  high: Schema.Number,
  normal: Schema.Number,
  low: Schema.Number,
});

/**
 * A queue's **current-state** snapshot — the element of the `status` stream. Instantaneous
 * truth (what *is*), kept small and encodable (it crosses RPC). One snapshot a dashboard
 * atom / CLI `--watch` / TUI renders. Distinct from `events` (discrete facts) and `metrics`
 * (windowed aggregates).
 *
 * @category wire schemas
 * @public
 */
export const queueStatus = Schema.Struct({
  sizes: queueSizes,
  paused: Schema.Boolean,
  inFlight: Schema.Number,
  completed: Schema.Number,
  // lifecycle phase (orthogonal to `paused`): running → draining (on shutdown) → off (terminal).
  phase: Schema.Literals(["running", "draining", "off"]),
});

/**
 * **Windowed** queue metrics — the element of the `metrics` stream, emitted once per window.
 * Counts are per-window deltas; gauges/derived values are as-of the window end. Separate from
 * `status` (instantaneous) and `events` (discrete) because aggregates are inherently
 * time-bucketed.
 *
 * @category wire schemas
 * @public
 */
export const queueMetrics = Schema.Struct({
  windowStart: Schema.DateTimeUtc,
  windowEnd: Schema.DateTimeUtc,
  windowMillis: Schema.Number,
  // per-window counts
  enqueued: Schema.Number,
  started: Schema.Number,
  completed: Schema.Number,
  failed: Schema.Number,
  retried: Schema.Number,
  deadLettered: Schema.Number,
  dropped: Schema.Number,
  rateLimitExceeded: Schema.Number,
  // as-of window end
  inFlight: Schema.Number,
  throughputPerSec: Schema.Number,
  // average queue wait (enqueued → pickup) per priority — a lane is present only if it had
  // completions this window. Wait is per-priority because it depends on each lane's load.
  avgWaitMillis: Schema.Struct({
    high: Schema.optionalKey(Schema.Number),
    normal: Schema.optionalKey(Schema.Number),
    low: Schema.optionalKey(Schema.Number),
  }),
  // average worker execution (pickup → done), overall — ~priority-independent.
  avgExecutionMillis: Schema.optionalKey(Schema.Number),
  // average end-to-end (enqueued → done = wait + execution), overall.
  avgTotalMillis: Schema.optionalKey(Schema.Number),
});

/**
 * A queue entry's priority level.
 *
 * @category wire schemas
 * @public
 */
export const queuePriority = Schema.Literals(["high", "normal", "low"]);

/**
 * Timestamps carried by a wire {@link queueEntry}.
 *
 * @category wire schemas
 * @public
 */
export const queueEntryTimestamps = Schema.Struct({
  enqueuedAt: Schema.DateTimeUtc,
  startedAt: Schema.optionalKey(Schema.DateTimeUtc),
  completedAt: Schema.optionalKey(Schema.DateTimeUtc),
  interruptedAt: Schema.optionalKey(Schema.DateTimeUtc),
});

/**
 * Recursive structural JSON value schema — decodes to {@link JsonValue}. Used for the option
 * `attributes`, which the engine persists as JSON. `Schema.suspend` breaks the self-reference.
 *
 * @category wire schemas
 * @public
 */
export const jsonValue: Schema.Codec<JsonValue> = Schema.Union([
  Schema.Null,
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<JsonValue> => jsonValue),
  ),
  Schema.Array(Schema.suspend((): Schema.Codec<JsonValue> => jsonValue)),
]);

/**
 * Entry/encoded `attributes` — a readonly record of arbitrary values, matching the engine's
 * `{ readonly [key: string]: unknown }` on `QueueEntry` / `QueueEncodedEntry`.
 *
 * @category wire schemas
 * @public
 */
export const queueEntryAttributes = Schema.Record(Schema.String, Schema.Unknown);

/**
 * Option `attributes` — a readonly record of {@link JsonValue}, matching the engine's
 * `{ readonly [key: string]: JsonValue }` on `QueueReleaseOptions` / `QueueRouteOptions`.
 *
 * @category wire schemas
 * @public
 */
export const queueJsonAttributes = Schema.Record(Schema.String, jsonValue);

/**
 * A queue entry on the wire, parameterized by the per-instance `itemSchema`. Mirrors the
 * engine's `QueueEntry<T>`; used inside {@link queueEvent}.
 *
 * @category wire schemas
 * @public
 */
export const queueEntry = <Sch extends Schema.Top>(itemSchema: Sch) =>
  Schema.Struct({
    item: itemSchema,
    entryId: Schema.String,
    // `optional` (not `optionalKey`): the engine emits `key: undefined` explicitly when no dedup
    // key, so the wire schema must accept a present-but-undefined value (else encode fails on RPC).
    key: Schema.optional(Schema.String),
    priority: queuePriority,
    attempts: Schema.Number,
    timestamps: queueEntryTimestamps,
    // `optional` (not `optionalKey`): the engine's `release`/route paths spread metadata that may
    // hold present-but-`undefined` values, so the wire schema must accept them (else encode fails).
    batchId: Schema.optional(Schema.String),
    releaseId: Schema.optional(Schema.String),
    sourceHyperlinkId: Schema.optional(Schema.String),
    attributes: Schema.optional(queueEntryAttributes),
  });

/**
 * The **lifecycle event** union — the element of the `events` stream: discrete entry / worker
 * / queue facts. Parameterized by `itemSchema` (events carry entries) and the optional `wire`
 * slots — the worker's `success` return (on `Completed`) and its `error` failure (the
 * `Cause` on `Failed` / `RetryScheduled` / `RetryExhausted`). A `Schema` tagged union
 * (encodable; it crosses RPC) — subscribers discriminate on `_tag`.
 *
 * `success` defaults to {@link Schema.Void} and `error` to {@link Schema.Unknown} when the slot
 * is absent (the untyped / `WorkPool.priority` fallback). The worker outcome is recorded
 * **once** — `Completed` (with the typed `success`) or `Failed` (with the typed `cause`); there
 * is no separate `Exit` event (a consumer reconstructs `Exit<A, E>` from the two if needed). The
 * non-encodable `retry` affordance the old callbacks received is dropped — a subscriber holds the
 * handle to drive control.
 *
 * @public
 */
/**
 * Resolve an optional wire **success** schema to its {@link Schema.Void} default while keeping the
 * decoded type **clean**: the public overload returns the caller's `Success` (not the
 * `Success | typeof Schema.Void` union a bare `?? Schema.Void` yields, whose `["Type"]` is a deferred
 * indexed access that stops `buildQueueEvent`'s `Completed.success` from reducing under a generic
 * `Success`). Sound: a caller whose `Success` is not `typeof Schema.Void` always supplies the schema
 * (the type param is inferred from it), so the `?? Schema.Void` branch only runs when `Success` really
 * is `typeof Schema.Void`. A function-overload narrowing — no cast. @internal
 */
function withVoidDefault<Success extends Schema.Top>(
  schema: Success | undefined,
): Success;
function withVoidDefault(schema: Schema.Top | undefined): Schema.Top {
  return schema ?? Schema.Void;
}

/** Mirror of {@link withVoidDefault} for the wire **error** schema (default {@link Schema.Never}). The
 *  `Error | typeof Schema.Never` union's `["Type"]` would fold `never` away, but the *schema-value*
 *  union still defers, so the same clean-narrowing keeps `Failed.cause` a concrete `Cause<Error>`.
 *  @internal */
function withNeverDefault<Error extends Schema.Top>(
  schema: Error | undefined,
): Error;
function withNeverDefault(schema: Schema.Top | undefined): Schema.Top {
  return schema ?? Schema.Never;
}

/**
 * Build the `events` union schema with **concrete** `success` / `error` wire schemas (no defaulting
 * `??`, so `Completed.success` is exactly `Success`, no `| void` widening). This is the concrete
 * builder the spec / store / engine consume so their decoded `.Type` reduces; the defaulting
 * {@link queueEvent} overloads wrap it. @internal
 */
export const buildQueueEvent = <
  Sch extends Schema.Top,
  Success extends Schema.Top,
  Error extends Schema.Top,
>(
  itemSchema: Sch,
  successSchema: Success,
  errorSchema: Error,
) => {
  const entry = queueEntry(itemSchema);
  const entries = Schema.Array(entry);
  const cause = Schema.Cause(errorSchema, Schema.Unknown);
  return Schema.Union([
    Schema.TaggedStruct("Start", { key: Schema.String }),
    Schema.TaggedStruct("Enqueued", {
      entries,
      priority: queuePriority,
      batchId: Schema.optionalKey(Schema.String),
    }),
    Schema.TaggedStruct("Started", { entry }),
    Schema.TaggedStruct("Completed", {
      entry,
      // Pin the (clean but possibly generic) `Success` field's optionality with a single-member union
      // — an encode/decode identity (`Union([S]).Type === S["Type"]`, same wire form) whose optionality
      // is concrete. Without it a generic `Success extends Schema.Top` leaves this struct's optional-key
      // computation deferred, so the decoded union can't discriminate `Completed` member-by-member.
      // (`withVoidDefault` already kept `Success` un-widened, so this yields exactly `Success["Type"]`.)
      success: Schema.Union([successSchema]),
      elapsed: Schema.Duration,
    }),
    Schema.TaggedStruct("Failed", { entry, cause, elapsed: Schema.Duration }),
    Schema.TaggedStruct("RetryScheduled", {
      entry,
      cause,
      nextAttempt: Schema.Number,
    }),
    Schema.TaggedStruct("RetryExhausted", { entry, cause }),
    Schema.TaggedStruct("Drained", {
      key: Schema.String,
      completed: Schema.Number,
    }),
    Schema.TaggedStruct("Cleared", {
      key: Schema.String,
      count: Schema.Number,
    }),
    Schema.TaggedStruct("ShutdownRequested", {
      key: Schema.String,
      mode: Schema.Literals(["drain", "finishActive"]),
      pending: Schema.Number,
    }),
    Schema.TaggedStruct("ShutdownComplete", {
      key: Schema.String,
      completed: Schema.Number,
    }),
    Schema.TaggedStruct("Released", {
      key: Schema.String,
      releaseId: Schema.String,
      entries,
    }),
    Schema.TaggedStruct("DeadLettered", {
      key: Schema.String,
      entries,
      reason: Schema.String,
    }),
    Schema.TaggedStruct("Dropped", {
      key: Schema.String,
      entries,
      reason: Schema.String,
    }),
    Schema.TaggedStruct("RateLimitExceeded", {
      key: Schema.String,
      entry,
      limitKey: Schema.String,
      algorithm: Schema.Literals(["fixed-window", "token-bucket"]),
      outcome: Schema.Literals(["delayed", "rejected"]),
    }),
  ]);
};

/**
 * The `events` union schema for a queue item schema `Sch`, with the worker's `success` return
 * (on `Completed`) and `error` failure (the `Cause`) wire slots. `Success` decodes exactly (no
 * `| void` widening) — the source of the typed `Completed.success` (`A`) that flows to the worker
 * `effect` return type, `store.completed`, and the analytics reads. @public
 * @category models
 */
export type QueueEventSchema<
  Sch extends Schema.Top,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
> = ReturnType<typeof buildQueueEvent<Sch, Success, Error>>;

/**
 * Build the `events` union **schema** for a queue item schema `Sch` with optional `success`/`error`
 * wire slots (default {@link Schema.Void} / {@link Schema.Never}) — the runtime schema behind
 * {@link WorkPool.events}, whose decoded type is {@link QueueEventSchema}. @public
 * @category wire schemas
 */
export const queueEvent = <
  Sch extends Schema.Top,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
>(
  itemSchema: Sch,
  wire?: {
    readonly success?: Success;
    readonly error?: Error;
  },
) =>
  buildQueueEvent(
    itemSchema,
    withVoidDefault(wire?.success),
    withNeverDefault(wire?.error),
  );

/**
 * Selector for the entry-routing verbs (`deadLetter` / `drop`), parameterized by `itemSchema`
 * (it can match on `item`). Mirrors the engine's `QueueEntrySelector<T>`. Over the wire a
 * selector (typically `entryId`) identifies the target — routing a full `QueueEntry` is a local
 * convenience that reduces to its `entryId`.
 *
 * @category wire schemas
 * @public
 */
export const queueEntrySelector = <Sch extends Schema.Top>(itemSchema: Sch) =>
  Schema.Struct({
    entryId: Schema.optionalKey(Schema.String),
    // `optional` (not `optionalKey`): the engine emits `key: undefined` explicitly when no dedup
    // key, so the wire schema must accept a present-but-undefined value (else encode fails on RPC).
    key: Schema.optional(Schema.String),
    item: Schema.optionalKey(itemSchema),
  });

/**
 * Options for `release` / `releaseEncoded` (wire form of `QueueReleaseOptions`).
 *
 * @category wire schemas
 * @public
 */
export const queueReleaseOptions = Schema.Struct({
  scope: Schema.optionalKey(Schema.Literal("pendingOnly")),
  releaseId: Schema.optionalKey(Schema.String),
  attributes: Schema.optionalKey(queueJsonAttributes),
});

/**
 * Options for `deadLetter` / `drop` (wire form of `QueueRouteOptions`).
 *
 * @category wire schemas
 * @public
 */
export const queueRouteOptions = Schema.Struct({
  reason: Schema.String,
  attributes: Schema.optionalKey(queueJsonAttributes),
});

/**
 * A queue entry in **encoded / wire** form — the element returned by `releaseEncoded`. The
 * `item` is replaced by its codec descriptor and the value lives in `payload` (already
 * JSON-encoded), so an encoded entry crosses RPC without the receiver knowing the item schema.
 * Mirrors the engine's `QueueEncodedEntry`.
 *
 * @category wire schemas
 * @public
 */
export const queueEncodedEntry = Schema.Struct({
  // Encoded wire payload is JSON by construction; type it as the narrower `JsonValue` (not
  // `Schema.Unknown`) so the schema `.Type` matches the hand-authored `QueueEncodedEntry.payload`
  // (retain-narrower — the single-source-of-truth convergence, tightening the schema to the type).
  payload: jsonValue,
  item: QueueItemCodecDescriptorSchema,
  entryId: Schema.String,
  // engine-output entry: optional metadata may be present-but-`undefined` (see queueEntry).
  key: Schema.optional(Schema.String),
  priority: queuePriority,
  attempts: Schema.Number,
  timestamps: queueEntryTimestamps,
  batchId: Schema.optional(Schema.String),
  releaseId: Schema.optional(Schema.String),
  sourceHyperlinkId: Schema.optional(Schema.String),
  attributes: Schema.optional(queueEntryAttributes),
});

/**
 * The `releaseEncoded` failure channel — the wire-encodable union of the engine's encode
 * errors (now `Schema.TaggedErrorClass`, so they are both yieldable and RPC-encodable).
 *
 * @category wire schemas
 * @public
 */
export const queueReleaseEncodingError = Schema.Union([
  QueueMissingItemSchemaError,
  QueueItemEncodingError,
]);

/**
 * Payload fields for the `metrics.query` history read — newest `limit` entries within an optional
 * `[since, until]` window.
 *
 * @category wire schemas
 * @public
 */
export const historyQuery = {
  limit: Schema.optionalKey(Schema.Number),
  since: Schema.optionalKey(Schema.DateTimeUtc),
  until: Schema.optionalKey(Schema.DateTimeUtc),
};

/**
 * The queue **control + observation** contract: the fixed-schema verbs of a queue handle,
 * shared by every queue instance. The data-plane (item-typed) verbs are added in a later
 * slice. Mirrors the matching members of `WorkPool`'s `QueueHandleApi`.
 *
 * @category wire schemas
 * @public
 */
export const queueControlSpec = {
  // ── live current state — one SubscriptionRef-backed source of truth ──
  // `status` is the whole snapshot; the scalars are `Stream.map` derivations of it (SSOT). All are
  // plain reads (`p.size`) and subscribable (`Hyperlink.changes(p, (s) => s.size)`).
  status: Hyperlink.ref(queueStatus).annotate({
    description:
      "Live current-state snapshot: per-priority sizes, paused, in-flight, completed, phase.",
  }),
  size: Hyperlink.ref(Schema.Number).annotate({
    description: "Total pending items across all priority lanes.",
  }),
  isEmpty: Hyperlink.ref(Schema.Boolean).annotate({
    description: "Whether all priority queues are empty.",
  }),

  // ── lifecycle commands ──
  start: Hyperlink.effect(Schema.Void).annotate({
    description:
      "Fork the worker pool + lifecycle monitor (idempotent; no-op after shutdown).",
  }),
  pause: Hyperlink.effect(Schema.Void).annotate({
    description: "Pause processing; items can still be enqueued and accumulate.",
  }),
  resume: Hyperlink.effect(Schema.Void).annotate({
    description: "Resume processing after a pause.",
  }),
  shutdown: Hyperlink.effect(Schema.Void).annotate({
    description:
      "Permanently stop the queue (graceful): phase → draining, later enqueues dropped, " +
      "in-flight finishes, queued items drained or discarded per shutdownMode, then phase → off.",
    destructive: true,
  }),
  clear: Hyperlink.effect(Schema.Number).annotate({
    description:
      "Drain all pending items and reset the completed counter; returns the count cleared.",
    destructive: true,
  }),

  // ── observability — stream + query, paired by nesting ──
  metrics: {
    stream: Hyperlink.stream(queueMetrics).annotate({
      description:
        "Windowed metrics (per-window counts + throughput/latency) emitted once per window.",
    }),
    query: Hyperlink.effectFn(historyQuery, Schema.Array(queueMetrics)).annotate({
      description:
        "Past windowed metrics from the HistoryStore (newest `limit` within `since`/`until`); " +
        "empty unless a HistoryStore layer is provided.",
    }),
  },
};
// Note: no `satisfies Spec` — it contextually widens each method's error channel to
// `unknown`. The spec is validated (without widening) at the `Hyperlink.Tag` call site.

/**
 * Build a queue **instance** spec (model B): the shared {@link queueControlSpec} plus
 * per-instance data-plane procedures typed by `itemSchema` — the enqueue verbs (`add`,
 * `prioritize`, `defer`, `enqueue`) and the `events` stream. Pass the result to
 * {@link Hyperlink.Tag} — each instance is its own resource (its own RPC group):
 *
 * ```ts
 * class Jobs extends Hyperlink.Tag<Jobs>()("@app/Jobs", queueSpec(JobSchema)) {}
 * const q = yield* Jobs;
 * yield* q.add(aJob); // the item itself is the payload — validated against JobSchema on both sides
 * ```
 *
 * `itemSchema` becomes the rpc payload schema, so RPC validates items on the wire — the
 * client rejects bad items before the round trip and the server re-validates on decode.
 *
 * @category wire schemas
 * @public
 */
export const queueSpec = <
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
>(
  itemSchema: Schema.Struct<F>,
  wire?: { readonly success?: Success; readonly error?: Error },
) => {
  // `add`/`prioritize`/`defer` take the item **directly**, and also accept a **batch** (the
  // engine's `QueueEnqueue<T>` is `(item) | (items)`), so one call enqueues many — no N round
  // trips over RPC. The payload is `item | item[]` (a single-schema union payload); the layer
  // recovers the bare `itemSchema` from `add.payload.members[0]`.
  const itemOrItems = Schema.Union([itemSchema, Schema.Array(itemSchema)]);
  const eventSchema = buildQueueEvent(
    itemSchema,
    withVoidDefault(wire?.success),
    withNeverDefault(wire?.error),
  );
  return {
  ...queueControlSpec,
  add: Hyperlink.unsafeEffectFn<{
    (item: Hyperlink.Decoded<typeof itemSchema>): Effect.Effect<void>;
    (items: readonly Hyperlink.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
    (itemOrItems: Hyperlink.Decoded<typeof itemSchema> | readonly Hyperlink.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
  }>()(itemOrItems).annotate({
    description: "Enqueue an item (or a batch) at normal priority.",
  }),
  prioritize: Hyperlink.unsafeEffectFn<{
    (item: Hyperlink.Decoded<typeof itemSchema>): Effect.Effect<void>;
    (items: readonly Hyperlink.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
    (itemOrItems: Hyperlink.Decoded<typeof itemSchema> | readonly Hyperlink.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
  }>()(itemOrItems).annotate({
    description:
      "Enqueue an item (or a batch) at high priority (processed before normal and low).",
  }),
  defer: Hyperlink.unsafeEffectFn<{
    (item: Hyperlink.Decoded<typeof itemSchema>): Effect.Effect<void>;
    (items: readonly Hyperlink.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
    (itemOrItems: Hyperlink.Decoded<typeof itemSchema> | readonly Hyperlink.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
  }>()(itemOrItems).annotate({
    description: "Enqueue an item (or a batch) at low priority (processed after high and normal).",
  }),
  // `enqueue` takes the entry array directly (same shape `events`/`release` produce).
  enqueue: Hyperlink.effectFn(Schema.Array(queueEntry(itemSchema))).annotate({
    description:
      "Re-inject existing entries (e.g. off the events stream / a release) — each re-enters " +
      "at its own priority with its attempts preserved. The handoff / round-trip primitive.",
  }),
  release: Hyperlink.effectFn(
    { options: Schema.optionalKey(queueReleaseOptions) },
    Schema.Array(queueEntry(itemSchema)),
  ).annotate({
    description:
      "Export pending entries for handoff and remove them from this queue; returns them decoded.",
    destructive: true,
  }),
  releaseEncoded: Hyperlink.effectFn(
    { options: Schema.optionalKey(queueReleaseOptions) },
    Schema.Array(queueEncodedEntry),
    queueReleaseEncodingError,
  ).annotate({
    description:
      "Export pending entries in encoded/wire form for remote handoff (requires an itemSchema).",
    destructive: true,
  }),
  deadLetter: Hyperlink.effectFn(
    {
      selector: queueEntrySelector(itemSchema),
      options: queueRouteOptions,
    },
    Schema.Array(queueEntry(itemSchema)),
  ).annotate({
    description: "Remove pending entries matching the selector and route them to a dead letter.",
    destructive: true,
  }),
  drop: Hyperlink.effectFn(
    {
      selector: queueEntrySelector(itemSchema),
      options: queueRouteOptions,
    },
    Schema.Array(queueEntry(itemSchema)),
  ).annotate({
    description: "Remove pending entries matching the selector without preserving them.",
    destructive: true,
  }),
  events: Hyperlink.stream(eventSchema).annotate({
    description: "Discrete entry / worker / queue lifecycle events.",
  }),
  };
};

/**
 * A phantom marker intersected onto a {@link Tag} to carry the worker `success` **schema** (`A`'s
 * schema) at the type level, without touching the (invariant, RPC-facing) spec. The `layer` / `serve`
 * config and the store analytics recover `A` from here (default {@link Schema.Void}). Type-only — no
 * runtime field; the runtime `success` schema still rides the `successSym` stamp. @public
 * @category models
 */
export interface QueueSuccessCarrier<Success extends Schema.Top = typeof Schema.Void> {
  readonly [queueSuccessCarrierSym]?: Success;
}

declare const queueSuccessCarrierSym: unique symbol;

/** The worker `success` **schema** carried on a tag (via {@link QueueSuccessCarrier}). @internal */
export type QueueSuccessSchemaOf<Tag> = Tag extends QueueSuccessCarrier<infer Success>
  ? Success
  : typeof Schema.Void;

/**
 * A phantom marker intersected onto a {@link Tag} to carry the worker `error` **schema** (`E`'s
 * schema) at the type level — the mirror of {@link QueueSuccessCarrier}. The `layer` / `serve` config
 * constrains the worker's failure channel to this (default {@link Schema.Never}: no declared error →
 * the worker must be infallible, or defect). Type-only — no runtime field; the runtime `error` schema
 * rides the wire stamp. @public
 * @category models
 */
export interface QueueErrorCarrier<Error extends Schema.Top = typeof Schema.Never> {
  readonly [queueErrorCarrierSym]?: Error;
}

declare const queueErrorCarrierSym: unique symbol;

/** The worker `error` **schema** carried on a tag (via {@link QueueErrorCarrier}). @internal */
export type QueueErrorSchemaOf<Tag> = Tag extends QueueErrorCarrier<infer Error>
  ? Error
  : typeof Schema.Never;

/** The spec of a queue instance whose item is `Schema.Struct<F>` — control surface + data plane.
 *  `Success`/`Error` are the tag's declared wire slots (default `Void`/`Never`), threaded so the
 *  contract's `events` carry the real `Cause<E>` / `Completed.success` rather than erasing to the
 *  loose default. */
type QueueInstanceSpec<
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
> = ReturnType<typeof queueSpec<F, Success, Error>>;

/**
 * Define a queue **instance** in the designed form — its own RPC group (model B), item
 * type and `itemSchema` baked in:
 *
 * ```ts
 * class MyQueue extends WorkPool.Tag<MyQueue>()("@app/MyQueue", JobSchema) {}
 * // or: Tag()(key, { payload: JobSchema, success?, error? })
 * const q = yield* MyQueue;
 * yield* q.add(aJob); // the item itself is the payload — validated against JobSchema on both sides
 * ```
 *
 * `Self` is given explicitly (Effect's `()` two-stage form); the item type is inferred from
 * `itemSchema`, which becomes the rpc payload schema (native wire validation, no codec). Pass
 * `options.node` to bind the queue to a {@link Node.Tag} — the tag then carries its own
 * transport (ship only the tag; see {@link Hyperlink.client} / {@link Node.connect}).
 *
 * @public
 */
/** This contract's canonical kind — stamped on every tag so consumers (e.g. the dashboard) can
 *  classify it via {@link Hyperlink.kindOf} without sniffing the spec. @public
 *
 * @category utils
 */
export { kind };

/**
 * Config-object overload of {@link Tag}. `payload` is the item schema (required); `success` (worker
 * return) and `error` (worker failure channel) are the optional wire slots, stamped for the engine
 * + store to read as the tag SSOT. Positional `Tag()(key, payload, success?, error?)` is also valid.
 *
 * @category models
 * @public
 */
export interface QueueTagConfig<
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
> {
  readonly payload: Schema.Struct<F>;
  readonly success?: Success;
  readonly error?: Error;
  readonly description?: string;
  readonly node?: NodeKey<unknown>;
}

/** The legacy positional 3rd arg — `{ description?, node? }` — kept for the non-wire form. @internal */
interface QueueTagPositionalOptions {
  readonly description?: string;
  readonly node?: NodeKey<unknown>;
}

/** The 2nd arg is the config-object form (not a payload schema). @internal */
const isQueueTagConfig = <F extends Schema.Struct.Fields>(
  value: Schema.Struct<F> | QueueTagConfig<F, Schema.Top, Schema.Top>,
): value is QueueTagConfig<F, Schema.Top, Schema.Top> => !Schema.isSchema(value);

const materializeQueueTag = <
  Self,
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
>(
  key: string,
  resolved: {
    readonly payload: Schema.Struct<F>;
    readonly success?: Success;
    readonly error?: Error;
    readonly description?: string;
    readonly node?: NodeKey<unknown>;
  },
): HyperlinkTag<Self, QueueInstanceSpec<F, Success, Error>> &
  QueueItemSchemaCarrier<F> => {
  const wire = { success: resolved.success, error: resolved.error };
  // The wired spec carries the tag's real `success`/`error` wire slots; its type
  // (`QueueInstanceSpec<F, Success, Error>`) *is* the tag's contract, so it drives the tag type
  // directly. `assertQueueInstanceSpec` runs the runtime shape/round-trip validation (only the
  // `events` element may differ from the erased baseline) as a side effect — no boundary cast is
  // needed now that the wired type and the tag type coincide.
  const spec: QueueInstanceSpec<F, Success, Error> = queueSpec(resolved.payload, wire);
  assertQueueInstanceSpec(spec, queueSpec(resolved.payload), wire);
  const tagOptions = { description: resolved.description, kind };
  const base =
    resolved.node === undefined
      ? Hyperlink.Tag<Self>()(key, spec, tagOptions)
      : Hyperlink.Tag<Self>()(key, spec, { ...tagOptions, node: resolved.node });
  const ready = Hyperlink.withReadiness(base, (svc) =>
    Effect.map(svc.status.get, (status) => ({
      ready: status.phase === "running",
      ...(status.phase === "running"
        ? {}
        : { detail: `phase: ${status.phase}` }),
    })),
  );
  return stampQueueItemSchema(
    stampQueueWireSchemas(ready, {
      success: resolved.success,
      error: resolved.error,
    }),
    resolved.payload,
  );
};

/**
 * A queue handle — the value `yield* MyQueue` produces. The **named** compact form of a queue's
 * service (both the light `Tag` path and the engine-included `Service` path yield this one type), so
 * it hovers as `WorkPool<EmailJob>` instead of an expanded member wall; prettify-ts / the docs
 * D3 popover expand it to the full shape on demand.
 *
 * @typeParam Payload - the decoded item type (`add(item)` etc.)
 * @typeParam Success - the worker success value (`Completed.success` on {@link WorkPool.events})
 * @typeParam Error - the worker failure channel (`Failed.cause`)
 * @typeParam Requirements - the transport requirement (`never` for a local `yield*`, the `Protocol`
 *   for a remote {@link Hyperlink.client})
 *
 * @category models
 * @public
 */
export interface WorkPool<
  Payload,
  Success = void,
  Error = never,
  Requirements = never,
> {
  /** Live current-state snapshot (per-priority sizes, paused, in-flight, completed, phase). */
  readonly status: Hyperlink.Subscribable<QueueStatus>;
  /** Total pending items across all priority lanes. */
  readonly size: Hyperlink.Subscribable<number>;
  /** Whether all priority queues are empty. */
  readonly isEmpty: Hyperlink.Subscribable<boolean>;
  /** Fork the worker pool + lifecycle monitor (idempotent; no-op after shutdown). */
  readonly start: Effect.Effect<void, never, Requirements>;
  /** Pause processing; items can still be enqueued and accumulate. */
  readonly pause: Effect.Effect<void>;
  /** Resume processing after a pause. */
  readonly resume: Effect.Effect<void>;
  /** Permanently stop the queue (graceful drain). */
  readonly shutdown: Effect.Effect<void>;
  /** Drain all pending items and reset the completed counter; returns the count cleared. */
  readonly clear: Effect.Effect<number, never, Requirements>;
  /** Windowed metrics: the live `stream` plus a historical `query` (needs a HistoryStore). */
  readonly metrics: {
    readonly stream: Stream.Stream<QueueMetrics>;
    readonly query: (input: {
      readonly limit?: number;
      readonly since?: DateTime.Utc;
      readonly until?: DateTime.Utc;
    }) => Effect.Effect<ReadonlyArray<QueueMetrics>, never, Requirements>;
  };
  /** Enqueue an item (or a batch) at normal priority. */
  readonly add: QueueEnqueue<Payload, never, Requirements>;
  /** Enqueue at high priority (processed before normal and low). */
  readonly prioritize: QueueEnqueue<Payload, never, Requirements>;
  /** Enqueue at low priority (processed after high and normal). */
  readonly defer: QueueEnqueue<Payload, never, Requirements>;
  /** Re-inject existing entries (each re-enters at its own priority with attempts preserved). */
  readonly enqueue: (
    entries: ReadonlyArray<QueueEntry<Payload>>,
  ) => Effect.Effect<void, never, Requirements>;
  /** Export pending entries for handoff and remove them; returns them decoded. */
  readonly release: (input: {
    readonly options?: QueueReleaseOptions;
  }) => Effect.Effect<ReadonlyArray<QueueEntry<Payload>>, never, Requirements>;
  /** Export pending entries in encoded/wire form for remote handoff (requires an itemSchema). */
  readonly releaseEncoded: (input: {
    readonly options?: QueueReleaseOptions;
  }) => Effect.Effect<
    ReadonlyArray<Hyperlink.Decoded<typeof queueEncodedEntry>>,
    QueueReleaseEncodingError,
    Requirements
  >;
  /** Remove pending entries matching the selector and route them to a dead letter. */
  readonly deadLetter: (input: {
    readonly selector: QueueEntrySelector<Payload> | QueueEntry<Payload>;
    readonly options: QueueRouteOptions;
  }) => Effect.Effect<ReadonlyArray<QueueEntry<Payload>>, never, Requirements>;
  /** Remove pending entries matching the selector without preserving them. */
  readonly drop: (input: {
    readonly selector: QueueEntrySelector<Payload> | QueueEntry<Payload>;
    readonly options: QueueRouteOptions;
  }) => Effect.Effect<ReadonlyArray<QueueEntry<Payload>>, never, Requirements>;
  /** Discrete entry / worker / queue lifecycle events. */
  readonly events: Stream.Stream<QueueEvent<Payload, Error, Success>>;
}

/** This queue's decoded item type — the `Payload` of its {@link WorkPool} handle. @internal */
type QueueItemOf<F extends Schema.Struct.Fields> = Hyperlink.Decoded<Schema.Struct<F>>;

/**
 * The queue's {@link Hyperlink.Tag} whose service value is the **named** {@link WorkPool} handle
 * (via the `Svc` seam on {@link HyperlinkTag}), so `yield* MyQueue` hovers as
 * `WorkPool<EmailJob>` rather than the expanded `ServiceOf<…>` wall. @public
 * @category models
 */
export type QueueTag<
  Self,
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
> = HyperlinkTag<
  Self,
  QueueInstanceSpec<F, Success, Error>,
  WorkPool<QueueItemOf<F>, Success["Type"], Error["Type"]>
>;

/**
 * {@link QueueTag} for a node-bound queue (its own transport).
 *
 * @category models
 * @public
 */
export type QueueNodeBoundTag<
  Self,
  F extends Schema.Struct.Fields,
  HSelf,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
> = NodeBoundTag<
  Self,
  QueueInstanceSpec<F, Success, Error>,
  HSelf,
  WorkPool<QueueItemOf<F>, Success["Type"], Error["Type"]>
>;

/**
 * Name the built queue tag's service as {@link WorkPool}. The single, deliberate cast in this
 * module: `ServiceOf<QueueInstanceSpec<F, Success, Error>>` and
 * `WorkPool<QueueItemOf<F>, Success["Type"], Error["Type"]>` are **mutually assignable** — proven
 * bidirectionally in `test/queue-handle.test-d.ts` — but TS can't verify that equality for *generic*
 * `F` at the invariant service-`Shape` position, so the generic factory needs one assertion here.
 * Owner-approved (the alternative was a schema-field hover, not `EmailJob`). The `.test-d.ts` is the
 * soundness guard: if the shapes ever diverge, it fails the build.
 */
const nameQueueService = <
  Self,
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
>(
  tag: HyperlinkTag<Self, QueueInstanceSpec<F, Success, Error>> &
    QueueItemSchemaCarrier<F>,
): QueueTag<Self, F, Success, Error> & QueueItemSchemaCarrier<F> =>
  tag as unknown as QueueTag<Self, F, Success, Error> & QueueItemSchemaCarrier<F>;

/**
 * Define a queue as a named service {@link Tag}:
 * `class Mail extends WorkPool.Tag<Mail>()("@app/Mail", { payload: JobSchema }) {}`. The class
 * *is* the Tag — `yield* Mail` inside an Effect resolves the {@link WorkPool} handle
 * (enqueue / status / metrics), while {@link layer} provides the running queue and {@link serve}
 * exposes it over RPC. `payload` is the item schema; the {@link QueueTagConfig} overload adds
 * `success` / `error` wire schemas for the worker's result and failures.
 *
 * @public
 * @category constructors
 */
const queueTag = <Self>() => {
  function build<F extends Schema.Struct.Fields, HSelf>(
    key: string,
    payload: Schema.Struct<F>,
    options: { readonly description?: string; readonly node: NodeKey<HSelf> },
  ): QueueNodeBoundTag<Self, F, HSelf> &
    QueueSuccessCarrier<typeof Schema.Void> &
    QueueErrorCarrier<typeof Schema.Never> &
    QueueItemSchemaCarrier<F>;
  function build<
    F extends Schema.Struct.Fields,
    Success extends Schema.Top,
    Error extends Schema.Top = typeof Schema.Never,
  >(
    key: string,
    payload: Schema.Struct<F>,
    success: Success,
    error?: Error,
  ): QueueTag<Self, F, Success, Error> &
    QueueSuccessCarrier<Success> &
    QueueErrorCarrier<Error> &
    QueueItemSchemaCarrier<F>;
  function build<F extends Schema.Struct.Fields>(
    key: string,
    payload: Schema.Struct<F>,
    options?: { readonly description?: string },
  ): QueueTag<Self, F> &
    QueueSuccessCarrier<typeof Schema.Void> &
    QueueErrorCarrier<typeof Schema.Never> &
    QueueItemSchemaCarrier<F>;
  function build<F extends Schema.Struct.Fields, HSelf>(
    key: string,
    config: QueueTagConfig<F> & { readonly node: NodeKey<HSelf> },
  ): QueueNodeBoundTag<Self, F, HSelf> &
    QueueSuccessCarrier<typeof Schema.Void> &
    QueueErrorCarrier<typeof Schema.Never> &
    QueueItemSchemaCarrier<F>;
  function build<
    F extends Schema.Struct.Fields,
    Success extends Schema.Top = typeof Schema.Void,
    Error extends Schema.Top = typeof Schema.Never,
  >(
    key: string,
    config: QueueTagConfig<F, Success, Error>,
  ): QueueTag<Self, F, Success, Error> &
    QueueSuccessCarrier<Success> &
    QueueErrorCarrier<Error> &
    QueueItemSchemaCarrier<F>;
  // Implementation signature — intentionally loose (`any` wire slots): the tag's real `Success`/
  // `Error` are fixed by the overload selected above. The runtime resolves them from the config /
  // positional args below; the phantom carriers are type-only.
  function build<F extends Schema.Struct.Fields>(
    key: string,
    second: Schema.Struct<F> | QueueTagConfig<F, Schema.Top, Schema.Top>,
    third?: Schema.Top | QueueTagPositionalOptions,
    fourth?: Schema.Top,
  ): QueueTag<Self, F, any, any> &
    QueueSuccessCarrier<any> &
    QueueErrorCarrier<any> &
    QueueItemSchemaCarrier<F> {
    const resolved = isQueueTagConfig(second)
      ? {
          payload: second.payload,
          success: second.success,
          error: second.error,
          description: second.description,
          node: second.node,
        }
      : Schema.isSchema(third)
        ? {
            payload: second,
            success: third,
            error: fourth,
            description: undefined,
            node: undefined,
          }
        : {
            payload: second,
            success: undefined,
            error: undefined,
            description: third?.description,
            node: third?.node,
          };
    return nameQueueService(materializeQueueTag<Self, F, Schema.Top, Schema.Top>(key, resolved));
  }
  return build;
};

/**
 * The worker config for {@link WorkPool.layer} — the engine queue config **without**
 * `itemSchema` (the tag already carries it). The item type is the tag's `itemSchema` decoded
 * type, so `effect: (item, ctx) => …` is typed against it.
 *
 * @category models
 * @public
 */
export type QueueLayerConfig<Item, A, E, R, RR = never> = Omit<
  WorkPoolConfigWithItemSchema<Item, E, R, A>,
  "itemSchema" | "refill"
> & {
  /**
   * Optional self-refill. Its loader carries its **own** requirement `RR` — independent of the
   * worker `R` — so a refill that pulls from a source (a repository/DB service) the worker doesn't
   * use is expressible; the layer's requirement is the union `R | RR`. (Sharing one `R` would
   * intersect to `never`, since the requirement channel is contravariant.)
   *
   * `RR` is kept to `load`'s **return** only (the handle is requirement-free here) so TS infers it
   * cleanly — if `RR` also appeared on the handle parameter its variance would conflict and default
   * to `never`.
   */
  readonly refill?: {
    /** Run `load` once when the worker pool starts (bootstrap). @default false */
    readonly onStart?: boolean;
    /** Run `load` each time the queue drains to empty (re-poll the source). @default false */
    readonly onDrained?: boolean;
    /** Load + enqueue work from a source. Handle its own errors (best-effort). */
    readonly load: (
      queue: QueueHandle<Item, E, QueueEnqueueErrors, never, A>,
    ) => Effect.Effect<void, never, RR>;
  };
};

/**
 * The worker `success` value type (`A`) carried on a queue instance spec's `Success` wire schema —
 * the decoded type of the tag's `success` slot (default `void`). The layer/serve config's `effect`
 * return type and the store analytics both recover `A` from here. @internal
 */
type QueueSuccessValueOf<Success extends Schema.Top> = Success["Type"];

/**
 * The worker `error` value type (`E`) carried on a queue instance spec's `Error` wire schema — the
 * decoded type of the tag's `error` slot (default `never`). The layer/serve config's worker failure
 * channel is constrained to this. @internal
 */
type QueueErrorValueOf<Error extends Schema.Top> = Error["Type"];

/** The item-schema constraint shared by {@link layer} / {@link serve} / {@link serveRemote}. */
type QueueItemFields = Record<
  string,
  Schema.Codec<unknown, unknown, never, never>
>;

/** The `tag:` param shape shared by every queue verb ({@link buildQueueImpl} / {@link layer} /
 *  {@link serve} / {@link serveRemote} / {@link configure}): the instance's {@link HyperlinkTag} over
 *  the **threaded** {@link QueueInstanceSpec}`<F, Success, Error>` (so `events` carries the real
 *  `Cause<Error>` / `Completed.success`, matching {@link materializeQueueTag}), **plus** the
 *  worker-`success`/`error` carriers. Both are needed: the spec sits at `HyperlinkTag`'s invariant
 *  Shape position (unreliable for inference), so the covariant carriers give the verbs a stable
 *  surface to infer `Success`/`Error` from the passed tag. @internal */
type QueueTagFor<
  Self,
  F extends QueueItemFields,
  Success extends Schema.Top,
  Error extends Schema.Top,
> = HyperlinkTag<Self, QueueInstanceSpec<F, Success, Error>> &
  QueueSuccessCarrier<Success> &
  QueueErrorCarrier<Error> &
  QueueItemSchemaCarrier<F>;

/** The worker-`config:` param shape shared by every queue verb — {@link QueueLayerConfig} with the
 *  instance item type + worker-`success` value recovered from `F` / `Success`. @internal */
type QueueVerbConfig<F extends QueueItemFields, E, R, RR, Success extends Schema.Top> =
  QueueLayerConfig<Schema.Struct<F>["Type"], QueueSuccessValueOf<Success>, E, R, RR>;

/**
 * Build the live {@link QueueEngine} handle behind `tag` and map it onto the toolkit service
 * impl — the single adapter shared by the **local** layer ({@link layer}) and the **served**
 * forms ({@link serve} / {@link serveRemote}). The worker `R` is captured at build time and
 * provided to each method, so the impl requires nothing beyond the scope; the engine queue
 * `name` defaults to the tag id (telemetry attribution) unless `config.name` overrides.
 *
 * The queue spec has no {@link Hyperlink.local} members, so the resulting impl satisfies both
 * `ImplOf` (for `Hyperlink.layer` / `Hyperlink.serve`) and `ServeImplOf` (for `Hyperlink.serveRemote`).
 */
const buildQueueImpl = <
  Self,
  F extends QueueItemFields,
  R,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
>(
  tag: QueueTagFor<Self, F, Success, Error>,
  config: QueueVerbConfig<F, QueueErrorValueOf<Error>, R, RR, Success>,
) =>
  Effect.gen(function* () {
    // Item schema recovered TYPED from the tag's item-schema carrier (stamped by
    // `materializeQueueTag`) — no spec introspection, no cast.
    const itemSchema: Schema.Struct<F> = tag[itemSchemaSym];
    // Capture the FULL ambient context (worker `R` + refill `RR`): the worker effect and the
    // refill loader both run ambiently, so the captured context must cover their union.
    const context = yield* Effect.context<R | RR>();
    // Fold any `.configure` patches in context (keyed by the tag id) onto the base config — so
    // per-env overrides (concurrency / rateLimit / …) merged as layers take effect at build.
    const effectiveConfig = yield* foldConfiguredSpec<
      QueueLayerConfig<
        Schema.Struct<F>["Type"],
        QueueSuccessValueOf<Success>,
        QueueErrorValueOf<Error>,
        R,
        RR
      >
    >(tag.key, config);
    // Persist the queue's lifecycle events to its store (the observability plane). The engine records
    // through narrow, semantic writes over the engine write-extension contract: `Store.effects` builds
    // the pure recorder and `Store.catchWriteErrors` narrows each write's `StoreWriteError` out —
    // logging + swallowing a journal/IO write hiccup so a store failure never breaks the queue (an
    // encode/wiring **defect** still propagates). `Storage` (the baked-in in-memory default, or an app
    // override) is captured here and provided so the engine handle stays `Storage`-free — the exact
    // discharge point the old eager `resolveOrDie` used. It can't fail (the default materializes any
    // scope); the recorder runs at the source in `publishEvent`, so no event burst is dropped by a late
    // subscriber.
    // The engine write-extension contract's event schema is erased at the schema level (Effect's
    // `.Type` reduction can't collapse a `Schema.Union` with a *generic* success field). The typed
    // success value `A` rides the `QueueStoreWriter<Item, E, A>` surface below — its `completed`
    // takes `A`, funnelled into this contract's `unknown`-typed narrow write (A ⊆ unknown), and the
    // typed value is layered back on the decoded read side (`QueueStoreCompleted`).
    const store = yield* materializeEngineQueueStoreForTag(tag);
    // The engine treats requirements uniformly — worker + refill run under one context. The
    // toolkit splits `R` / `RR` only so inference unions them (a shared contravariant `R` would
    // intersect to `never`); here we hand the engine the combined `R | RR` config.
    // The engine handle is erased at this boundary — the deliberate, both-ways-assignable `any`
    // erasure the engine itself uses (`makeQueueEffectFromConfig` returns
    // `EngineQueueHandle<any, …>`; see its note on why `any`, not `unknown`). The engine is a pure
    // runtime detail: its members flow to/from the schema-decoded contract (`ImplOf` over the
    // location-transparent `QueueInstanceSpec<F>` baseline) without a raw↔prettified `View` mismatch
    // on the enqueue payloads, nor a generic discriminated-union reduction wall on `events`. The
    // declared worker `Success`/`Error` ride the tag's carriers and surface on the named
    // `WorkPool` handle (what `yield* Tag` reads); the worker `effect`'s own signature (via the
    // config's `QueueErrorValueOf`/`QueueSuccessValueOf`) is what constrains them at build.
    const handle = yield* makeQueueEffect<
      WorkPoolConfigWithItemSchema<
        any,
        QueueErrorValueOf<Error>,
        R | RR,
        QueueSuccessValueOf<Success>
      >
    >({
      name: tag.key,
      ...effectiveConfig,
      itemSchema,
      store,
    } as WorkPoolConfigWithItemSchema<
      any,
      QueueErrorValueOf<Error>,
      R | RR,
      QueueSuccessValueOf<Success>
    >);
    // History capture (optional): when a HistoryStore is provided, fork a fiber that appends each
    // metrics window (encoded, keyed by tag id) into the store; `metrics.query` reads it back.
    // serviceOption → no store means append is skipped and history reads return empty.
    const history = yield* Effect.serviceOption(HistoryStore);
    // Hoist both codecs once (encoders parallel to decoders): the encoder is reused per stream element
    // in the append forks below rather than reconstructed on every element.
    const encodeMetric = Schema.encodeEffect(queueMetrics);
    const decodeMetric = Schema.decodeUnknownEffect(queueMetrics);
    const metricsStreamId = `${tag.key}/metrics`;
    // WRITE-fork helper: encode each stream element and append it to the history store under `streamId`,
    // forked into the scope.
    const forkAppend = <A>(
      hist: HistoryStoreShape,
      stream: Stream.Stream<A>,
      streamId: string,
      encode: (a: A) => Effect.Effect<unknown, Schema.SchemaError>,
    ) =>
      Effect.forkScoped(
        Stream.runForEach(stream, (x) =>
          encode(x).pipe(
            Effect.flatMap((enc) => hist.append(streamId, enc)),
            Effect.orDie,
          ),
        ),
      );
    // READ helper: read `streamId` back from the history store (empty when none provided) and decode each
    // entry. Used by `metrics.query`.
    const readHistory = <A>(
      streamId: string,
      decode: (e: unknown) => Effect.Effect<A, Schema.SchemaError>,
      opts: HistoryReadOptions,
    ): Effect.Effect<ReadonlyArray<A>> =>
      Option.match(history, {
        onNone: () => Effect.succeed<ReadonlyArray<A>>([]),
        onSome: (hist) =>
          hist.read(streamId, opts).pipe(
            Effect.flatMap((arr) =>
              Effect.forEach(arr, (e) => decode(e).pipe(Effect.orDie)),
            ),
          ),
      });
    yield* Option.match(history, {
      onNone: () => Effect.void,
      onSome: (hist) => forkAppend(hist, handle.metrics, metricsStreamId, encodeMetric),
    });
    // Annotated so the method params get contextual typing from the spec (and the impl is
    // assignable to ImplOf / WireServiceOf at all three call sites — no local members here).
    // `status` is the SSOT Subscribable on the handle; scalars are mapped views of it.
    // Worker methods are built UNWRAPPED (each still carrying the worker `R | RR` in its requirement);
    // `Hyperlink.provideContext` below discharges `context` into every Effect method uniformly (a no-op
    // on the ones that carry no `R`, like pause/resume/shutdown) — a single subtractive
    // `Effect.provideContext` per method instead of any per-method wrapping — and its `ProvidedContext`
    // result strips `R` so the impl satisfies `ImplOf`. Stream / Subscribable members
    // (`status`/`size`/`isEmpty`/`*.stream`/`events`) pass through untouched.
    const impl: Hyperlink.WithRequirement<
      ImplOf<QueueInstanceSpec<F, Success, Error>>,
      R | RR
    > = {
      // Additive-only adapter (M5): the engine natively exposes the contract shape — `status`,
      // `size`/`isEmpty` (reactive Subscribables), events, enqueue verbs — so they pass straight
      // through. The adapter only *adds* cross-cutting concerns: `metrics.query` (history),
      // `orDie` on the enqueue verbs (impossible-failure → defect), and RPC wiring.
      status: handle.status,
      size: handle.size,
      isEmpty: handle.isEmpty,
      start: handle.start,
      pause: handle.pause,
      resume: handle.resume,
      shutdown: handle.shutdown,
      clear: handle.clear,
      metrics: {
        stream: handle.metrics,
        query: ({ limit, since, until }) =>
          readHistory(metricsStreamId, decodeMetric, { limit, since, until }),
      },
      // The item (or batch) IS the payload — `add`/`prioritize`/`defer` forward it straight to the
      // engine, whose `QueueEnqueue` union overload resolves `T | ReadonlyArray<T>` directly (no
      // `Array.isArray` narrowing needed). `orDie`: the engine re-validates on enqueue, but the payload
      // was already decoded/validated on the wire, so that validation failure is impossible here —
      // `orDie` turns the impossible-failure channel into a defect, keeping the impl's `E` clean.
      add: (itemOrItems) => handle.add(itemOrItems).pipe(Effect.orDie),
      prioritize: (itemOrItems) => handle.prioritize(itemOrItems).pipe(Effect.orDie),
      defer: (itemOrItems) => handle.defer(itemOrItems).pipe(Effect.orDie),
      // `enqueue` takes the full entry array directly — cast-free. The decoded wire entry
      // (`queueEntry(itemSchema).Type`) and the engine's `QueueEntry<T>` are both derived from
      // the same `Schema.Struct<F>["Type"]` for `item`, so they unify here with no bridge cast.
      enqueue: (entries) => handle.enqueue(entries),
      release: ({ options }) => handle.release(options),
      releaseEncoded: ({ options }) => handle.releaseEncoded(options),
      deadLetter: ({ selector, options }) =>
        handle.deadLetter(selector, options),
      drop: ({ selector, options }) => handle.drop(selector, options),
      events: handle.events,
    };
    return Hyperlink.driver(tag, impl, context);
  });

/**
 * The **local** layer for a toolkit queue instance: run the live {@link QueueEngine} behind the
 * tag's contract. It builds the engine handle in a scope and maps it onto the toolkit service
 * (location-transparent — the same `yield* Tag` then drives the queue locally, or remotely via
 * {@link Hyperlink.client} when served).
 *
 * The tag carries the `itemSchema` (recovered from its spec), so the config only supplies the
 * worker (`effect`, `concurrency`, `attempts`, `onFailure`, …). The worker `R` is captured at
 * layer-build time and provided to each method, so the resulting service requires nothing
 * beyond `R` (which the layer itself requires).
 *
 * The enqueue verbs (`add`/`prioritize`/`defer`) re-validate the item in the engine; over RPC
 * the payload was already validated against `itemSchema`, so that re-validation cannot fail —
 * its error is therefore `orDie`d to match the contract's no-error enqueue channel.
 *
 * @public
 */
/**
 * Satisfy {@link Store.Storage} with the ephemeral default and export it for readback.
 * Prefer {@link layer} + `Layer.provide(AppStore.layer…)`. @internal
 */
const withDefaultMemory = <A, E, R>(
  layer: Layer.Layer<A, E, R | Store.Storage>,
): Layer.Layer<A | Store.Storage, E, R> => Store.withDefaultStorage(layer);

/**
 * Local queue layer — soft-defaults {@link Store.Storage} (R fulfilled). Override with
 * `WorkPool.layer(…).pipe(Layer.provideMerge(AppStore.layer…))`.
 *
 * @category layers & serving
 * @public
 */
// ============================================================================
// Priority (N-level lane) variant — WorkPool.priority
//
// Folded from the former WorkPoolPriority module: the leveled tag/spec/schemas + the
// `buildPriorityImpl` builder. The runtime verbs (layer/serve/serveRemote) below dispatch to
// this builder when the tag is a priority tag (see priorityKind); the engine lives in
// ./internal/workPoolPriority and is pulled in only by those verbs.
// ============================================================================

/**
 * Per-lane pending counts keyed by configured name (or `"0"`, `"1"`, …).
 *
 * @category wire schemas
 * @public
 */
export const prioritySizes = Schema.Record(Schema.String, Schema.Number);

/**
 * Priority-queue current-state snapshot — element of the `status` stream.
 *
 * @category wire schemas
 * @public
 */
export const priorityStatus = Schema.Struct({
  sizes: prioritySizes,
  paused: Schema.Boolean,
  inFlight: Schema.Number,
  completed: Schema.Number,
  phase: Schema.Literals(["running", "draining", "off"]),
});

/**
 * Level argument on the wire — numeric lane index or a name from the tag's
 * `namedLanes` registry (when declared at tag construction).
 *
 * @category wire schemas
 * @public
 */
export const priorityLane = (
  namedLanes?: Readonly<Record<string, number>>,
): Schema.Schema<number | string> => {
  const names =
    namedLanes === undefined ? [] : Object.keys(namedLanes).filter((n) => n.length > 0);
  return names.length === 0
    ? Schema.Union([Schema.Number, Schema.String])
    : Schema.Union([
        Schema.Number,
        Schema.Literals(names as [string, ...string[]]),
      ]);
};

/**
 * Priority queue entry on the wire — like {@link queueEntry} plus optional numeric `level`.
 *
 * @category wire schemas
 * @public
 */
export const priorityEntry = <Sch extends Schema.Top>(
  itemSchema: Sch,
) =>
  Schema.Struct({
    item: itemSchema,
    entryId: Schema.String,
    key: Schema.optional(Schema.String),
    priority: queuePriority,
    lane: Schema.optional(Schema.Number),
    attempts: Schema.Number,
    timestamps: queueEntryTimestamps,
    batchId: Schema.optional(Schema.String),
    releaseId: Schema.optional(Schema.String),
    sourceHyperlinkId: Schema.optional(Schema.String),
    attributes: Schema.optional(queueEntryAttributes),
  });

/**
 * Selector for priority-queue routing verbs.
 *
 * @category wire schemas
 * @public
 */
export const priorityEntrySelector = <Sch extends Schema.Top>(itemSchema: Sch) =>
  Schema.Struct({
    entryId: Schema.optionalKey(Schema.String),
    key: Schema.optional(Schema.String),
    item: Schema.optionalKey(itemSchema),
  });

/** Total pending across all lanes — the `size`/`isEmpty` `value`s derive from `status.sizes`. @internal */
const sumLaneSizes = (sizes: Record<string, number>): number =>
  Object.values(sizes).reduce((a, b) => a + b, 0);

/**
 * Shared control + observation contract for every priority-queue instance.
 *
 * @category wire schemas
 * @public
 */
export const priorityControlSpec = {
  // ── live current state — one SubscriptionRef-backed source of truth ──
  // `status` is the whole snapshot; `size`/`isEmpty` are `Stream.map` derivations of it (SSOT). Plain
  // reads (`p.size`) and subscribable (`Hyperlink.changes(p, (s) => s.size)`).
  status: Hyperlink.ref(priorityStatus).annotate({
    description:
      "Live current-state snapshot: per-lane sizes, paused, in-flight, completed, phase.",
  }),
  size: Hyperlink.ref(Schema.Number).annotate({
    description: "Total pending items across all lanes.",
  }),
  isEmpty: Hyperlink.ref(Schema.Boolean).annotate({
    description: "Whether all lanes are empty.",
  }),
  // stays `effect`: the raw per-index array isn't in the named-Record `status.sizes`, so it can't be a
  // reliable `Stream.map` of `status` — an on-demand pull is the honest shape.
  levelSizes: Hyperlink.effect(Schema.Array(Schema.Number)).annotate({
    description: "Raw per-lane occupancy (`levelSizes[i]` = count at lane `i`).",
  }),

  // ── lifecycle commands ──
  start: Hyperlink.effect(Schema.Void).annotate({
    description:
      "Fork the worker pool + lifecycle monitor (idempotent; no-op after shutdown).",
  }),
  pause: Hyperlink.effect(Schema.Void).annotate({
    description: "Pause processing; items can still be enqueued and accumulate.",
  }),
  resume: Hyperlink.effect(Schema.Void).annotate({
    description: "Resume processing after a pause.",
  }),
  shutdown: Hyperlink.effect(Schema.Void).annotate({
    description:
      "Permanently stop the queue (graceful): phase → draining, later enqueues dropped, " +
      "in-flight finishes, queued items drained or discarded per shutdownMode, then phase → off.",
    destructive: true,
  }),
  clear: Hyperlink.effect(Schema.Number).annotate({
    description:
      "Drain all pending items and reset the completed counter; returns the count cleared.",
    destructive: true,
  }),

  // ── observability — stream + query, paired by nesting ──
  metrics: {
    stream: Hyperlink.stream(queueMetrics).annotate({
      description:
        "Windowed metrics (per-window counts + throughput/latency) emitted once per window.",
    }),
    query: Hyperlink.effectFn(historyQuery, Schema.Array(queueMetrics)).annotate({
      description:
        "Past windowed metrics from the HistoryStore; empty unless HistoryStore is provided.",
    }),
  },
};

/** Lane config for a priority queue tag. @internal */
type PriorityTagLaneConfig = WorkPoolPriorityLaneConfig;

/**
 * Build a priority-queue **instance** spec: shared {@link priorityControlSpec} plus
 * per-instance data-plane procedures typed by `itemSchema`.
 *
 * @category wire schemas
 * @public
 */
export const prioritySpec = <F extends Schema.Struct.Fields>(
  itemSchema: Schema.Struct<F>,
  laneConfig: WorkPoolPriorityLaneConfig,
  wire?: { readonly success?: Schema.Top; readonly error?: Schema.Top },
) => {
  const itemOrItems = Schema.Union([itemSchema, Schema.Array(itemSchema)]);
  const level = priorityLane(laneConfig.namedLanes);
  const entry = priorityEntry(itemSchema);
  const eventSchema = buildQueueEvent(
    itemSchema,
    wire?.success ?? Schema.Void,
    wire?.error ?? Schema.Unknown,
  );
  return {
    ...priorityControlSpec,
    add: Hyperlink.mutatePair(Schema.Void, itemOrItems, Schema.optional(level)).annotate({
      description:
        "Enqueue an item (or batch) at an optional lane — numeric index or configured name.",
    }),
    enqueue: Hyperlink.effectFn(Schema.Array(entry)).annotate({
      description:
        "Re-inject existing entries — each re-enters at its own level with attempts preserved.",
    }),
    release: Hyperlink.effectFn(
      { options: Schema.optionalKey(queueReleaseOptions) },
      Schema.Array(entry),
    ).annotate({
      description:
        "Export pending entries for handoff and remove them from this queue.",
      destructive: true,
    }),
    releaseEncoded: Hyperlink.effectFn(
      { options: Schema.optionalKey(queueReleaseOptions) },
      Schema.Array(queueEncodedEntry),
      queueReleaseEncodingError,
    ).annotate({
      description: "Export pending entries in encoded/wire form for remote handoff.",
      destructive: true,
    }),
    deadLetter: Hyperlink.effectFn(
      {
        selector: priorityEntrySelector(itemSchema),
        options: queueRouteOptions,
      },
      Schema.Array(entry),
    ).annotate({
      description: "Remove pending entries matching the selector and route to dead letter.",
      destructive: true,
    }),
    drop: Hyperlink.effectFn(
      {
        selector: priorityEntrySelector(itemSchema),
        options: queueRouteOptions,
      },
      Schema.Array(entry),
    ).annotate({
      description: "Remove pending entries matching the selector without preserving them.",
      destructive: true,
    }),
    events: Hyperlink.stream(eventSchema).annotate({
      description: "Discrete entry / worker / queue lifecycle events.",
    }),
  };
};

type PriorityPairAnnotations = MethodAnnotations & { readonly callStyle: "pair" };

/**
 * Wire `add` member — tuple payload surfaced as `add(item, lane?)`.
 *
 * @category models
 * @public
 */
export type PriorityAddMethod = Method<
  Schema.Tuple<readonly [Schema.Top, Schema.Top]>,
  Schema.Void,
  Schema.Never,
  false,
  PriorityPairAnnotations
>;

/**
 * Full priority-queue instance contract for `itemSchema` `F`.
 *
 * @category models
 * @public
 */
export type PriorityInstanceSpec<F extends Schema.Struct.Fields> = Omit<
  ReturnType<typeof prioritySpec<F>>,
  "add"
> & {
  readonly add: PriorityAddMethod;
};

/** This contract's canonical kind — stamped on every tag so consumers (e.g. the dashboard) can
 *  classify it via {@link Hyperlink.kindOf} without sniffing the spec. */
export const priorityKind = "hyperlink-ts/WorkPool/priority";

/**
 * `WorkPool.priority` tag config — **config object only** (no positional schemas). `payload` is the
 * item schema; `laneCount` is the number of priority lanes; `namedLanes` maps names → lane indices.
 * Optional `success` / `error` wire slots match {@link WorkPool.Tag} (stamped for engine + store).
 *
 * @category models
 * @public
 */
export interface PriorityTagConfig<
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
> {
  readonly payload: Schema.Struct<F>;
  readonly laneCount: number;
  readonly namedLanes?: Readonly<Record<string, number>>;
  readonly success?: Success;
  readonly error?: Schema.Top;
  readonly description?: string;
  readonly node?: NodeKey<unknown>;
}

/**
 * Define an N-level managed queue as a named service {@link Tag} (also exported as
 * {@link priority}): `class Jobs extends WorkPool.priority<Jobs>()("@app/Jobs", { … }) {}`.
 * The **priority (N-level lane)** peer of {@link Tag} — same WorkPool, with `laneCount` /
 * `namedLanes` priority lanes and `add(item, lane?)`. `class Jobs extends
 * WorkPool.priority<Jobs>()("@app/Jobs", { payload, laneCount: 2 }) {}`. The class *is* the Tag —
 * `yield* Jobs` resolves the handle, {@link layer} provides it and {@link serve} exposes it over RPC
 * (both dispatch to the leveled engine for a priority tag). `payload` is the item schema; optional
 * `success` / `error` add the worker wire schemas.
 *
 * @public
 * @category constructors
 */
export const priority = <Self>() => {
  function build<
    F extends Schema.Struct.Fields,
    Success extends Schema.Top,
    HSelf,
  >(
    key: string,
    config: PriorityTagConfig<F, Success> & { readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, PriorityInstanceSpec<F>, HSelf>;
  function build<
    F extends Schema.Struct.Fields,
    Success extends Schema.Top = typeof Schema.Void,
  >(
    key: string,
    config: PriorityTagConfig<F, Success>,
  ): HyperlinkTag<Self, PriorityInstanceSpec<F>>;
  function build<F extends Schema.Struct.Fields, Success extends Schema.Top>(
    key: string,
    config: PriorityTagConfig<F, Success>,
  ): HyperlinkTag<Self, PriorityInstanceSpec<F>> {
    const laneConfig: PriorityTagLaneConfig = {
      laneCount: config.laneCount,
      namedLanes: config.namedLanes ?? {},
    };
    const wire = { success: config.success, error: config.error };
    const spec = assertPriorityInstanceSpec<F>(
      prioritySpec(config.payload, laneConfig, wire),
      prioritySpec(config.payload, laneConfig),
      wire,
    );
    const base =
      config.node === undefined
        ? Hyperlink.Tag<Self>()(key, spec, { description: config.description, kind: priorityKind })
        : Hyperlink.Tag<Self>()(key, spec, {
            description: config.description,
            kind: priorityKind,
            node: config.node,
          });
    const ready = Hyperlink.withReadiness(base, (svc) =>
      Effect.map(svc.status.get, (status) => ({
        ready: status.phase === "running",
        ...(status.phase === "running"
          ? {}
          : { detail: `phase: ${status.phase}` }),
      })),
    );
    return stampQueueWireSchemas(ready, {
      success: config.success,
      error: config.error,
    });
  }
  return build;
};

/**
 * Worker/layer config for a toolkit priority queue (tag carries `itemSchema`).
 *
 * @category models
 * @public
 */
export type PriorityLayerConfig<A, E, R, RR = never> = Omit<
  WorkPoolPriorityConfigWithItemSchema<A, E, R>,
  "itemSchema" | "refill" | "name"
> & {
  readonly refill?: {
    readonly onStart?: boolean;
    readonly onDrained?: boolean;
    readonly load: (
      queue: WorkPoolPriorityHandle<A, E, QueueEnqueueErrors, never>,
    ) => Effect.Effect<void, never, RR>;
  };
};

type PriorityItemFields = Record<
  string,
  Schema.Codec<unknown, unknown, never, never>
>;

const itemSchemaFromPriorityAdd = <F extends Schema.Struct.Fields>(
  addPayload: PriorityInstanceSpec<F>["add"]["payload"],
): Schema.Struct<F> => {
  const tuple = addPayload as unknown as {
    readonly elements: ReadonlyArray<{
      readonly members: ReadonlyArray<Schema.Struct<F>>;
    }>;
  };
  return tuple.elements[0]!.members[0]!;
};

const buildPriorityImpl = <Self, F extends PriorityItemFields, E, R, RR = never>(
  tag: HyperlinkTag<Self, PriorityInstanceSpec<F>>,
  config: PriorityLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Effect.Effect<
  Hyperlink.Driver<PriorityInstanceSpec<F>, R | RR>,
  never,
  R | RR | Scope.Scope | Store.Storage
> =>
  Effect.gen(function* () {
    // `specSym` holds the flat spec (opaque leaf types) at runtime — recover the precise `add` payload
    // at this introspection boundary.
    const addMethod = tag[specSym].add as unknown as {
      readonly payload: PriorityInstanceSpec<F>["add"]["payload"];
    };
    const itemSchema: Schema.Codec<Schema.Struct<F>["Type"], unknown, never, never> =
      itemSchemaFromPriorityAdd(addMethod.payload);
    const context = yield* Effect.context<R | RR>();
    const effectiveConfig = yield* foldConfiguredSpec<
      PriorityLayerConfig<Schema.Struct<F>["Type"], E, R, RR>
    >(tag.key, config);
    const store = yield* materializeEngineQueueStoreForItem(tag.key, itemSchema, {
      success: successOf(tag),
      error: errorOf(tag),
    });
    const handle = yield* makePriorityEffect({
      name: tag.key,
      ...effectiveConfig,
      itemSchema,
      store,
    } as WorkPoolPriorityConfigWithItemSchema<Schema.Struct<F>["Type"], E, R | RR>);

    const history = yield* Effect.serviceOption(HistoryStore);
    const decodeMetric = Schema.decodeUnknownEffect(queueMetrics);
    const metricsStreamId = `${tag.key}/metrics`;
    yield* Option.match(history, {
      onNone: () => Effect.void,
      onSome: (store) =>
        Effect.forkScoped(
          Stream.runForEach(handle.metrics, (m) =>
            Schema.encodeEffect(queueMetrics)(m).pipe(
              Effect.flatMap((enc) => store.append(metricsStreamId, enc)),
              Effect.orDie,
            ),
          ),
        ),
    });

    // `status` is the SSOT Subscribable on the handle; scalars are mapped views of it.
    // Worker methods are built unwrapped (each still carrying `R | RR`); `grantLocal` / wire invoke
    // discharge `context` into every Effect method uniformly — same bundle pattern as WorkPool.
    const impl: Hyperlink.WithRequirement<
      ImplOf<PriorityInstanceSpec<F>>,
      R | RR
    > = {
      status: handle.status,
      size: Hyperlink.mapSubscribable(handle.status, (s) => sumLaneSizes(s.sizes)),
      isEmpty: Hyperlink.mapSubscribable(handle.status, (s) => sumLaneSizes(s.sizes) === 0),
      levelSizes: handle.levelSizes,
      start: handle.start,
      pause: handle.pause,
      resume: handle.resume,
      shutdown: handle.shutdown,
      clear: handle.clear,
      metrics: {
        stream: handle.metrics,
        query: ({ limit, since, until }) =>
          Option.match(history, {
            onNone: () => Effect.succeed<ReadonlyArray<typeof queueMetrics.Type>>([]),
            onSome: (store) =>
              store.read(metricsStreamId, { limit, since, until }).pipe(
                Effect.flatMap((arr) =>
                  Effect.forEach(arr, (e) => decodeMetric(e).pipe(Effect.orDie)),
                ),
              ),
          }),
      },
      add: ((
        itemOrItems: Schema.Struct<F>["Type"] | ReadonlyArray<Schema.Struct<F>["Type"]>,
        lane?: number | string,
      ) => handle.add(itemOrItems, lane).pipe(Effect.orDie)) as Hyperlink.WithRequirement<
        ImplOf<PriorityInstanceSpec<F>>,
        R | RR
      >["add"],
      enqueue: (entries) => handle.enqueue(entries),
      release: ({ options }) => handle.release(options),
      releaseEncoded: ({ options }) => handle.releaseEncoded(options),
      deadLetter: ({ selector, options }) =>
        handle.deadLetter(selector, options),
      drop: ({ selector, options }) => handle.drop(selector, options),
      events: handle.events,
    };
    return Hyperlink.driver(tag, impl, context);
  });

/** A WorkPool tag — plain or {@link priority} — the runtime verbs dispatch over by kind. @internal */
type AnyPoolTag =
  | QueueTagFor<unknown, QueueItemFields, Schema.Top, Schema.Top>
  | HyperlinkTag<unknown, PriorityInstanceSpec<PriorityItemFields>>;

/** True when `tag` was minted by {@link priority} — routes to the leveled engine. @internal */
const isPriorityTag = (
  tag: AnyPoolTag,
): tag is HyperlinkTag<unknown, PriorityInstanceSpec<PriorityItemFields>> =>
  Hyperlink.kindOf(tag) === priorityKind;

// The runtime verbs are overloaded (plain tag / priority tag) and dispatch on {@link isPriorityTag}.
// The type guard narrows the TAG inside each branch, so build + wrap stay within the narrowed spec;
// only `config` needs a contained assert — TS can't correlate a second parameter through a guard on
// the first, and the queue engine already carries the same assertions at its spec boundaries.

/**
 * Run this WorkPool **locally** — soft-defaults {@link Store.Storage} (R fulfilled; override by
 * providing an app store into this layer). Accepts a plain {@link Tag} or a {@link priority} tag and
 * dispatches to the matching engine. {@link layerMemory} is an alias for the same soft-default.
 *
 * @category layers & serving
 * @public
 */
export function layer<
  Self,
  F extends QueueItemFields = QueueItemFields,
  R = never,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
>(
  tag: QueueTagFor<Self, F, Success, Error>,
  config: QueueVerbConfig<F, QueueErrorValueOf<Error>, R, RR, Success>,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R | RR>;
export function layer<
  Self,
  F extends PriorityItemFields = PriorityItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, PriorityInstanceSpec<F>>,
  config: PriorityLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R | RR>;
export function layer(
  tag: AnyPoolTag,
  config: unknown,
): Layer.Layer<unknown, never, unknown> {
  return isPriorityTag(tag)
    ? withDefaultMemory(
        Layer.unwrap(
          Effect.map(
            buildPriorityImpl(
              tag,
              config as PriorityLayerConfig<Schema.Struct<PriorityItemFields>["Type"], never, never, never>,
            ),
            (built) => Hyperlink.layer(tag, Hyperlink.grantLocal(tag, built)),
          ),
        ),
      )
    : withDefaultMemory(
        Layer.unwrap(
          Effect.map(
            buildQueueImpl(tag, config as QueueVerbConfig<QueueItemFields, unknown, never, never, Schema.Top>),
            (built) => Hyperlink.layer(tag, Hyperlink.grantLocal(tag, built)),
          ),
        ),
      );
}

/**
 * Alias of {@link layer}.
 *
 * @category layers & serving
 * @public
 */
export const layerMemory = layer;

/**
 * Serve this queue **remotely (served-only)** — run the worker / refill / `persist`
 * engine behind the tag, mount its RPC handlers, and register into {@link Hyperlink.servedHyperlinksLayer},
 * **without** granting the local instance (no `yield* Tag` in the serving process). The engine's worker
 * requirement `R` is **preserved**, so a per-resource `Layer.provide` discharges it in isolation — the
 * queue's counterpart to {@link Hyperlink.serveRemote}.
 *
 * Reach for this (with {@link Node.httpServer}) for a pure gateway/edge that exposes the queue for
 * remote clients but never consumes it locally; use {@link serve} when the serving node also drives it.
 *
 * ```ts
 * Node.httpServer([
 *   WorkPool.serveRemote(RosterImportQueue, rosterCfg).pipe(Layer.provide(emptyHookSource)),
 *   WorkPool.serveRemote(MediaImportQueue,  mediaCfg).pipe(Layer.provide(emptyHookSource)),
 * ]).pipe(Layer.provide(NodeHttpServer.layer(() => createServer(), { port })));
 * ```
 *
 * @category layers & serving
 * @public
 */
export function serveRemote<
  Self,
  F extends QueueItemFields = QueueItemFields,
  R = never,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
>(
  tag: QueueTagFor<Self, F, Success, Error>,
  config: QueueVerbConfig<F, QueueErrorValueOf<Error>, R, RR, Success>,
): Layer.Layer<HandlerContextOf<QueueInstanceSpec<F>>, never, R | RR>;
export function serveRemote<
  Self,
  F extends PriorityItemFields = PriorityItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, PriorityInstanceSpec<F>>,
  config: PriorityLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Layer.Layer<HandlerContextOf<PriorityInstanceSpec<F>>, never, R | RR>;
export function serveRemote(tag: AnyPoolTag, config: unknown): Layer.Any {
  // Factory retypes for Driver→Layer `R` — closed channels in the middle, Layer.Any at the edge.
  const serveRemoteDriver = retype<
    (tag: AnyPoolTag, impl: unknown) => Layer.Layer<never, never, never>
  >(Hyperlink.serveRemote as never);
  const unwrapLayer = retype<(effect: never) => Layer.Layer<never, never, never>>(
    Layer.unwrap as never,
  );
  const withMem = retype<(layer: never) => Layer.Any>(withDefaultMemory as never);
  return isPriorityTag(tag)
    ? withMem(
        unwrapLayer(
          Effect.map(
            buildPriorityImpl(
              tag,
              config as PriorityLayerConfig<Schema.Struct<PriorityItemFields>["Type"], never, never, never>,
            ),
            (built) => serveRemoteDriver(tag, built),
          ) as never,
        ) as never,
      )
    : withMem(
        unwrapLayer(
          Effect.map(
            buildQueueImpl(tag, config as QueueVerbConfig<QueueItemFields, unknown, never, never, Schema.Top>),
            (built) => serveRemoteDriver(tag, built),
          ) as never,
        ) as never,
      );
}

/**
 * Alias of {@link serveRemote}.
 *
 * @category layers & serving
 * @public
 */
export const serveRemoteMemory = serveRemote;

/**
 * Serve this queue **and** grant its local instance from **one** materialization — run the worker /
 * refill / `persist` engine behind the tag, mount its RPC handlers, register into
 * {@link Hyperlink.servedHyperlinksLayer}, **and** grant `Self | Local<Self>` so co-located code
 * can `yield* Tag`. The served cells *are* the in-process instance (one engine, one `peersLayer`); the
 * worker requirement `R` is preserved for per-resource `Layer.provide`. This is the queue's counterpart
 * to {@link Hyperlink.serve}; a served-**only** gateway uses {@link serveRemote}.
 *
 * ```ts
 * Node.httpServer([
 *   WorkPool.serve(RosterQueue, { effect, itemSchema }),
 *   Daemon.serve(SeasonMatches, { effect }),
 * ]).pipe(Layer.provide(NodeHttpServer.layer({ port: 3001 })));
 * ```
 *
 * @category layers & serving
 * @public
 */
export function serve<
  Self,
  F extends QueueItemFields = QueueItemFields,
  R = never,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
>(
  tag: QueueTagFor<Self, F, Success, Error>,
  config: QueueVerbConfig<F, QueueErrorValueOf<Error>, R, RR, Success>,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<QueueInstanceSpec<F>> | Store.Storage,
  never,
  R | RR
>;
export function serve<
  Self,
  F extends PriorityItemFields = PriorityItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, PriorityInstanceSpec<F>>,
  config: PriorityLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<PriorityInstanceSpec<F>> | Store.Storage,
  never,
  R | RR
>;
export function serve(tag: AnyPoolTag, config: unknown): Layer.Layer<unknown, never, unknown> {
  return isPriorityTag(tag)
    ? withDefaultMemory(
        Layer.unwrap(
          Effect.map(
            buildPriorityImpl(
              tag,
              config as PriorityLayerConfig<Schema.Struct<PriorityItemFields>["Type"], never, never, never>,
            ),
            (built) => Hyperlink.serve(tag, built),
          ),
        ),
      )
    : withDefaultMemory(
        Layer.unwrap(
          Effect.map(
            buildQueueImpl(tag, config as QueueVerbConfig<QueueItemFields, unknown, never, never, Schema.Top>),
            (built) => Hyperlink.serve(tag, built),
          ),
        ),
      );
}

/**
 * Alias of {@link serve}.
 *
 * @category layers & serving
 * @public
 */
export const serveMemory = serve;

/**
 * A **config-patch layer** for the WorkPool `tag` — the toolkit successor to the old
 * `WorkPool.Service(...).configure(...)`. Merge it with the queue's {@link layer} (e.g. per
 * environment) and its patch (concurrency / rateLimit / attempts / …) folds onto the layer's base
 * config at build. Keyed by `tag.key`; later patches win. Config lives in the layer, not the tag,
 * so `configure` takes the tag and returns a layer rather than being a tag method.
 *
 * ```ts
 * const Prod = Layer.mergeAll(
 *   WorkPool.layer(MyQueue, { effect }),
 *   WorkPool.configure(MyQueue, { concurrency: 3, rateLimit: { window: "1 second", limit: 5 } }),
 * );
 * ```
 *
 * @category layers & serving
 * @public
 */
export function configure<
  Self,
  F extends QueueItemFields = QueueItemFields,
  R = never,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
>(
  tag: QueueTagFor<Self, F, Success, Error>,
  patch: ConfigPatch<QueueVerbConfig<F, QueueErrorValueOf<Error>, R, RR, Success>>,
): Layer.Layer<never>;
export function configure<
  Self,
  F extends PriorityItemFields = PriorityItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, PriorityInstanceSpec<F>>,
  patch: ConfigPatch<PriorityLayerConfig<Schema.Struct<F>["Type"], E, R, RR>>,
): Layer.Layer<never>;
export function configure(
  tag: AnyPoolTag,
  patch: ConfigPatch<unknown>,
): Layer.Layer<never> {
  return configureLayer(tag.key, patch);
}

/**
 * Register this queue on an app {@link Store.Service} — built-in analytics spec with the tag's
 * `itemSchema` injected. Pass a bare spec object to add app-specific methods (merged with built-in):
 *
 * ```ts
 * WorkPool.store(Mail)
 * WorkPool.store(Mail, {
 *   campaignAudit: campaignAuditSchema,
 * }, ({ campaignAudit, entry }) => ({
 *   appendCampaignAudit: campaignAudit.append,
 * }))
 * ```
 *
 * @category layers & serving
 * @public
 */
export function store<const Tag extends QueueStoreTag>(tag: Tag): ReturnType<
  typeof facetStoreRegistration<Tag, QueueStoreAnalyticsContract<Tag>>
>;
export function store<
  const Tag extends QueueStoreTag,
  const Shapes extends StoreShapes,
>(tag: Tag, extended: Shapes): ReturnType<
  typeof facetStoreRegistration<Tag, QueueStoreAnalyticsContract<Tag>, Shapes>
>;
export function store(tag: QueueStoreTag, extended?: StoreShapes) {
  const contract = makeQueueStoreAnalyticsContract(tag);
  return extended === undefined
    ? facetStoreRegistration(tag, contract)
    : facetStoreRegistration(tag, contract, extended);
}

// The light `Tag` lives here (no engine) so `WorkPool.Tag` member access tree-shakes.
// DX: `import * as WorkPool from "hyperlink-ts/WorkPool"` → `WorkPool.Tag`.
export { queueTag as Tag };

/**
 * Read the `success` / `error` wire schemas stamped on a {@link Tag}, if declared. `undefined` when
 * the queue was defined without that slot. Used by the engine + store contract to read the tag SSOT.
 *
 * @public
 */
export { successOf, errorOf };

// ============================================================================
// Engine surface
//
// The runtime helpers and error/codec re-exports below pull in `./internal/workPool` only when
// referenced. `Tag` / `configure` (above) plus the wire schemas stay engine-free, so a `Tag`-only
// consumer tree-shakes the engine away entirely.
// ============================================================================

export {
  makeQueueEffect as make,
  Service,
  queueSchemaGroup as Schema,
  queueErrorsGroup as Errors,
  queueRateLimiterLayer as rateLimiterLayer,
} from "./internal/workPool";

// The priority (N-level lane) engine constructor — the {@link priority} peer of {@link make}.
export { makePriorityEffect as makePriority } from "./internal/workPoolPriority";

// Codec schemas already imported locally from the light `workPoolSchema` module — surface them here.
export {
  QueueItemCodecDescriptorSchema,
  QueueItemEncodingError,
  QueueMissingItemSchemaError,
};

// Engine error classes / codec helper / schema-version helpers — surfaced on the subpath.
export {
  QueueItemValidationError,
  QueueBatchValidationError,
  QueueShutdownError,
  makeQueueItemCodecDescriptor,
  queueRateLimiterLayer,
  schemaVersionAnnotation,
  schemaVersionOf,
  withSchemaVersion,
} from "./internal/workPool";
export type { EffectContext, QueueEntry, QueueHandle } from "./internal/workPool";
// The queue type surface lives HERE, namespace-style (`WorkPool.QueueStatus`) — the barrel
// no longer re-exports these bare (effect has no top-level; neither do we).
export type {
  BuiltInTakeAlgorithm,
  ConsumeResult,
  CustomTakeAlgorithm,
  InferQueueEnqueueError,
  InferQueueItem,
  InferQueueWorkerError,
  InferQueueWorkerRequirements,
  Priority,
  QueueBatch,
  QueueConfigFromEffect,
  QueueEncodedEntry,
  QueueEnqueue,
  QueueEnqueueEntries,
  QueueEntrySelector,
  QueueEntryTimestamps,
  QueueEvent,
  QueueFailureDisposition,
  QueueItemCodecDescriptor,
  QueueMetrics,
  QueueOnFailure,
  QueueReleaseEncodingError,
  QueueReleaseOptions,
  WorkPoolConfig,
  WorkPoolConfigBase,
  WorkPoolConfigWithItemSchema,
  WorkPoolConfigWithoutItemSchema,
  WorkPoolDefinition,
  WorkPoolMetadata,
  WorkPoolOptionsWithItemSchema,
  WorkPoolOptionsWithoutItemSchema,
  WorkPoolRateLimitOptions,
  WorkPoolServiceDefinition,
  QueueRouteOptions,
  QueueStatus,
  QueueWorkerEffect,
  TakeAlgorithm,
  TakeAlgorithmPick,
  TakeAlgorithmPickContext,
} from "./internal/workPool";
