/**
 * **CustomQueueResource** — the public N-level managed-queue namespace, mirroring
 * {@link QueueResource} but with N-level lanes, `Record<string, number>` sizes, and
 * `add(item, level?)` where `level` is a numeric index or a configured name.
 *
 * This module is the public face: the `hyperlink-ts/CustomQueueResource` subpath and the
 * barrel `export * as CustomQueueResource` both resolve here. The light `Tag` / spec / schemas live
 * in this file (engine-free, tree-shakeable); the heavy engine lives in
 * `./internal/customQueueResource` and is pulled in only by the runtime verbs (`layer` / `serve` /
 * `serveRemote` / `make`).
 *
 * @module CustomQueueResource
 */
import { Effect, Layer, Option, Schema, Scope, Stream } from "effect";
import * as Hyperlink from "./Hyperlink";
import { specSym } from "./Hyperlink";
import { HistoryStore } from "./HistoryStore";
import * as Store from "./Store";
import { facetStoreRegistration } from "./internal/store/facetStore";
import {
  makeQueueStoreAnalyticsContract,
  materializeEngineQueueStoreForItem,
  type QueueStoreAnalyticsContract,
  type QueueStoreTag,
} from "./internal/store/queueStoreSpec";
import { errorOf, stampQueueWireSchemas, successOf } from "./internal/queueTagSchemas";
import { assertCustomQueueInstanceSpec } from "./internal/queueSpecAssert";
import type { StoreShapes } from "./internal/store/contractDef";
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
import { makeCustomQueueEffect } from "./internal/customQueueResource";
import type {
  CustomQueueHandle,
  CustomQueueLevelConfig,
  CustomQueueResourceConfigWithItemSchema,
} from "./internal/customQueueResource";
import type { QueueEnqueueErrors } from "./internal/queueResource";
import {
  historyQuery,
  queueEncodedEntry,
  queueEntryAttributes,
  queueEntryTimestamps,
  buildQueueEvent,
  queueMetrics,
  queuePriority,
  queueReleaseEncodingError,
  queueReleaseOptions,
  queueRouteOptions,
} from "./QueueResource";
import { configureLayer, foldConfiguredSpec } from "./ResourceConfigure";
import type { ConfigPatch } from "./ResourceConfigure";

/** @public Re-export for custom-queue wire schemas. */
export { queueLogEntry as customQueueLogEntry } from "./QueueResource";

/**
 * Per-lane pending counts keyed by configured name (or `"0"`, `"1"`, …).
 *
 * @category wire schemas
 * @public
 */
export const customQueueSizes = Schema.Record(Schema.String, Schema.Number);

/**
 * Custom-queue current-state snapshot — element of the `status` stream.
 *
 * @category wire schemas
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
 * @category wire schemas
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
 * @category wire schemas
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

/**
 * Selector for custom-queue routing verbs.
 *
 * @category wire schemas
 * @public
 */
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
 * @category wire schemas
 * @public
 */
export const customQueueControlSpec = {
  // ── live current state — one SubscriptionRef-backed source of truth ──
  // `status` is the whole snapshot; `size`/`isEmpty` are `Stream.map` derivations of it (SSOT). Plain
  // reads (`p.size`) and subscribable (`Hyperlink.changes(p, (s) => s.size)`).
  status: Hyperlink.ref(customQueueStatus).annotate({
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

/** Lane config for a custom queue tag. @internal */
type CustomQueueTagLevelConfig = CustomQueueLevelConfig;

/**
 * Build a custom-queue **instance** spec: shared {@link customQueueControlSpec} plus
 * per-instance data-plane procedures typed by `itemSchema`.
 *
 * @category wire schemas
 * @public
 */
export const customQueueSpec = <F extends Schema.Struct.Fields>(
  itemSchema: Schema.Struct<F>,
  levelConfig: CustomQueueLevelConfig,
  wire?: { readonly success?: Schema.Top; readonly error?: Schema.Top },
) => {
  const itemOrItems = Schema.Union([itemSchema, Schema.Array(itemSchema)]);
  const level = customQueueLevel(levelConfig.namedLevels);
  const entry = customQueueEntry(itemSchema);
  const eventSchema = buildQueueEvent(
    itemSchema,
    wire?.success ?? Schema.Void,
    wire?.error ?? Schema.Unknown,
  );
  return {
    ...customQueueControlSpec,
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
        selector: customQueueEntrySelector(itemSchema),
        options: queueRouteOptions,
      },
      Schema.Array(entry),
    ).annotate({
      description: "Remove pending entries matching the selector and route to dead letter.",
      destructive: true,
    }),
    drop: Hyperlink.effectFn(
      {
        selector: customQueueEntrySelector(itemSchema),
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

type CustomQueuePairAnnotations = MethodAnnotations & { readonly callStyle: "pair" };

/**
 * Wire `add` member — tuple payload surfaced as `add(item, level?)`.
 *
 * @category models
 * @public
 */
export type CustomQueueAddMethod = Method<
  Schema.Tuple<readonly [Schema.Top, Schema.Top]>,
  Schema.Void,
  Schema.Never,
  false,
  CustomQueuePairAnnotations
>;

/**
 * Full custom-queue instance contract for `itemSchema` `F`.
 *
 * @category models
 * @public
 */
export type CustomQueueInstanceSpec<F extends Schema.Struct.Fields> = Omit<
  ReturnType<typeof customQueueSpec<F>>,
  "add"
> & {
  readonly add: CustomQueueAddMethod;
};

/**
 * Define a custom-queue **instance** — same shape as {@link QueueResource.Tag}, with
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
 *  classify it via {@link Hyperlink.kindOf} without sniffing the spec. */
export const kind = "hyperlink-ts/CustomQueueResource";

/**
 * CustomQueue `Tag` config — **config object only** (no positional schemas). `payload` is the item
 * schema; `levelCount` is the number of priority lanes; `namedLevels` maps names → lane indices.
 * Optional `success` / `error` wire slots match {@link QueueResource.Tag} (stamped for engine + store).
 *
 * @category models
 * @public
 */
export interface CustomQueueTagConfig<
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
> {
  readonly payload: Schema.Struct<F>;
  readonly levelCount: number;
  readonly namedLevels?: Readonly<Record<string, number>>;
  readonly success?: Success;
  readonly error?: Schema.Top;
  readonly description?: string;
  readonly node?: NodeKey<unknown>;
}

/**
 * Define an N-level managed queue as a named service {@link Tag} (also exported as
 * {@link customQueueTag}): `class Jobs extends CustomQueueResource.Tag<Jobs>()("@app/Jobs", { … }) {}`.
 * The class *is* the Tag — `yield* Jobs` resolves the queue handle, {@link layer} provides it and
 * {@link serve} exposes it over RPC. `payload` is the item schema; `levelCount` / `namedLevels`
 * declare the priority levels; optional `success` / `error` add the worker wire schemas.
 *
 * @public
 * @category constructors
 */
export const customQueueTag = <Self>() => {
  function build<
    F extends Schema.Struct.Fields,
    Success extends Schema.Top,
    HSelf,
  >(
    key: string,
    config: CustomQueueTagConfig<F, Success> & { readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, CustomQueueInstanceSpec<F>, HSelf>;
  function build<
    F extends Schema.Struct.Fields,
    Success extends Schema.Top = typeof Schema.Void,
  >(
    key: string,
    config: CustomQueueTagConfig<F, Success>,
  ): HyperlinkTag<Self, CustomQueueInstanceSpec<F>>;
  function build<F extends Schema.Struct.Fields, Success extends Schema.Top>(
    key: string,
    config: CustomQueueTagConfig<F, Success>,
  ): HyperlinkTag<Self, CustomQueueInstanceSpec<F>> {
    const levelConfig: CustomQueueTagLevelConfig = {
      levelCount: config.levelCount,
      namedLevels: config.namedLevels ?? {},
    };
    const wire = { success: config.success, error: config.error };
    const spec = assertCustomQueueInstanceSpec<F>(
      customQueueSpec(config.payload, levelConfig, wire),
      customQueueSpec(config.payload, levelConfig),
      wire,
    );
    const base =
      config.node === undefined
        ? Hyperlink.Tag<Self>()(key, spec, { description: config.description, kind })
        : Hyperlink.Tag<Self>()(key, spec, {
            description: config.description,
            kind,
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
 * Worker/layer config for a toolkit custom queue (tag carries `itemSchema`).
 *
 * @category models
 * @public
 */
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
  tag: HyperlinkTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Effect.Effect<
  Hyperlink.BuiltHyperlink<CustomQueueInstanceSpec<F>, R | RR>,
  never,
  R | RR | Scope.Scope | Store.Storage
> =>
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
    const store = yield* materializeEngineQueueStoreForItem(tag.key, itemSchema, {
      success: successOf(tag),
      error: errorOf(tag),
    });
    const handle = yield* makeCustomQueueEffect({
      name: tag.key,
      ...effectiveConfig,
      itemSchema,
      store,
    } as CustomQueueResourceConfigWithItemSchema<Schema.Struct<F>["Type"], E, R | RR>);

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
    // discharge `context` into every Effect method uniformly — same bundle pattern as QueueResource.
    const impl: Hyperlink.WithRequirement<
      ImplOf<CustomQueueInstanceSpec<F>>,
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
        level?: number | string,
      ) => handle.add(itemOrItems, level).pipe(Effect.orDie)) as Hyperlink.WithRequirement<
        ImplOf<CustomQueueInstanceSpec<F>>,
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
    return Hyperlink.builtHyperlink(tag, impl, context);
  });

/**
 * Soft-default {@link Store.Storage} ({@link Store.withDefaultStorage}) — R fulfilled; override by
 * providing an app store into this layer. @internal
 */
const withDefaultMemory = <A, E, R>(
  layer: Layer.Layer<A, E, R | Store.Storage>,
): Layer.Layer<A | Store.Storage, E, R> => Store.withDefaultStorage(layer);

/**
 * Local custom-queue layer — soft-defaults {@link Store.Storage} (R fulfilled). Override with
 * `CustomQueueResource.layer(…).pipe(Layer.provideMerge(AppStore.layer…))`.
 *
 * {@link layerMemory} is an alias for the same soft-default.
 *
 * @category layers & serving
 * @public
 */
export const layer = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R | RR> =>
  withDefaultMemory(
    Layer.unwrap(
      Effect.map(buildCustomQueueImpl(tag, config), (built) =>
        Hyperlink.layer(tag, Hyperlink.grantLocal(tag, built)),
      ),
    ),
  );

/**
 * Alias of {@link layer}.
 *
 * @category layers & serving
 * @public
 */
export const layerMemory = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R | RR> =>
  layer(tag, config);

/**
 * Serve this custom queue **remotely (served-only)** — the engine-running counterpart to
 * {@link Hyperlink.serveRemote}. Mounts the queue's RPC handlers and registers into
 * {@link Hyperlink.servedHyperlinksLayer} **without** granting the local instance, preserving the worker
 * requirement `R` for per-resource `Layer.provide`. For a pure gateway/edge; use {@link serve} when the
 * serving node also drives the queue.
 *
 * Soft-defaults {@link Store.Storage}. Override with `Layer.provide` / `provideMerge(AppStore)`.
 *
 * @category layers & serving
 * @public
 */
export const serveRemote = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
) =>
  withDefaultMemory(
    Layer.unwrap(
      Effect.map(buildCustomQueueImpl(tag, config), (built) =>
        Hyperlink.serveRemote(tag, built as any) as any,
      ),
    ) as any,
  ) as any;

/**
 * Alias of {@link serveRemote}.
 *
 * @category layers & serving
 * @public
 */
export const serveRemoteMemory = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
) => serveRemote(tag, config) as any;

/**
 * Serve this custom queue **and** grant its local instance from **one** materialization — the
 * engine-running counterpart to {@link Hyperlink.serve}. Mounts the queue's RPC handlers, registers into
 * {@link Hyperlink.servedHyperlinksLayer}, **and** grants `Self | Local<Self>` so co-located code
 * can `yield* Tag`; the served cells *are* the in-process instance. A served-**only** gateway uses
 * {@link serveRemote}.
 *
 * Soft-defaults {@link Store.Storage}. Override with `Layer.provide` / `provideMerge(AppStore)`.
 *
 * @category layers & serving
 * @public
 */
export const serve = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<CustomQueueInstanceSpec<F>> | Store.Storage,
  never,
  R | RR
> =>
  withDefaultMemory(
    Layer.unwrap(
      Effect.map(buildCustomQueueImpl(tag, config), (built) =>
        Hyperlink.serve(tag, built as any),
      ),
    ),
  );

/**
 * Alias of {@link serve}.
 *
 * @category layers & serving
 * @public
 */
export const serveMemory = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, CustomQueueInstanceSpec<F>>,
  config: CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<CustomQueueInstanceSpec<F>> | Store.Storage,
  never,
  R | RR
> => serve(tag, config);
/**
 *
 * @category layers & serving
 * @public
 */
export const configure = <
  Self,
  F extends CustomQueueItemFields = CustomQueueItemFields,
  E = never,
  R = never,
  RR = never,
>(
  tag: HyperlinkTag<Self, CustomQueueInstanceSpec<F>>,
  patch: ConfigPatch<CustomQueueLayerConfig<Schema.Struct<F>["Type"], E, R, RR>>,
): Layer.Layer<never> => configureLayer(tag.key, patch);

/**
 * Register this custom queue on an app {@link Store.Service} — built-in analytics spec with the tag's
 * `itemSchema` injected. Pass a bare spec object to add app-specific methods (merged with built-in):
 *
 * ```ts
 * CustomQueueResource.store(Jobs)
 * CustomQueueResource.store(Jobs, {
 *   laneAudit: laneAuditSchema,
 * }, ({ laneAudit, event }) => ({
 *   appendLaneAudit: laneAudit.append,
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

// The light `Tag` lives here (no engine) so `CustomQueueResource.Tag` member access tree-shakes.
export { customQueueTag as Tag };

// ============================================================================
// Engine surface
//
// The engine helpers below pull in `./internal/customQueueResource` only when referenced, so a
// `Tag`-only consumer tree-shakes the engine away entirely.
// ============================================================================

export {
  makeCustomQueueEffect as make,
  queueRateLimiterLayer as rateLimiterLayer,
} from "./internal/customQueueResource";

// The custom-queue type surface lives HERE, namespace-style (`CustomQueueResource.CustomQueueStatus`)
// — the barrel no longer re-exports these bare (effect has no top-level; neither do we).
export type {
  CustomQueueEnqueue,
  CustomQueueHandle,
  CustomQueueLevelConfig,
  CustomQueueRefill,
  CustomQueueResourceConfig,
  CustomQueueResourceConfigWithItemSchema,
  CustomQueueResourceConfigWithoutItemSchema,
  CustomQueueStatus,
} from "./internal/customQueueResource";
