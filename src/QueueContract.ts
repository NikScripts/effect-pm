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
 * "model B / fully per-instance" approach; the shared-spec + `id`-header path
 * ({@link Resource.serveInstances}) remains for resources whose contract is identical
 * across instances (e.g. RunResource).
 *
 * @module QueueContract
 */
import { Effect, Layer, Schema } from "effect";
import { Resource, hostSym, specSym } from "./Resource";
import type {
  HandlerContextOf,
  HostKey,
  LocalCapability,
  ResourceTag,
  ServiceOf,
} from "./Resource";
import {
  QueueItemCodecDescriptorSchema,
  QueueItemEncodingError,
  QueueMissingItemSchemaError,
  QueueResource as QueueEngine,
} from "./QueueResource";
import type { QueueResourceConfigWithItemSchema } from "./QueueResource";
import type { JsonValue } from "./ProcessStoreEvent";
import { ProcessManagerLogEntrySchema } from "./LogEntry";
import { configureLayer, foldConfiguredSpec } from "./ResourceConfigure";
import type { ConfigPatch } from "./ResourceConfigure";

/**
 * A captured log line on the wire — the element of the queue's `logs` stream. Reuses the
 * package's structured log schema ({@link ProcessManagerLogEntrySchema}: `date`, `level`,
 * `message`, `cause?`, `annotations`, `spans`), so every datapoint and the level are preserved
 * across RPC. (Re-exported under a queue-neutral name.)
 *
 * @public
 */
export const queueLogEntry = ProcessManagerLogEntrySchema;

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
  payload: Schema.Unknown,
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
    description:
      "Permanently stop the queue (graceful): phase → draining, later enqueues dropped, " +
      "in-flight finishes, queued items drained or discarded per shutdownMode, then phase → off.",
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
  statusNow: Resource.query(queueStatus).annotate({
    description:
      "One-shot current-state snapshot — the `status` stream's element read once " +
      "(non-`--watch` CLI print, a widget's first paint).",
  }),
  metrics: Resource.stream(queueMetrics).annotate({
    description:
      "Windowed metrics (per-window counts + throughput/latency) emitted once per window.",
  }),
  logs: Resource.stream(queueLogEntry).annotate({
    description:
      "Captured log lines (engine + worker effect) with level/annotations/spans — empty " +
      "unless the queue was configured with captureLogs.",
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
 * yield* q.add(aJob); // the item itself is the payload — validated against JobSchema on both sides
 * ```
 *
 * `itemSchema` becomes the rpc payload schema, so RPC validates items on the wire — the
 * client rejects bad items before the round trip and the server re-validates on decode.
 *
 * @public
 */
export const queueSpec = <F extends Schema.Struct.Fields>(
  itemSchema: Schema.Struct<F>,
) => {
  // `add`/`prioritize`/`defer` take the item **directly**, and also accept a **batch** (the
  // engine's `QueueEnqueue<T>` is `(item) | (items)`), so one call enqueues many — no N round
  // trips over RPC. The payload is `item | item[]` (a single-schema union payload); the layer
  // recovers the bare `itemSchema` from `add.payload.members[0]`.
  const itemOrItems = Schema.Union([itemSchema, Schema.Array(itemSchema)]);
  return {
  ...queueControlSpec,
  add: Resource.mutate(Schema.Void, {
    payload: itemOrItems,
  }).annotate({
    description: "Enqueue an item (or a batch) at normal priority.",
  }),
  prioritize: Resource.mutate(Schema.Void, {
    payload: itemOrItems,
  }).annotate({
    description:
      "Enqueue an item (or a batch) at high priority (processed before normal and low).",
  }),
  defer: Resource.mutate(Schema.Void, {
    payload: itemOrItems,
  }).annotate({
    description: "Enqueue an item (or a batch) at low priority (processed after high and normal).",
  }),
  // `enqueue` takes the entry array directly (same shape `events`/`release` produce).
  enqueue: Resource.mutate(Schema.Void, {
    payload: Schema.Array(queueEntry(itemSchema)),
  }).annotate({
    description:
      "Re-inject existing entries (e.g. off the events stream / a release) — each re-enters " +
      "at its own priority with its attempts preserved. The handoff / round-trip primitive.",
  }),
  release: Resource.mutate(Schema.Array(queueEntry(itemSchema)), {
    payload: { options: Schema.optionalKey(queueReleaseOptions) },
  }).annotate({
    description:
      "Export pending entries for handoff and remove them from this queue; returns them decoded.",
    destructive: true,
  }),
  releaseEncoded: Resource.mutate(Schema.Array(queueEncodedEntry), {
    payload: { options: Schema.optionalKey(queueReleaseOptions) },
    error: queueReleaseEncodingError,
  }).annotate({
    description:
      "Export pending entries in encoded/wire form for remote handoff (requires an itemSchema).",
    destructive: true,
  }),
  deadLetter: Resource.mutate(Schema.Array(queueEntry(itemSchema)), {
    payload: {
      selector: queueEntrySelector(itemSchema),
      options: queueRouteOptions,
    },
  }).annotate({
    description: "Remove pending entries matching the selector and route them to a dead letter.",
    destructive: true,
  }),
  drop: Resource.mutate(Schema.Array(queueEntry(itemSchema)), {
    payload: {
      selector: queueEntrySelector(itemSchema),
      options: queueRouteOptions,
    },
  }).annotate({
    description: "Remove pending entries matching the selector without preserving them.",
    destructive: true,
  }),
  events: Resource.stream(queueEvent(itemSchema)).annotate({
    description: "Discrete entry / worker / queue lifecycle events.",
  }),
  };
};

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
 * const q = yield* MyQueue;
 * yield* q.add(aJob); // the item itself is the payload — validated against JobSchema on both sides
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
  function build<F extends Schema.Struct.Fields, HSelf>(
    id: string,
    itemSchema: Schema.Struct<F>,
    options: { readonly description?: string; readonly host: HostKey<HSelf> },
  ): ResourceTag<Self, QueueInstanceSpec<F>> & {
    readonly [hostSym]: HostKey<HSelf>;
  };
  function build<F extends Schema.Struct.Fields>(
    id: string,
    itemSchema: Schema.Struct<F>,
    options?: { readonly description?: string },
  ): ResourceTag<Self, QueueInstanceSpec<F>>;
  function build<F extends Schema.Struct.Fields>(
    id: string,
    itemSchema: Schema.Struct<F>,
    options?: { readonly description?: string; readonly host?: HostKey<unknown> },
  ): ResourceTag<Self, QueueInstanceSpec<F>> {
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
 * The worker config for {@link QueueResource.layer} — the engine queue config **without**
 * `itemSchema` (the tag already carries it). The item type is the tag's `itemSchema` decoded
 * type, so `effect: (item, ctx) => …` is typed against it.
 *
 * @public
 */
export type QueueLayerConfig<A, E, R> = Omit<
  QueueResourceConfigWithItemSchema<A, E, R>,
  "itemSchema"
>;

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
/** The item-schema constraint shared by {@link layer} / {@link server} / {@link serveHttp}. */
type QueueItemFields = Record<
  string,
  Schema.Codec<unknown, unknown, never, never>
>;

/**
 * Build the live {@link QueueEngine} handle behind `tag` and map it onto the toolkit service
 * impl — the single adapter shared by the **local** layer ({@link layer}) and the **remote**
 * server ({@link server} / {@link serveHttp}). The worker `R` is captured at build time and
 * provided to each method, so the impl requires nothing beyond the scope; the engine queue
 * `name` defaults to the tag id (telemetry attribution) unless `config.name` overrides.
 *
 * The queue spec has no {@link Resource.local} members, so the resulting impl satisfies both
 * `ImplOf` (for `Resource.layer`) and `WireServiceOf` (for `Resource.server` / `serveHttp`).
 */
const buildQueueImpl = <Self, F extends QueueItemFields, E, R>(
  tag: ResourceTag<Self, QueueInstanceSpec<F>>,
  config: QueueLayerConfig<Schema.Struct<F>["Type"], E, R>,
) =>
  Effect.gen(function* () {
    // `add`'s payload is `item | item[]` (a union); the bare item schema is its first member.
    const itemSchema: Schema.Codec<Schema.Struct<F>["Type"], unknown, never, never> =
      tag[specSym].add.payload.members[0];
    const context = yield* Effect.context<R>();
    // Fold any `.configure` patches in context (keyed by the tag id) onto the base config — so
    // per-env overrides (concurrency / rateLimit / …) merged as layers take effect at build.
    const effectiveConfig = yield* foldConfiguredSpec<
      QueueLayerConfig<Schema.Struct<F>["Type"], E, R>
    >(tag.id, config);
    const handle = yield* QueueEngine.make({
      name: tag.id,
      ...effectiveConfig,
      itemSchema,
    });
    const provideR = <Out, Err>(
      effect: Effect.Effect<Out, Err, R>,
    ): Effect.Effect<Out, Err> => Effect.provide(effect, context);
    // Annotated so the method params get contextual typing from the spec (and the impl is
    // assignable to ImplOf / WireServiceOf at all three call sites — no local members here).
    const impl: ServiceOf<QueueInstanceSpec<F>, Self> = {
      size: handle.size,
      sizes: handle.sizes,
      isEmpty: handle.isEmpty,
      completed: handle.completed,
      start: provideR(handle.start),
      pause: handle.pause,
      resume: handle.resume,
      shutdown: handle.shutdown,
      clear: provideR(handle.clear),
      status: handle.status,
      statusNow: handle.statusNow,
      metrics: handle.metrics,
      logs: handle.logs,
      // The item (or batch) IS the payload — `add`/`prioritize`/`defer` take it directly. The
      // `Array.isArray` branch only picks the engine's overload (`(item)` vs `(items)`); both
      // arms forward unchanged. Re-validation can't fail post-decode, so it's `orDie`d.
      add: (itemOrItems) =>
        provideR(
          Array.isArray(itemOrItems)
            ? handle.add(itemOrItems)
            : handle.add(itemOrItems),
        ).pipe(Effect.orDie),
      prioritize: (itemOrItems) =>
        provideR(
          Array.isArray(itemOrItems)
            ? handle.prioritize(itemOrItems)
            : handle.prioritize(itemOrItems),
        ).pipe(Effect.orDie),
      defer: (itemOrItems) =>
        provideR(
          Array.isArray(itemOrItems)
            ? handle.defer(itemOrItems)
            : handle.defer(itemOrItems),
        ).pipe(Effect.orDie),
      // `enqueue` takes the full entry array directly — cast-free. The decoded wire entry
      // (`queueEntry(itemSchema).Type`) and the engine's `QueueEntry<T>` are both derived from
      // the same `Schema.Struct<F>["Type"]` for `item`, so they unify here with no bridge cast.
      enqueue: (entries) => provideR(handle.enqueue(entries)),
      release: ({ options }) => provideR(handle.release(options)),
      releaseEncoded: ({ options }) => provideR(handle.releaseEncoded(options)),
      deadLetter: ({ selector, options }) =>
        provideR(handle.deadLetter(selector, options)),
      drop: ({ selector, options }) => provideR(handle.drop(selector, options)),
      events: handle.events,
    };
    return impl;
  });

const layer = <
  Self,
  F extends QueueItemFields = QueueItemFields,
  E = never,
  R = never,
>(
  tag: ResourceTag<Self, QueueInstanceSpec<F>>,
  config: QueueLayerConfig<Schema.Struct<F>["Type"], E, R>,
): Layer.Layer<Self | LocalCapability<Self>, never, R> =>
  Layer.unwrap(
    Effect.map(buildQueueImpl(tag, config), (impl) => Resource.layer(tag, impl)),
  );

/**
 * Expose a toolkit queue **over RPC** (transport-agnostic): run the live {@link QueueEngine}
 * behind the tag and mount its handlers on the contract group. Compose with an `RpcServer` +
 * a `Protocol` layer to actually serve; or use {@link serveHttp} for the http batteries.
 * A remote {@link Resource.client} then drives the queue with the identical `yield* Tag` surface.
 *
 * @public
 */
const server = <
  Self,
  F extends QueueItemFields = QueueItemFields,
  E = never,
  R = never,
>(
  tag: ResourceTag<Self, QueueInstanceSpec<F>>,
  config: QueueLayerConfig<Schema.Struct<F>["Type"], E, R>,
): Layer.Layer<HandlerContextOf<QueueInstanceSpec<F>>, never, R> =>
  Layer.unwrap(
    Effect.map(buildQueueImpl(tag, config), (impl) => Resource.server(tag, impl)),
  );

/**
 * Serve a toolkit queue **over http** in one call — the engine wired behind the tag and mounted
 * on an http `RpcServer` (ndjson by default, matching {@link Resource.connectHttp}). Provide an
 * `HttpServer` (e.g. `NodeHttpServer.layer({ port })`) and you have a remote queue; a
 * {@link Resource.client} + transport drives it as if local.
 *
 * @public
 */
const serveHttp = <
  Self,
  F extends QueueItemFields = QueueItemFields,
  E = never,
  R = never,
>(
  tag: ResourceTag<Self, QueueInstanceSpec<F>>,
  config: QueueLayerConfig<Schema.Struct<F>["Type"], E, R>,
  options?: Parameters<typeof Resource.serveHttp>[2],
) =>
  Layer.unwrap(
    Effect.map(buildQueueImpl(tag, config), (impl) =>
      Resource.serveHttp(tag, impl, options),
    ),
  );

/**
 * Queue resource toolkit — managed priority queues on the {@link Resource} toolkit.
 * (Model B: each instance is its own resource; data-plane procedures are typed by the
 * instance's `itemSchema`.) `layer` runs it locally; `server` / `serveHttp` host it remotely;
 * a remote {@link Resource.client} drives it with the same `yield* Tag` surface.
 *
 * @public
 */
/**
 * A **config-patch layer** for the queue `tag` — the toolkit successor to the old
 * `QueueResource.Service(...).configure(...)`. Merge it with the queue's {@link layer} (e.g. per
 * environment) and its patch (concurrency / rateLimit / attempts / …) folds onto the layer's base
 * config at build. Keyed by `tag.id`; later patches win. Config lives in the layer, not the tag,
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
const configure = <
  Self,
  F extends QueueItemFields = QueueItemFields,
  E = never,
  R = never,
>(
  tag: ResourceTag<Self, QueueInstanceSpec<F>>,
  patch: ConfigPatch<QueueLayerConfig<Schema.Struct<F>["Type"], E, R>>,
): Layer.Layer<never> => configureLayer(tag.id, patch);

export const QueueResource = {
  Tag: queueTag,
  layer,
  configure,
  server,
  serveHttp,
} as const;
