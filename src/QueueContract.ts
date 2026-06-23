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
 * The **data-plane** verbs involve the per-queue item type `T` and its `itemSchema`. The
 * Void-success enqueue verbs (`add` / `prioritize` / `defer` / `enqueue`) are wired; the
 * entry-returning verbs (`release` / `releaseEncoded` / `deadLetter` / `drop`) are pending
 * wire-error scaffolding (the engine's encode/route errors are `Data.TaggedError`, not
 * `Schema`-encodable, so they need schema mirrors before they can cross RPC). Each
 * queue instance is its **own** resource (its own RPC group, prefixed by its id) — built by
 * {@link defineQueueTag} from the shared control spec plus per-instance data procedures
 * whose payload/result schema **is** the instance's `itemSchema`, so Effect RPC validates
 * items natively on both sides (no codec descriptor, no manual encode/decode). This is the
 * "model B / fully per-instance" approach; the shared-spec + `id`-header path
 * ({@link Resource.serveInstances}) remains for resources whose contract is identical
 * across instances (e.g. RunResource).
 *
 * @module QueueContract
 */
import { Schema } from "effect";
import { Resource, hostSym } from "./Resource";
import type { HostKey, ResourceTag } from "./Resource";

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
  avgLatencyMillis: Schema.optionalKey(Schema.Number),
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
 * A queue entry on the wire, parameterized by the per-instance `itemSchema`. Mirrors the
 * engine's `QueueEntry<T>`; used inside {@link queueEvent}.
 *
 * @public
 */
export const queueEntry = <Sch extends Schema.Top>(itemSchema: Sch) =>
  Schema.Struct({
    item: itemSchema,
    entryId: Schema.String,
    key: Schema.optionalKey(Schema.String),
    priority: queuePriority,
    attempts: Schema.Number,
    timestamps: queueEntryTimestamps,
    batchId: Schema.optionalKey(Schema.String),
    releaseId: Schema.optionalKey(Schema.String),
    sourceResourceId: Schema.optionalKey(Schema.String),
    attributes: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  });

/**
 * The **lifecycle event** union — the element of the `events` stream: discrete entry / worker
 * / queue facts. Parameterized by `itemSchema` (events carry entries). A `Schema` tagged
 * union (encodable; it crosses RPC) — subscribers discriminate on `_tag`.
 *
 * Failure-bearing variants carry an encoded `Cause`/`Exit` of `unknown` (the engine's worker
 * error type isn't part of the queue's wire contract); the non-encodable `retry` affordance
 * the old callbacks received is dropped — a subscriber holds the handle to drive control.
 *
 * @public
 */
export const queueEvent = <Sch extends Schema.Top>(itemSchema: Sch) => {
  const entry = queueEntry(itemSchema);
  const entries = Schema.Array(entry);
  const cause = Schema.Cause(Schema.Unknown, Schema.Unknown);
  const exit = Schema.Exit(Schema.Void, Schema.Unknown, Schema.Unknown);
  return Schema.Union([
    Schema.TaggedStruct("Start", { queueId: Schema.String }),
    Schema.TaggedStruct("Enqueued", {
      entries,
      priority: queuePriority,
      batchId: Schema.optionalKey(Schema.String),
    }),
    Schema.TaggedStruct("Started", { entry }),
    Schema.TaggedStruct("Completed", { entry, elapsed: Schema.Duration }),
    Schema.TaggedStruct("Failed", { entry, cause, elapsed: Schema.Duration }),
    Schema.TaggedStruct("Exit", { entry, exit, elapsed: Schema.Duration }),
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
 * The queue **control + observation** contract: the fixed-schema verbs of a queue handle,
 * shared by every queue instance. The data-plane (item-typed) verbs are added in a later
 * slice. Mirrors the matching members of `QueueResource`'s `QueueHandleApi`.
 *
 * @public
 */
export const queueControlSpec = {
  size: Resource.query(Schema.Number).annotate({
    description: "Total pending items across all priority levels.",
  }),
  sizes: Resource.query(queueSizes).annotate({
    description: "Pending item count per priority level.",
  }),
  isEmpty: Resource.query(Schema.Boolean).annotate({
    description: "Whether all priority queues are empty.",
  }),
  completed: Resource.query(Schema.Number).annotate({
    description: "Total items that have finished processing (success or failure).",
  }),
  start: Resource.mutate(Schema.Void).annotate({
    description:
      "Fork the worker pool + lifecycle monitor (idempotent; no-op after shutdown).",
  }),
  pause: Resource.mutate(Schema.Void).annotate({
    description: "Pause processing; items can still be enqueued and accumulate.",
  }),
  resume: Resource.mutate(Schema.Void).annotate({
    description: "Resume processing after a pause.",
  }),
  shutdown: Resource.mutate(Schema.Void).annotate({
    description: "Permanently stop the queue; later enqueues are dropped.",
    destructive: true,
  }),
  clear: Resource.mutate(Schema.Number).annotate({
    description:
      "Drain all pending items and reset the completed counter; returns the count cleared.",
    destructive: true,
  }),
  status: Resource.stream(queueStatus).annotate({
    description:
      "Live current-state snapshot (per-priority sizes, paused, in-flight, completed).",
  }),
  metrics: Resource.stream(queueMetrics).annotate({
    description:
      "Windowed metrics (per-window counts + throughput/latency) emitted once per window.",
  }),
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
 * class Jobs extends Resource.Tag<Jobs>("@app/Jobs")(queueSpec(JobSchema)) {}
 * const q = yield* Jobs;
 * yield* q.add({ item: aJob }); // validated natively against JobSchema on both sides
 * ```
 *
 * `itemSchema` becomes the rpc payload schema, so RPC validates items on the wire — the
 * client rejects bad items before the round trip and the server re-validates on decode.
 *
 * @public
 */
export const queueSpec = <Sch extends Schema.Top>(itemSchema: Sch) => ({
  ...queueControlSpec,
  add: Resource.mutate(Schema.Void, {
    payload: { item: itemSchema },
  }).annotate({
    description: "Enqueue an item at normal priority.",
  }),
  prioritize: Resource.mutate(Schema.Void, {
    payload: { item: itemSchema },
  }).annotate({
    description: "Enqueue an item at high priority (processed before normal and low).",
  }),
  defer: Resource.mutate(Schema.Void, {
    payload: { item: itemSchema },
  }).annotate({
    description: "Enqueue an item at low priority (processed after high and normal).",
  }),
  enqueue: Resource.mutate(Schema.Void, {
    payload: { entries: Schema.Array(queueEntry(itemSchema)) },
  }).annotate({
    description:
      "Re-inject existing entries (e.g. off the events stream / a release) — each re-enters " +
      "at its own priority with its attempts preserved. The handoff / round-trip primitive.",
  }),
  events: Resource.stream(queueEvent(itemSchema)).annotate({
    description: "Discrete entry / worker / queue lifecycle events.",
  }),
});

/** The spec of a queue instance with item schema `Sch` — control surface + data plane. */
type QueueInstanceSpec<Sch extends Schema.Top> = ReturnType<
  typeof queueSpec<Sch>
>;

/**
 * Define a queue **instance** in the designed form — its own RPC group (model B), item
 * type and `itemSchema` baked in:
 *
 * ```ts
 * class MyQueue extends QueueResource.Tag<MyQueue>()("@app/MyQueue", JobSchema) {}
 * const q = yield* MyQueue;
 * yield* q.add({ item: aJob }); // validated natively against JobSchema on both sides
 * ```
 *
 * `Self` is given explicitly (Effect's `()` two-stage form); the item type is inferred from
 * `itemSchema`, which becomes the rpc payload schema (native wire validation, no codec). Pass
 * `options.host` to bind the queue to a {@link Resource.Host} — the tag then carries its own
 * transport (ship only the tag; see {@link Resource.client} / {@link Resource.connect}).
 *
 * @public
 */
const queueTag = <Self>() => {
  function build<Sch extends Schema.Top, HSelf>(
    id: string,
    itemSchema: Sch,
    options: { readonly description?: string; readonly host: HostKey<HSelf> },
  ): ResourceTag<Self, QueueInstanceSpec<Sch>> & {
    readonly [hostSym]: HostKey<HSelf>;
  };
  function build<Sch extends Schema.Top>(
    id: string,
    itemSchema: Sch,
    options?: { readonly description?: string },
  ): ResourceTag<Self, QueueInstanceSpec<Sch>>;
  function build<Sch extends Schema.Top>(
    id: string,
    itemSchema: Sch,
    options?: { readonly description?: string; readonly host?: HostKey<unknown> },
  ): ResourceTag<Self, QueueInstanceSpec<Sch>> {
    const spec = queueSpec(itemSchema);
    const host = options?.host;
    // host rides the inferring call; `makeTag`'s inner overload narrows the tag's host.
    return host === undefined
      ? Resource.Tag<Self>(id, options)(spec)
      : Resource.Tag<Self>(id, options)(spec, host);
  }
  return build;
};

/**
 * Queue resource toolkit — managed priority queues on the {@link Resource} toolkit.
 * (Model B: each instance is its own resource; data-plane procedures are typed by the
 * instance's `itemSchema`.)
 *
 * @public
 */
export const QueueResource = {
  Tag: queueTag,
} as const;
