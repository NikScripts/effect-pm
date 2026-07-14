/**
 * **Queue contract (control surface)** — the fixed-schema half of a queue's service
 * expressed as a {@link Resource} {@link Spec}, so a queue can be driven **remotely** over
 * RPC through the toolkit's location-transparent layers (the same `yield* Tag` code runs
 * local or remote; only the layer changes).
 *
 * @remarks
 * This is the first slice of porting `QueueResource` onto the toolkit. It covers the
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
 * ({@link Resource.serveInstances}) remains for resources whose contract is identical
 * across instances (e.g. RunResource).
 *
 * This module is the **public `QueueResource` namespace** — the `@nikscripts/effect-pm/QueueResource`
 * subpath and the barrel `export * as QueueResource` both resolve here. The light `Tag` / spec /
 * schemas live in this file (engine-free, tree-shakeable); the heavy engine lives in
 * `./internal/queueResource` and is pulled in only by the runtime verbs (`layer` / `serve` /
 * `serveRemote` / `make`). Consume it as a module namespace:
 *
 *   import * as QueueResource from "@nikscripts/effect-pm/QueueResource";
 *   class Mail extends QueueResource.Tag<Mail>()("@app/Mail", { payload: JobSchema }) {}
 *
 * @module QueueResource
 */
import { DateTime, Effect, Layer, Option, Schema, Stream } from "effect";
import * as Resource from "./Resource";
import { specSym } from "./Resource";
import { HistoryStore } from "./HistoryStore";
import type { HistoryReadOptions, HistoryStoreShape } from "./HistoryStore";
import type {
  HandlerContextOf,
  NodeKey,
  ImplOf,
  Local,
  NodeBoundTag,
  ResourceTag,
} from "./Resource";
// Schemas from the light module — keeps the Tag/spec path engine-free (tree-shakeable).
import {
  QueueItemCodecDescriptorSchema,
  QueueItemEncodingError,
  QueueMissingItemSchemaError,
} from "./internal/queueSchema";
// The engine is used only by the runtime verbs (buildQueueImpl/layer/serve/serveRemote) below.
import { makeQueueEffect } from "./internal/queueResource";
import {
  successOf,
  errorOf,
  stampQueueWireSchemas,
} from "./internal/queueTagSchemas";
import { assertQueueInstanceSpec } from "./internal/queueSpecAssert";
import * as Store from "./Store";
import { facetStoreRegistration } from "./internal/store/facetStore";
import {
  makeQueueStoreAnalyticsContract,
  materializeEngineQueueStoreForTag,
  type QueueStoreAnalyticsContract,
  type QueueStoreTag,
} from "./internal/store/queueStoreSpec";
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
  QueueResourceConfigWithItemSchema,
  QueueRouteOptions,
  QueueStatus,
} from "./internal/queueResource";
import type { JsonValue } from "./internal/json";
import { LogEntrySchema } from "./LogEntry";
import { configureLayer, foldConfiguredSpec } from "./ResourceConfigure";
import type { ConfigPatch } from "./ResourceConfigure";

/**
 * Log entry wire schema — alias of {@link LogEntrySchema}. Per-resource logs use {@link Resource.logs}.
 *
 * @public
 */
export const queueLogEntry = LogEntrySchema;

/**
 * The per-priority pending counts returned by `sizes`.
 *
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

/** A queue entry's priority level. @public */
export const queuePriority = Schema.Literals(["high", "normal", "low"]);

/** Timestamps carried by a wire {@link queueEntry}. @public */
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
 * @public
 */
export const queueEntryAttributes = Schema.Record(Schema.String, Schema.Unknown);

/**
 * Option `attributes` — a readonly record of {@link JsonValue}, matching the engine's
 * `{ readonly [key: string]: JsonValue }` on `QueueReleaseOptions` / `QueueRouteOptions`.
 *
 * @public
 */
export const queueJsonAttributes = Schema.Record(Schema.String, jsonValue);

/**
 * A queue entry on the wire, parameterized by the per-instance `itemSchema`. Mirrors the
 * engine's `QueueEntry<T>`; used inside {@link queueEvent}.
 *
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
    sourceResourceId: Schema.optional(Schema.String),
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
 * is absent (the untyped / `CustomQueueResource` fallback). The worker outcome is recorded
 * **once** — `Completed` (with the typed `success`) or `Failed` (with the typed `cause`); there
 * is no separate `Exit` event (a consumer reconstructs `Exit<A, E>` from the two if needed). The
 * non-encodable `retry` affordance the old callbacks received is dropped — a subscriber holds the
 * handle to drive control.
 *
 * @public
 */
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
    Schema.TaggedStruct("Start", { queueId: Schema.String }),
    Schema.TaggedStruct("Enqueued", {
      entries,
      priority: queuePriority,
      batchId: Schema.optionalKey(Schema.String),
    }),
    Schema.TaggedStruct("Started", { entry }),
    Schema.TaggedStruct("Completed", {
      entry,
      success: successSchema,
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
      queueId: Schema.String,
      completed: Schema.Number,
    }),
    Schema.TaggedStruct("Cleared", {
      queueId: Schema.String,
      count: Schema.Number,
    }),
    Schema.TaggedStruct("ShutdownRequested", {
      queueId: Schema.String,
      mode: Schema.Literals(["drain", "finishActive"]),
      pending: Schema.Number,
    }),
    Schema.TaggedStruct("ShutdownComplete", {
      queueId: Schema.String,
      completed: Schema.Number,
    }),
    Schema.TaggedStruct("Released", {
      queueId: Schema.String,
      releaseId: Schema.String,
      entries,
    }),
    Schema.TaggedStruct("DeadLettered", {
      queueId: Schema.String,
      entries,
      reason: Schema.String,
    }),
    Schema.TaggedStruct("Dropped", {
      queueId: Schema.String,
      entries,
      reason: Schema.String,
    }),
    Schema.TaggedStruct("RateLimitExceeded", {
      queueId: Schema.String,
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
 */
export type QueueEventSchema<
  Sch extends Schema.Top,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Unknown,
> = ReturnType<typeof buildQueueEvent<Sch, Success, Error>>;

export const queueEvent = <
  Sch extends Schema.Top,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Unknown,
>(
  itemSchema: Sch,
  wire?: {
    readonly success?: Success;
    readonly error?: Error;
  },
) =>
  buildQueueEvent(
    itemSchema,
    wire?.success ?? Schema.Void,
    wire?.error ?? Schema.Unknown,
  );

/**
 * Selector for the entry-routing verbs (`deadLetter` / `drop`), parameterized by `itemSchema`
 * (it can match on `item`). Mirrors the engine's `QueueEntrySelector<T>`. Over the wire a
 * selector (typically `entryId`) identifies the target — routing a full `QueueEntry` is a local
 * convenience that reduces to its `entryId`.
 *
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

/** Options for `release` / `releaseEncoded` (wire form of `QueueReleaseOptions`). @public */
export const queueReleaseOptions = Schema.Struct({
  scope: Schema.optionalKey(Schema.Literal("pendingOnly")),
  releaseId: Schema.optionalKey(Schema.String),
  attributes: Schema.optionalKey(queueJsonAttributes),
});

/** Options for `deadLetter` / `drop` (wire form of `QueueRouteOptions`). @public */
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
  sourceResourceId: Schema.optional(Schema.String),
  attributes: Schema.optional(queueEntryAttributes),
});

/**
 * The `releaseEncoded` failure channel — the wire-encodable union of the engine's encode
 * errors (now `Schema.TaggedErrorClass`, so they are both yieldable and RPC-encodable).
 *
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
 * slice. Mirrors the matching members of `QueueResource`'s `QueueHandleApi`.
 *
 * @public
 */
export const queueControlSpec = {
  // ── live current state — one SubscriptionRef-backed source of truth ──
  // `status` is the whole snapshot; the scalars are `Stream.map` derivations of it (SSOT). All are
  // plain reads (`p.size`) and subscribable (`Resource.changes(p, (s) => s.size)`).
  status: Resource.ref(queueStatus).annotate({
    description:
      "Live current-state snapshot: per-priority sizes, paused, in-flight, completed, phase.",
  }),
  size: Resource.ref(Schema.Number).annotate({
    description: "Total pending items across all priority levels.",
  }),
  isEmpty: Resource.ref(Schema.Boolean).annotate({
    description: "Whether all priority queues are empty.",
  }),

  // ── lifecycle commands ──
  start: Resource.effect(Schema.Void).annotate({
    description:
      "Fork the worker pool + lifecycle monitor (idempotent; no-op after shutdown).",
  }),
  pause: Resource.effect(Schema.Void).annotate({
    description: "Pause processing; items can still be enqueued and accumulate.",
  }),
  resume: Resource.effect(Schema.Void).annotate({
    description: "Resume processing after a pause.",
  }),
  shutdown: Resource.effect(Schema.Void).annotate({
    description:
      "Permanently stop the queue (graceful): phase → draining, later enqueues dropped, " +
      "in-flight finishes, queued items drained or discarded per shutdownMode, then phase → off.",
    destructive: true,
  }),
  clear: Resource.effect(Schema.Number).annotate({
    description:
      "Drain all pending items and reset the completed counter; returns the count cleared.",
    destructive: true,
  }),

  // ── observability — stream + query, paired by nesting ──
  metrics: {
    stream: Resource.stream(queueMetrics).annotate({
      description:
        "Windowed metrics (per-window counts + throughput/latency) emitted once per window.",
    }),
    query: Resource.effectFn(historyQuery, Schema.Array(queueMetrics)).annotate({
      description:
        "Past windowed metrics from the HistoryStore (newest `limit` within `since`/`until`); " +
        "empty unless a HistoryStore layer is provided.",
    }),
  },
};
// Note: no `satisfies Spec` — it contextually widens each method's error channel to
// `unknown`. The spec is validated (without widening) at the `Resource.Tag` call site.

/**
 * Build a queue **instance** spec (model B): the shared {@link queueControlSpec} plus
 * per-instance data-plane procedures typed by `itemSchema` — the enqueue verbs (`add`,
 * `prioritize`, `defer`, `enqueue`) and the `events` stream. Pass the result to
 * {@link Resource.Tag} — each instance is its own resource (its own RPC group):
 *
 * ```ts
 * class Jobs extends Resource.Tag<Jobs>()("@app/Jobs", queueSpec(JobSchema)) {}
 * const q = yield* Jobs;
 * yield* q.add(aJob); // the item itself is the payload — validated against JobSchema on both sides
 * ```
 *
 * `itemSchema` becomes the rpc payload schema, so RPC validates items on the wire — the
 * client rejects bad items before the round trip and the server re-validates on decode.
 *
 * @public
 */
export const queueSpec = <
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Unknown,
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
    wire?.success ?? Schema.Void,
    wire?.error ?? Schema.Unknown,
  );
  return {
  ...queueControlSpec,
  add: Resource.unsafeEffectFn<{
    (item: Resource.Decoded<typeof itemSchema>): Effect.Effect<void>;
    (items: readonly Resource.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
    (itemOrItems: Resource.Decoded<typeof itemSchema> | readonly Resource.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
  }>()(itemOrItems).annotate({
    description: "Enqueue an item (or a batch) at normal priority.",
  }),
  prioritize: Resource.unsafeEffectFn<{
    (item: Resource.Decoded<typeof itemSchema>): Effect.Effect<void>;
    (items: readonly Resource.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
    (itemOrItems: Resource.Decoded<typeof itemSchema> | readonly Resource.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
  }>()(itemOrItems).annotate({
    description:
      "Enqueue an item (or a batch) at high priority (processed before normal and low).",
  }),
  defer: Resource.unsafeEffectFn<{
    (item: Resource.Decoded<typeof itemSchema>): Effect.Effect<void>;
    (items: readonly Resource.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
    (itemOrItems: Resource.Decoded<typeof itemSchema> | readonly Resource.Decoded<typeof itemSchema>[]): Effect.Effect<void>;
  }>()(itemOrItems).annotate({
    description: "Enqueue an item (or a batch) at low priority (processed after high and normal).",
  }),
  // `enqueue` takes the entry array directly (same shape `events`/`release` produce).
  enqueue: Resource.effectFn(Schema.Array(queueEntry(itemSchema))).annotate({
    description:
      "Re-inject existing entries (e.g. off the events stream / a release) — each re-enters " +
      "at its own priority with its attempts preserved. The handoff / round-trip primitive.",
  }),
  release: Resource.effectFn(
    { options: Schema.optionalKey(queueReleaseOptions) },
    Schema.Array(queueEntry(itemSchema)),
  ).annotate({
    description:
      "Export pending entries for handoff and remove them from this queue; returns them decoded.",
    destructive: true,
  }),
  releaseEncoded: Resource.effectFn(
    { options: Schema.optionalKey(queueReleaseOptions) },
    Schema.Array(queueEncodedEntry),
    queueReleaseEncodingError,
  ).annotate({
    description:
      "Export pending entries in encoded/wire form for remote handoff (requires an itemSchema).",
    destructive: true,
  }),
  deadLetter: Resource.effectFn(
    {
      selector: queueEntrySelector(itemSchema),
      options: queueRouteOptions,
    },
    Schema.Array(queueEntry(itemSchema)),
  ).annotate({
    description: "Remove pending entries matching the selector and route them to a dead letter.",
    destructive: true,
  }),
  drop: Resource.effectFn(
    {
      selector: queueEntrySelector(itemSchema),
      options: queueRouteOptions,
    },
    Schema.Array(queueEntry(itemSchema)),
  ).annotate({
    description: "Remove pending entries matching the selector without preserving them.",
    destructive: true,
  }),
  events: Resource.stream(eventSchema).annotate({
    description: "Discrete entry / worker / queue lifecycle events.",
  }),
  };
};

/**
 * A phantom marker intersected onto a {@link Tag} to carry the worker `success` **schema** (`A`'s
 * schema) at the type level, without touching the (invariant, RPC-facing) spec. The `layer` / `serve`
 * config and the store analytics recover `A` from here (default {@link Schema.Void}). Type-only — no
 * runtime field; the runtime `success` schema still rides the `successSym` stamp. @public
 */
export interface QueueSuccessCarrier<Success extends Schema.Top = typeof Schema.Void> {
  readonly [queueSuccessCarrierSym]?: Success;
}

declare const queueSuccessCarrierSym: unique symbol;

/** The worker `success` **schema** carried on a tag (via {@link QueueSuccessCarrier}). @internal */
export type QueueSuccessSchemaOf<Tag> = Tag extends QueueSuccessCarrier<infer Success>
  ? Success
  : typeof Schema.Void;

/** The spec of a queue instance whose item is `Schema.Struct<F>` — control surface + data plane. */
type QueueInstanceSpec<F extends Schema.Struct.Fields> = ReturnType<
  typeof queueSpec<F>
>;

/**
 * Define a queue **instance** in the designed form — its own RPC group (model B), item
 * type and `itemSchema` baked in:
 *
 * ```ts
 * class MyQueue extends QueueResource.Tag<MyQueue>()("@app/MyQueue", JobSchema) {}
 * // or: Tag()(key, { payload: JobSchema, success?, error? })
 * const q = yield* MyQueue;
 * yield* q.add(aJob); // the item itself is the payload — validated against JobSchema on both sides
 * ```
 *
 * `Self` is given explicitly (Effect's `()` two-stage form); the item type is inferred from
 * `itemSchema`, which becomes the rpc payload schema (native wire validation, no codec). Pass
 * `options.node` to bind the queue to a {@link Resource.Node} — the tag then carries its own
 * transport (ship only the tag; see {@link Resource.client} / {@link Resource.connect}).
 *
 * @public
 */
/** This contract's canonical kind — stamped on every tag so consumers (e.g. the dashboard) can
 *  classify it via {@link Resource.kindOf} without sniffing the spec. */
export const kind = "@nikscripts/effect-pm/QueueResource";

/**
 * Config-object overload of {@link Tag}. `payload` is the item schema (required); `success` (worker
 * return) and `error` (worker failure channel) are the optional wire slots, stamped for the engine
 * + store to read as the tag SSOT. Positional `Tag()(key, payload, success?, error?)` is also valid.
 *
 * @public
 */
export interface QueueTagConfig<
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
> {
  readonly payload: Schema.Struct<F>;
  readonly success?: Success;
  readonly error?: Schema.Top;
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
  value: Schema.Struct<F> | QueueTagConfig<F>,
): value is QueueTagConfig<F> => !Schema.isSchema(value);

const materializeQueueTag = <Self, F extends Schema.Struct.Fields>(
  key: string,
  resolved: {
    readonly payload: Schema.Struct<F>;
    readonly success?: Schema.Top;
    readonly error?: Schema.Top;
    readonly description?: string;
    readonly node?: NodeKey<unknown>;
  },
): ResourceTag<Self, QueueInstanceSpec<F>> => {
  const wire = { success: resolved.success, error: resolved.error };
  const spec = assertQueueInstanceSpec(
    queueSpec(resolved.payload, wire),
    queueSpec(resolved.payload),
    wire,
  );
  const tagOptions = { description: resolved.description, kind };
  const base =
    resolved.node === undefined
      ? Resource.Tag<Self>()(key, spec, tagOptions)
      : Resource.Tag<Self>()(key, spec, { ...tagOptions, node: resolved.node });
  const ready = Resource.withReadiness(base, (svc) =>
    Effect.map(svc.status.get, (status) => ({
      ready: status.phase === "running",
      ...(status.phase === "running"
        ? {}
        : { detail: `phase: ${status.phase}` }),
    })),
  );
  return stampQueueWireSchemas(ready, {
    success: resolved.success,
    error: resolved.error,
  });
};

/**
 * A queue handle — the value `yield* MyQueue` produces. The **named** compact form of a queue's
 * service (both the light `Tag` path and the engine-included `Service` path yield this one type), so
 * it hovers as `QueueResource<EmailJob>` instead of an expanded member wall; prettify-ts / the docs
 * D3 popover expand it to the full shape on demand.
 *
 * @typeParam Payload - the decoded item type (`add(item)` etc.)
 * @typeParam Success - the worker success value (`Completed.success` on {@link QueueResource.events})
 * @typeParam Error - the worker failure channel (`Failed.cause`)
 * @typeParam Requirements - the transport requirement (`never` for a local `yield*`, the `Protocol`
 *   for a remote {@link Resource.client})
 *
 * @public
 */
export interface QueueResource<
  Payload,
  Success = void,
  Error = unknown,
  Requirements = never,
> {
  /** Live current-state snapshot (per-priority sizes, paused, in-flight, completed, phase). */
  readonly status: Resource.Subscribable<QueueStatus>;
  /** Total pending items across all priority levels. */
  readonly size: Resource.Subscribable<number>;
  /** Whether all priority queues are empty. */
  readonly isEmpty: Resource.Subscribable<boolean>;
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
    ReadonlyArray<Resource.Decoded<typeof queueEncodedEntry>>,
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

/** This queue's decoded item type — the `Payload` of its {@link QueueResource} handle. @internal */
type QueueItemOf<F extends Schema.Struct.Fields> = Resource.Decoded<Schema.Struct<F>>;

/**
 * The queue's {@link Resource.Tag} whose service value is the **named** {@link QueueResource} handle
 * (via the `Svc` seam on {@link ResourceTag}), so `yield* MyQueue` hovers as
 * `QueueResource<EmailJob>` rather than the expanded `ServiceOf<…>` wall. @public
 */
export type QueueTag<Self, F extends Schema.Struct.Fields> = ResourceTag<
  Self,
  QueueInstanceSpec<F>,
  QueueResource<QueueItemOf<F>>
>;

/** {@link QueueTag} for a node-bound queue (its own transport). @public */
export type QueueNodeBoundTag<Self, F extends Schema.Struct.Fields, HSelf> = NodeBoundTag<
  Self,
  QueueInstanceSpec<F>,
  HSelf,
  QueueResource<QueueItemOf<F>>
>;

/**
 * Name the built queue tag's service as {@link QueueResource}. The single, deliberate cast in this
 * module: `ServiceOf<QueueInstanceSpec<F>>` and `QueueResource<QueueItemOf<F>>` are **mutually
 * assignable** — proven bidirectionally in `test/queue-handle.test-d.ts` — but TS can't verify that
 * equality for *generic* `F` at the invariant service-`Shape` position, so the generic factory needs
 * one assertion here. Owner-approved (the alternative was a schema-field hover, not `EmailJob`). The
 * `.test-d.ts` is the soundness guard: if the shapes ever diverge, it fails the build.
 */
const nameQueueService = <Self, F extends Schema.Struct.Fields>(
  tag: ResourceTag<Self, QueueInstanceSpec<F>>,
): QueueTag<Self, F> => tag as unknown as QueueTag<Self, F>;

const queueTag = <Self>() => {
  function build<F extends Schema.Struct.Fields, HSelf>(
    key: string,
    payload: Schema.Struct<F>,
    options: { readonly description?: string; readonly node: NodeKey<HSelf> },
  ): QueueNodeBoundTag<Self, F, HSelf> & QueueSuccessCarrier<typeof Schema.Void>;
  function build<F extends Schema.Struct.Fields, Success extends Schema.Top>(
    key: string,
    payload: Schema.Struct<F>,
    success: Success,
    error?: Schema.Top,
  ): QueueTag<Self, F> & QueueSuccessCarrier<Success>;
  function build<F extends Schema.Struct.Fields>(
    key: string,
    payload: Schema.Struct<F>,
    options?: { readonly description?: string },
  ): QueueTag<Self, F> & QueueSuccessCarrier<typeof Schema.Void>;
  function build<F extends Schema.Struct.Fields, HSelf>(
    key: string,
    config: QueueTagConfig<F> & { readonly node: NodeKey<HSelf> },
  ): QueueNodeBoundTag<Self, F, HSelf> & QueueSuccessCarrier<typeof Schema.Void>;
  function build<F extends Schema.Struct.Fields, Success extends Schema.Top = typeof Schema.Void>(
    key: string,
    config: QueueTagConfig<F, Success>,
  ): QueueTag<Self, F> & QueueSuccessCarrier<Success>;
  function build<F extends Schema.Struct.Fields>(
    key: string,
    second: Schema.Struct<F> | QueueTagConfig<F>,
    third?: Schema.Top | QueueTagPositionalOptions,
    fourth?: Schema.Top,
  ): QueueTag<Self, F> {
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
    return nameQueueService(materializeQueueTag<Self, F>(key, resolved));
  }
  return build;
};

/**
 * The worker config for {@link QueueResource.layer} — the engine queue config **without**
 * `itemSchema` (the tag already carries it). The item type is the tag's `itemSchema` decoded
 * type, so `effect: (item, ctx) => …` is typed against it.
 *
 * @public
 */
export type QueueLayerConfig<Item, A, E, R, RR = never> = Omit<
  QueueResourceConfigWithItemSchema<Item, E, R, A>,
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
 * The **local** layer for a toolkit queue instance: run the live {@link QueueEngine} behind the
 * tag's contract. It builds the engine handle in a scope and maps it onto the toolkit service
 * (location-transparent — the same `yield* Tag` then drives the queue locally, or remotely via
 * {@link Resource.client} when served).
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
/** The item-schema constraint shared by {@link layer} / {@link serve} / {@link serveRemote}. */
type QueueItemFields = Record<
  string,
  Schema.Codec<unknown, unknown, never, never>
>;

/** The `tag:` param shape shared by every queue verb ({@link buildQueueImpl} / {@link layer} /
 *  {@link serve} / {@link serveRemote} / {@link configure}): the instance's {@link ResourceTag}
 *  intersected with its worker-`success` carrier. @internal */
type QueueTagFor<Self, F extends QueueItemFields, Success extends Schema.Top> =
  ResourceTag<Self, QueueInstanceSpec<F>> & QueueSuccessCarrier<Success>;

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
 * The queue spec has no {@link Resource.local} members, so the resulting impl satisfies both
 * `ImplOf` (for `Resource.layer` / `Resource.serve`) and `ServeImplOf` (for `Resource.serveRemote`).
 */
const buildQueueImpl = <
  Self,
  F extends QueueItemFields,
  E,
  R,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
>(
  tag: QueueTagFor<Self, F, Success>,
  config: QueueVerbConfig<F, E, R, RR, Success>,
) =>
  Effect.gen(function* () {
    // `add`'s payload is `item | item[]` (a union); the bare item schema is its first member. `specSym`
    // holds the *flat* spec (opaque leaf types) at runtime — recover the precise item schema at this
    // introspection boundary.
    const addMethod = tag[specSym].add as unknown as {
      readonly payload: {
        readonly members: readonly [
          Schema.Codec<Schema.Struct<F>["Type"], unknown, never, never>,
        ];
      };
    };
    const itemSchema: Schema.Codec<Schema.Struct<F>["Type"], unknown, never, never> =
      addMethod.payload.members[0];
    // Capture the FULL ambient context (worker `R` + refill `RR`): the worker effect and the
    // refill loader both run ambiently, so the captured context must cover their union.
    const context = yield* Effect.context<R | RR>();
    // Fold any `.configure` patches in context (keyed by the tag id) onto the base config — so
    // per-env overrides (concurrency / rateLimit / …) merged as layers take effect at build.
    const effectiveConfig = yield* foldConfiguredSpec<
      QueueLayerConfig<
        Schema.Struct<F>["Type"],
        QueueSuccessValueOf<Success>,
        E,
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
    const handle = yield* makeQueueEffect({
      name: tag.key,
      ...effectiveConfig,
      itemSchema,
      store,
    } as QueueResourceConfigWithItemSchema<
      Schema.Struct<F>["Type"],
      E,
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
    // `Resource.provideContext` below discharges `context` into every Effect method uniformly (a no-op
    // on the ones that carry no `R`, like pause/resume/shutdown) — a single subtractive
    // `Effect.provideContext` per method instead of any per-method wrapping — and its `ProvidedContext`
    // result strips `R` so the impl satisfies `ImplOf`. Stream / Subscribable members
    // (`status`/`size`/`isEmpty`/`*.stream`/`events`) pass through untouched.
    const impl: Resource.WithRequirement<
      ImplOf<QueueInstanceSpec<F>>,
      R | RR
    > = {
      status: handle.status,
      size: Resource.mapSubscribable(
        handle.status,
        (s) => s.sizes.high + s.sizes.normal + s.sizes.low,
      ),
      isEmpty: Resource.mapSubscribable(
        handle.status,
        (s) => s.sizes.high + s.sizes.normal + s.sizes.low === 0,
      ),
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
    return Resource.builtResource(tag, impl, context);
  });

export const layer = <
  Self,
  F extends QueueItemFields = QueueItemFields,
  E = never,
  R = never,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
>(
  tag: QueueTagFor<Self, F, Success>,
  config: QueueVerbConfig<F, E, R, RR, Success>,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R | RR> =>
  Layer.unwrap(
    Effect.map(buildQueueImpl(tag, config), (built) =>
      Resource.layer(tag, Resource.grantLocal(tag, built)),
    ),
    // The observability store is baked in: the in-memory default backs every queue unless the app
    // provided its own, and it's exposed so persisted events read back via `Storage`.
  ).pipe(Layer.provideMerge(Store.layerDefaultMemory));

/**
 * Serve this queue **remotely (served-only)** — run the worker / refill / `persist`
 * engine behind the tag, mount its RPC handlers, and register into {@link Resource.servedResourcesLayer},
 * **without** granting the local instance (no `yield* Tag` in the serving process). The engine's worker
 * requirement `R` is **preserved**, so a per-resource `Layer.provide` discharges it in isolation — the
 * queue's counterpart to {@link Resource.serveRemote}.
 *
 * Reach for this (with {@link Resource.httpServer}) for a pure gateway/edge that exposes the queue for
 * remote clients but never consumes it locally; use {@link serve} when the serving node also drives it.
 *
 * ```ts
 * Resource.httpServer([
 *   QueueResource.serveRemote(RosterImportQueue, rosterCfg).pipe(Layer.provide(emptyHookSource)),
 *   QueueResource.serveRemote(MediaImportQueue,  mediaCfg).pipe(Layer.provide(emptyHookSource)),
 * ]).pipe(Layer.provide(NodeHttpServer.layer(() => createServer(), { port })));
 * ```
 *
 * @public
 */
export const serveRemote = <
  Self,
  F extends QueueItemFields = QueueItemFields,
  E = never,
  R = never,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
>(
  tag: QueueTagFor<Self, F, Success>,
  config: QueueVerbConfig<F, E, R, RR, Success>,
) =>
  Layer.unwrap(
    Effect.map(buildQueueImpl(tag, config), (built) =>
      Resource.serveRemote(tag, built as any),
    ),
  ).pipe(Layer.provideMerge(Store.layerDefaultMemory));

/**
 * Serve this queue **and** grant its local instance from **one** materialization — run the worker /
 * refill / `persist` engine behind the tag, mount its RPC handlers, register into
 * {@link Resource.servedResourcesLayer}, **and** grant `Self | Local<Self>` so co-located code
 * can `yield* Tag`. The served cells *are* the in-process instance (one engine, one `peersLayer`); the
 * worker requirement `R` is preserved for per-resource `Layer.provide`. This is the queue's counterpart
 * to {@link Resource.serve}; a served-**only** gateway uses {@link serveRemote}.
 *
 * ```ts
 * Resource.httpServer([
 *   QueueResource.serve(RosterQueue, { effect, itemSchema }),
 *   Process.serve(SeasonMatches, { effect }),
 * ]).pipe(Layer.provide(NodeHttpServer.layer({ port: 3001 })));
 * ```
 *
 * @public
 */
export const serve = <
  Self,
  F extends QueueItemFields = QueueItemFields,
  E = never,
  R = never,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
>(
  tag: QueueTagFor<Self, F, Success>,
  config: QueueVerbConfig<F, E, R, RR, Success>,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<QueueInstanceSpec<F>> | Store.Storage,
  never,
  R | RR
> =>
  Layer.unwrap(
    Effect.map(buildQueueImpl(tag, config), (built) => Resource.serve(tag, built as any)),
  ).pipe(Layer.provideMerge(Store.layerDefaultMemory));

/**
 * Queue resource toolkit — managed priority queues on the {@link Resource} toolkit.
 * (Model B: each instance is its own resource; data-plane procedures are typed by the
 * instance's `itemSchema`.) `layer` runs it locally; `serve` / `serveRemote` node it remotely;
 * a remote {@link Resource.client} drives it with the same `yield* Tag` surface.
 *
 * @public
 */
/**
 * A **config-patch layer** for the queue `tag` — the toolkit successor to the old
 * `QueueResource.Service(...).configure(...)`. Merge it with the queue's {@link layer} (e.g. per
 * environment) and its patch (concurrency / rateLimit / attempts / …) folds onto the layer's base
 * config at build. Keyed by `tag.key`; later patches win. Config lives in the layer, not the tag,
 * so `configure` takes the tag and returns a layer rather than being a tag method.
 *
 * ```ts
 * const Prod = Layer.mergeAll(
 *   QueueResource.layer(MyQueue, { effect }),
 *   QueueResource.configure(MyQueue, { concurrency: 3, rateLimit: { window: "1 second", limit: 5 } }),
 * );
 * ```
 *
 * @public
 */
export const configure = <
  Self,
  F extends QueueItemFields = QueueItemFields,
  E = never,
  R = never,
  RR = never,
  Success extends Schema.Top = typeof Schema.Void,
>(
  tag: QueueTagFor<Self, F, Success>,
  patch: ConfigPatch<QueueVerbConfig<F, E, R, RR, Success>>,
): Layer.Layer<never> => configureLayer(tag.key, patch);

/**
 * Register this queue on an app {@link Store.Service} — built-in analytics spec with the tag's
 * `itemSchema` injected. Pass a bare spec object to add app-specific methods (merged with built-in):
 *
 * ```ts
 * QueueResource.store(Mail)
 * QueueResource.store(Mail, {
 *   campaignAudit: campaignAuditSchema,
 * }, ({ campaignAudit, entry }) => ({
 *   appendCampaignAudit: campaignAudit.append,
 * }))
 * ```
 *
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

// The light `Tag` lives here (no engine) so `QueueResource.Tag` member access tree-shakes.
// DX: `import * as QueueResource from "@nikscripts/effect-pm/QueueResource"` → `QueueResource.Tag`.
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
// The runtime helpers and error/codec re-exports below pull in `./internal/queueResource` only when
// referenced. `Tag` / `configure` (above) plus the wire schemas stay engine-free, so a `Tag`-only
// consumer tree-shakes the engine away entirely.
// ============================================================================

export {
  makeQueueEffect as make,
  Service,
  queueSchemaGroup as Schema,
  queueErrorsGroup as Errors,
  queueRateLimiterLayer as rateLimiterLayer,
} from "./internal/queueResource";

// Codec schemas already imported locally from the light `queueSchema` module — surface them here.
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
} from "./internal/queueResource";
export type { EffectContext, QueueEntry, QueueHandle } from "./internal/queueResource";
