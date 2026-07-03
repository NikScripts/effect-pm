/**
 * **Custom queue contract (control + data surface)** — the toolkit half of
 * {@link CustomQueueResource}, mirroring {@link QueueContract} but with N-level lanes,
 * `Record<string, number>` sizes, and `add(item, level?)` where `level` is a numeric
 * index or a configured name.
 *
 * @module CustomQueueContract
 */
import { Effect, Layer, Option, Schema, Stream } from "effect";
import * as Resource from "./Resource";
import { specSym } from "./Resource";
import { HistoryStore } from "./HistoryStore";
import type {
  HandlerContextOf,
  NodeKey,
  ImplOf,
  LocalCapability,
  Method,
  MethodAnnotations,
  NodeBoundTag,
  ResourceTag,
  ServeEntry,
} from "./Resource";
import { CustomQueueResource as CustomQueueEngine } from "./CustomQueueResource";
import type {
  CustomQueueHandle,
  CustomQueueLevelConfig,
  CustomQueueResourceConfigWithItemSchema,
} from "./CustomQueueResource";
import type { QueueEnqueueErrors } from "./QueueResource";
import {
  historyQuery,
  queueEncodedEntry,
  queueEntryAttributes,
  queueEntryTimestamps,
  queueEvent,
  queueLogEntry,
  queueMetrics,
  queuePriority,
  queueReleaseEncodingError,
  queueReleaseOptions,
  queueRouteOptions,
} from "./QueueContract";
import { configureLayer, foldConfiguredSpec } from "./ResourceConfigure";
import type { ConfigPatch } from "./ResourceConfigure";

/** @public Re-export for custom-queue wire schemas. */
export { queueLogEntry as customQueueLogEntry } from "./QueueContract";

/**
 * Per-lane pending counts keyed by configured name (or `"0"`, `"1"`, …).
 *
 * @public
 */
export const customQueueSizes = Schema.Record(Schema.String, Schema.Number);

/**
 * Custom-queue current-state snapshot — element of the `status` stream.
 *
 * @public
 */
export const customQueueStatus = Schema.Struct({
  sizes: customQueueSizes,
  paused: Schema.Boolean,
  inFlight: Schema.Number,
  completed: Schema.Number,
  phase: Schema.Literals(["running", "draining", "off"]),
});

/**
 * Level argument on the wire — numeric lane index or a name from the tag's
 * `namedLevels` registry (when declared at tag construction).
 *
 * @public
 */
export const customQueueLevel = (
  namedLevels?: Readonly<Record<string, number>>,
): Schema.Schema<number | string> => {
  const names =
    namedLevels === undefined ? [] : Object.keys(namedLevels).filter((n) => n.length > 0);
  return names.length === 0
    ? Schema.Union([Schema.Number, Schema.String])
    : Schema.Union([
        Schema.Number,
        Schema.Literals(names as [string, ...string[]]),
      ]);
};

/**
 * Custom queue entry on the wire — like {@link queueEntry} plus optional numeric `level`.
 *
 * @public
 */
export const customQueueEntry = <Sch extends Schema.Top>(
  itemSchema: Sch,
) =>
  Schema.Struct({
    item: itemSchema,
    entryId: Schema.String,
    key: Schema.optional(Schema.String),
    priority: queuePriority,
    level: Schema.optional(Schema.Number),
    attempts: Schema.Number,
    timestamps: queueEntryTimestamps,
    batchId: Schema.optional(Schema.String),
    releaseId: Schema.optional(Schema.String),
    sourceResourceId: Schema.optional(Schema.String),
    attributes: Schema.optional(queueEntryAttributes),
  });

/** Selector for custom-queue routing verbs. @public */
export const customQueueEntrySelector = <Sch extends Schema.Top>(itemSchema: Sch) =>
  Schema.Struct({
    entryId: Schema.optionalKey(Schema.String),
    key: Schema.optional(Schema.String),
    item: Schema.optionalKey(itemSchema),
  });

/** Total pending across all lanes — the `size`/`isEmpty` `value`s derive from `status.sizes`. @internal */
const sumLaneSizes = (sizes: Record<string, number>): number =>
  Object.values(sizes).reduce((a, b) => a + b, 0);

/**
 * Shared control + observation contract for every custom-queue instance.
 *
 * @public
 */
export const customQueueControlSpec = {
  // ── live current state — one SubscriptionRef-backed source of truth ──
  // `status` is the whole snapshot; `size`/`isEmpty` are `Stream.map` derivations of it (SSOT). Plain
  // reads (`p.size`) and subscribable (`Resource.changes(p, (s) => s.size)`).
  status: Resource.value(customQueueStatus).annotate({
    description:
      "Live current-state snapshot: per-lane sizes, paused, in-flight, completed, phase.",
  }),
  size: Resource.value(Schema.Number).annotate({
    description: "Total pending items across all lanes.",
  }),
  isEmpty: Resource.value(Schema.Boolean).annotate({
    description: "Whether all lanes are empty.",
  }),
  // stays `effect`: the raw per-index array isn't in the named-Record `status.sizes`, so it can't be a
  // reliable `Stream.map` of `status` — an on-demand pull is the honest shape.
  levelSizes: Resource.effect(Schema.Array(Schema.Number)).annotate({
    description: "Raw per-lane occupancy (`levelSizes[i]` = count at lane `i`).",
  }),

  // ── lifecycle commands ──
  start: Resource.effectFn(Schema.Void).annotate({
    description:
      "Fork the worker pool + lifecycle monitor (idempotent; no-op after shutdown).",
  }),
  pause: Resource.effectFn(Schema.Void).annotate({
    description: "Pause processing; items can still be enqueued and accumulate.",
  }),
  resume: Resource.effectFn(Schema.Void).annotate({
    description: "Resume processing after a pause.",
  }),
  shutdown: Resource.effectFn(Schema.Void).annotate({
    description:
      "Permanently stop the queue (graceful): phase → draining, later enqueues dropped, " +
      "in-flight finishes, queued items drained or discarded per shutdownMode, then phase → off.",
    destructive: true,
  }),
  clear: Resource.effectFn(Schema.Number).annotate({
    description:
      "Drain all pending items and reset the completed counter; returns the count cleared.",
    destructive: true,
  }),

  // ── observability — live stream + history query, paired by nesting ──
  metrics: {
    live: Resource.stream(queueMetrics).annotate({
      description:
        "Windowed metrics (per-window counts + throughput/latency) emitted once per window.",
    }),
    history: Resource.effect(Schema.Array(queueMetrics), {
      payload: historyQuery,
    }).annotate({
      description:
        "Past windowed metrics from the HistoryStore; empty unless HistoryStore is provided.",
    }),
  },
  logs: {
    live: Resource.stream(queueLogEntry).annotate({
      description:
        "Captured log lines (engine + worker effect) — empty unless captureLogs is enabled.",
    }),
    history: Resource.effect(Schema.Array(queueLogEntry), {
      payload: historyQuery,
    }).annotate({
      description:
        "Past captured log lines from the HistoryStore; empty unless HistoryStore is provided.",
    }),
  },
};

/** Tag options beyond lane config (description, node). @public */
export type CustomQueueTagOptions = {
  readonly description?: string;
};

/** Lane config resolved from tag factory positional args. @internal */
type CustomQueueTagLevelConfig = CustomQueueLevelConfig;

const namedLevelsFromNames = (names: readonly string[]): Record<string, number> =>
  Object.fromEntries(names.map((name, index) => [name, index]));

const isTagOptions = (value: object): value is CustomQueueTagOptions & { readonly node?: NodeKey<unknown> } =>
  "description" in value || "node" in value;

const resolveTagLevelConfig = (
  levelCountOrNames: number | readonly string[],
  fourth?: Readonly<Record<string, number>> | (CustomQueueTagOptions & { readonly node?: NodeKey<unknown> }),
  fifth?: CustomQueueTagOptions & { readonly node?: NodeKey<unknown> },
): {
  readonly levelConfig: CustomQueueTagLevelConfig;
  readonly tagOptions: CustomQueueTagOptions & { readonly node?: NodeKey<unknown> };
} => {
  if (typeof levelCountOrNames === "number") {
    const namedLevels =
      fourth !== undefined && !isTagOptions(fourth) ? fourth : {};
    const tagOptions =
      fourth !== undefined && isTagOptions(fourth)
        ? fourth
        : (fifth ?? {});
    return {
      levelConfig: { levelCount: levelCountOrNames, namedLevels },
      tagOptions,
    };
  }
  const names = levelCountOrNames.filter((name) => name.length > 0);
  return {
    levelConfig: {
      levelCount: Math.max(1, names.length),
      namedLevels: namedLevelsFromNames(names),
    },
    tagOptions:
      fourth !== undefined && isTagOptions(fourth) ? fourth : {},
  };
};

/**
 * Build a custom-queue **instance** spec: shared {@link customQueueControlSpec} plus
 * per-instance data-plane procedures typed by `itemSchema`.
 *
 * @public
 */
export const customQueueSpec = <F extends Schema.Struct.Fields>(
  itemSchema: Schema.Struct<F>,
  levelConfig: CustomQueueLevelConfig,
) => {
  const itemOrItems = Schema.Union([itemSchema, Schema.Array(itemSchema)]);
  const level = customQueueLevel(levelConfig.namedLevels);
  const entry = customQueueEntry(itemSchema);
  const eventSchema = queueEvent(itemSchema);
  return {
    ...customQueueControlSpec,
    add: Resource.mutatePair(Schema.Void, itemOrItems, Schema.optional(level)).annotate({
      description:
        "Enqueue an item (or batch) at an optional lane — numeric index or configured name.",
    }),
    enqueue: Resource.effectFn(Schema.Void, {
      payload: Schema.Array(entry),
    }).annotate({
      description:
        "Re-inject existing entries — each re-enters at its own level with attempts preserved.",
    }),
    release: Resource.effectFn(Schema.Array(entry), {
      payload: { options: Schema.optionalKey(queueReleaseOptions) },
    }).annotate({
      description:
        "Export pending entries for handoff and remove them from this queue.",
      destructive: true,
    }),
    releaseEncoded: Resource.effectFn(Schema.Array(queueEncodedEntry), {
      payload: { options: Schema.optionalKey(queueReleaseOptions) },
      error: queueReleaseEncodingError,
    }).annotate({
      description: "Export pending entries in encoded/wire form for remote handoff.",
      destructive: true,
    }),
    deadLetter: Resource.effectFn(Schema.Array(entry), {
      payload: {
        selector: customQueueEntrySelector(itemSchema),
        options: queueRouteOptions,
      },
    }).annotate({
      description: "Remove pending entries matching the selector and route to dead letter.",
      destructive: true,
    }),
    drop: Resource.effectFn(Schema.Array(entry), {
      payload: {
        selector: customQueueEntrySelector(itemSchema),
        options: queueRouteOptions,
      },
    }).annotate({
      description: "Remove pending entries matching the selector without preserving them.",
      destructive: true,
    }),
    events: Resource.stream(eventSchema).annotate({
      description: "Discrete entry / worker / queue lifecycle events.",
    }),
  };
};

type CustomQueuePairAnnotations = MethodAnnotations & { readonly callStyle: "pair" };

/** Wire `add` member — tuple payload surfaced as `add(item, level?)`. @public */
export type CustomQueueAddMethod = Method<
  "mutate",
  Schema.Tuple<readonly [Schema.Top, Schema.Top]>,
  Schema.Void,
  Schema.Never,
  false,
  CustomQueuePairAnnotations
>;

/** Full custom-queue instance contract for `itemSchema` `F`. @public */
export type CustomQueueInstanceSpec<F extends Schema.Struct.Fields> = Omit<
  ReturnType<typeof customQueueSpec<F>>,
  "add"
> & {
  readonly add: CustomQueueAddMethod;
};

/**
 * Define a custom-queue **instance** — same shape as {@link QueueContract.queueTag}, with
 * `levelCount` / `namedLevels` baked into the wire level union:
 *
 * ```ts
 * class Jobs extends CustomQueueResource.Tag<Jobs>()(
 *   "@app/Jobs",
 *   JobSchema,
 *   8,
 *   { urgent: 0, batch: 7 },
 * ) {}
 * // or: (id, schema, ["urgent", "normal", "batch"])
 * const q = yield* Jobs;
 * yield* q.add(aJob, "urgent");
 * ```
 *
 * @public
 */
/** This contract's canonical kind — stamped on every tag so consumers (e.g. the dashboard) can
 *  classify it via {@link Resource.kindOf} without sniffing the spec. @since 1.0.0 */
export const kind = "@nikscripts/effect-pm/CustomQueueResource";

export const customQueueTag = <Self>() => {
  function build<F extends Schema.Struct.Fields, HSelf>(
    key: string,
    itemSchema: Schema.Struct<F>,
    levelCount: number,
    namedLevels: Readonly<Record<string, number>> | undefined,
    options: CustomQueueTagOptions & { readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, CustomQueueInstanceSpec<F>, HSelf>;
  function build<F extends Schema.Struct.Fields, HSelf>(
    key: string,
    itemSchema: Schema.Struct<F>,
    levelNames: readonly string[],
    options: CustomQueueTagOptions & { readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, CustomQueueInstanceSpec<F>, HSelf>;
  function build<F extends Schema.Struct.Fields>(
    key: string,
    itemSchema: Schema.Struct<F>,
    levelCount: number,
    namedLevels?: Readonly<Record<string, number>>,
    options?: CustomQueueTagOptions,
  ): ResourceTag<Self, CustomQueueInstanceSpec<F>>;
  function build<F extends Schema.Struct.Fields>(
    key: string,
    itemSchema: Schema.Struct<F>,
    levelNames: readonly string[],
    options?: CustomQueueTagOptions,
  ): ResourceTag<Self, CustomQueueInstanceSpec<F>>;
  function build<F extends Schema.Struct.Fields>(
    key: string,
    itemSchema: Schema.Struct<F>,
    levelCountOrNames: number | readonly string[],
    fourth?:
      | Readonly<Record<string, number>>
      | (CustomQueueTagOptions & { readonly node?: NodeKey<unknown> }),
    fifth?: CustomQueueTagOptions & { readonly node?: NodeKey<unknown> },
  ): ResourceTag<Self, CustomQueueInstanceSpec<F>> {
    const { levelConfig, tagOptions } = resolveTagLevelConfig(
      levelCountOrNames,
      fourth,
      fifth,
    );
    const { description, node, ...rest } = tagOptions;
    const spec = customQueueSpec(itemSchema, levelConfig) as CustomQueueInstanceSpec<F>;
    void rest;
    const tag =
      node === undefined
        ? Resource.Tag<Self>()(key, spec, { description, kind })
        : Resource.Tag<Self>()(key, spec, { description, kind, node });
    // Readiness from the queue's own status (SSOT): ready iff the worker pool is running.
    // `status` is a live `value` — a plain, always-current property (no effect to run).
    return Resource.withReadiness(tag, (svc) =>
      Effect.succeed({
        ready: svc.status.phase === "running",
        ...(svc.status.phase === "running"
          ? {}
          : { detail: `phase: ${svc.status.phase}` }),
      }),
    );
  }
  return build;
};

/** Worker/layer config for a toolkit custom queue (tag carries `itemSchema`). @public */
export type CustomQueueLayerConfig<A, E, R, RR = never> = Omit<
  CustomQueueResourceConfigWithItemSchema<A, E, R>,
  "itemSchema" | "refill" | "name"
> & {
  readonly refill?: {
    readonly onStart?: boolean;
    readonly onDrained?: boolean;
    readonly load: (
      queue: CustomQueueHandle<A, E, QueueEnqueueErrors, never>,
    ) => Effect.Effect<void, never, RR>;
  };
};

type CustomQueueItemFields = Record<
  string,
  Schema.Codec<unknown, unknown, never, never>
>;

const itemSchemaFromCustomQueueAdd = <F extends Schema.Struct.Fields>(
  addPayload: CustomQueueInstanceSpec<F>["add"]["payload"],
): Schema.Struct<F> => {
  const tuple = addPayload as unknown as {
    readonly elements: ReadonlyArray<{
      readonly members: ReadonlyArray<Schema.Struct<F>>;
    }>;
  };
  return tuple.elements[0]!.members[0]!;
};

const buildCustomQueueImpl = <Self, F extends CustomQueueItemFields, E, R, RR = never>(
  tag: ResourceTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
) =>
  Effect.gen(function* () {
    // `specSym` holds the flat spec (opaque leaf types) at runtime — recover the precise `add` payload
    // at this introspection boundary.
    const addMethod = tag[specSym].add as unknown as {
      readonly payload: CustomQueueInstanceSpec<F>["add"]["payload"];
    };
    const itemSchema: Schema.Codec<Schema.Struct<F>["Type"], unknown, never, never> =
      itemSchemaFromCustomQueueAdd(addMethod.payload);
    const context = yield* Effect.context<R | RR>();
    const effectiveConfig = yield* foldConfiguredSpec<
      CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>
    >(tag.key, config);
    const handle = yield* CustomQueueEngine.make({
      name: tag.key,
      ...effectiveConfig,
      itemSchema,
    } as CustomQueueResourceConfigWithItemSchema<Schema.Struct<F>["Type"], E, R | RR>);
    const provideR = <Out, Err>(
      effect: Effect.Effect<Out, Err, R | RR>,
    ): Effect.Effect<Out, Err> => Effect.provide(effect, context);

    const history = yield* Effect.serviceOption(HistoryStore);
    const decodeMetric = Schema.decodeUnknownEffect(queueMetrics);
    const decodeLog = Schema.decodeUnknownEffect(queueLogEntry);
    const metricsStreamId = `${tag.key}/metrics`;
    const logsStreamId = `${tag.key}/logs`;
    yield* Option.match(history, {
      onNone: () => Effect.void,
      onSome: (store) =>
        Effect.gen(function* () {
          yield* Effect.forkScoped(
            Stream.runForEach(handle.metrics, (m) =>
              Schema.encodeEffect(queueMetrics)(m).pipe(
                Effect.flatMap((enc) => store.append(metricsStreamId, enc)),
                Effect.orDie,
              ),
            ),
          );
          yield* Effect.forkScoped(
            Stream.runForEach(handle.logs, (l) =>
              Schema.encodeEffect(queueLogEntry)(l).pipe(
                Effect.flatMap((enc) => store.append(logsStreamId, enc)),
                Effect.orDie,
              ),
            ),
          );
        }),
    });

    const impl: ImplOf<CustomQueueInstanceSpec<F>> = {
      // live current state — `status` is the SubscriptionRef.changes stream; the scalars derive from it.
      status: handle.status,
      size: Stream.map(handle.status, (s) => sumLaneSizes(s.sizes)),
      isEmpty: Stream.map(handle.status, (s) => sumLaneSizes(s.sizes) === 0),
      levelSizes: provideR(handle.levelSizes),
      start: provideR(handle.start),
      pause: handle.pause,
      resume: handle.resume,
      shutdown: handle.shutdown,
      clear: provideR(handle.clear),
      metrics: {
        live: handle.metrics,
        history: ({ limit, since, until }) =>
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
      logs: {
        live: handle.logs,
        history: ({ limit, since, until }) =>
          Option.match(history, {
            onNone: () => Effect.succeed<ReadonlyArray<typeof queueLogEntry.Type>>([]),
            onSome: (store) =>
              store.read(logsStreamId, { limit, since, until }).pipe(
                Effect.flatMap((arr) =>
                  Effect.forEach(arr, (e) => decodeLog(e).pipe(Effect.orDie)),
                ),
              ),
          }),
      },
      add: ((
        itemOrItems: Schema.Struct<F>["Type"] | ReadonlyArray<Schema.Struct<F>["Type"]>,
        level?: number | string,
      ) => provideR(handle.add(itemOrItems, level)).pipe(Effect.orDie)) as ImplOf<
        CustomQueueInstanceSpec<F>
      >["add"],
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

/** @public */
export const layer = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: ResourceTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Layer.Layer<Self | LocalCapability<Self>, never, R | RR> =>
  Layer.unwrap(
    Effect.map(buildCustomQueueImpl(tag, config), (impl) => Resource.layer(tag, impl)),
  );

/** @public */
export const server = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: ResourceTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Layer.Layer<HandlerContextOf<CustomQueueInstanceSpec<F>>, never, R | RR> =>
  Layer.unwrap(
    Effect.map(buildCustomQueueImpl(tag, config), (impl) => Resource.server(tag, impl)),
  );

/** @public */
export const serveHttp = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: ResourceTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
  options?: Parameters<typeof Resource.serveHttp>[2],
) =>
  Layer.unwrap(
    Effect.map(buildCustomQueueImpl(tag, config), (impl) =>
      Resource.serveHttp(tag, impl, options),
    ),
  );

/** @public */
export const serverEntry = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: ResourceTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): ServeEntry<R | RR> => ({
  tag,
  impl: buildCustomQueueImpl(tag, config) as unknown as Effect.Effect<
    Record<string, unknown>,
    never,
    R | RR
  >,
});

/** @public */
export const configure = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: ResourceTag<Self, CustomQueueInstanceSpec<F>>,
  patch: ConfigPatch<CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>>,
): Layer.Layer<never> => configureLayer(tag.key, patch);

export { customQueueTag as Tag };
