/**
 * WorkPool priority (N-level lane) engine — N-level managed queue engine (local `make` entry point).
 *
 * For toolkit tags, layers, and RPC use the public `WorkPoolPriority` namespace
 * (`src/WorkPoolPriority.ts`) / `WorkPoolPriority.Tag` from the barrel.
 *
 * @module internal/workPoolPriority
 * @internal
 */
import {
  Cause,
  DateTime,
  Effect,
  Exit,
  Schema,
  Scope,
  Stream,
  Types,
} from "effect";
import * as Hyperlink from "../Hyperlink";
import { isJsonValue } from "./json";
import { resolveCustomQueueLane } from "./workPoolLanes";
import { levelToDefaultPriority } from "./priorityMapping";
import {
  buildCustomQueueProjection,
  type CustomQueueStatus,
} from "./queueProjection";
import type { QueueRuntimeProjection } from "./queueProjection";
import {
  buildQueueEngine,
  queueRateLimiterLayer,
  type EffectContext,
  type InferQueueEnqueueError,
  type InferQueueItem,
  type InferQueueWorkerError,
  type InferQueueWorkerRequirements,
  type QueueEncodedEntry,
  type QueueEnqueueEntries,
  type QueueEnqueueErrors,
  type QueueEngineHandle,
  type QueueEntry,
  type QueueEntrySelector,
  type QueueEvent,
  type QueueHandlePhantomWorkerFailures,
  type QueueMetrics,
  type QueueOnFailure,
  type QueueReleaseEncodingError,
  type QueueReleaseOptions,
  type WorkPoolConfigBase,
  type QueueRouteOptions,
  type QueueStatus,
  type QueueRefill,
  type QueueWorkerEffect,
  QueueBatchValidationError,
  QueueItemEncodingError,
  QueueItemValidationError,
  makeQueueItemCodecDescriptor,
  type QueueStoreWriter,
} from "./workPool";

export type { CustomQueueStatus } from "./queueProjection";

// ============================================================================
// Public types
// ============================================================================

/**
 * Named level registry and default lane for {@link WorkPoolPriority}.
 *
 * @category models
 * @public
 */
export interface CustomQueueLaneConfig {
  /** Required lane count — one bounded queue per level index `0 … laneCount - 1`. */
  readonly laneCount: number;
  /** Map configured names to lane indices (e.g. `{ interactive: 2, batch: 5 }`). */
  readonly namedLanes?: Record<string, number>;
  /** Lane used when `add` omits a level. @default 0 */
  readonly defaultLevel?: number;
}

/**
 *
 * @category models
 * @public
 */
export interface CustomQueueEnqueue<T, EEnqueue = never, R = never> {
  (
    items: T | ReadonlyArray<T>,
    lane?: number | string,
  ): Effect.Effect<void, EEnqueue, R>;
}

/** Control + observe surface for custom N-lane queues. @public */
export interface CustomQueueHandleApi<
  T,
  E = never,
  EEnqueue = never,
  R = never,
> {
  readonly add: CustomQueueEnqueue<T, EEnqueue, R>;
  readonly enqueue: QueueEnqueueEntries<T, R>;
  readonly size: Hyperlink.Subscribable<number>;
  readonly sizes: Effect.Effect<Record<string, number>, never, R>;
  readonly levelSizes: Effect.Effect<ReadonlyArray<number>, never, R>;
  readonly isEmpty: Hyperlink.Subscribable<boolean>;
  readonly completed: Effect.Effect<number>;
  readonly events: Stream.Stream<QueueEvent<T, E>>;
  readonly status: Hyperlink.Subscribable<CustomQueueStatus>;
  readonly metrics: Stream.Stream<QueueMetrics>;
  readonly start: Effect.Effect<void, never, R>;
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
  readonly clear: Effect.Effect<number, never, R>;
  readonly release: (
    options?: QueueReleaseOptions,
  ) => Effect.Effect<ReadonlyArray<QueueEntry<T>>, never, R>;
  readonly releaseEncoded: (
    options?: QueueReleaseOptions,
  ) => Effect.Effect<ReadonlyArray<QueueEncodedEntry>, QueueReleaseEncodingError, R>;
  readonly deadLetter: (
    selector: QueueEntrySelector<T> | QueueEntry<T>,
    options: QueueRouteOptions,
  ) => Effect.Effect<ReadonlyArray<QueueEntry<T>>, never, R>;
  readonly drop: (
    selector: QueueEntrySelector<T> | QueueEntry<T>,
    options: QueueRouteOptions,
  ) => Effect.Effect<ReadonlyArray<QueueEntry<T>>, never, R>;
}

/**
 *
 * @category models
 * @public
 */
export type CustomQueueHandle<
  T,
  E = never,
  EEnqueue = never,
  R = never,
> = CustomQueueHandleApi<T, E, EEnqueue, R> &
  QueueHandlePhantomWorkerFailures<E>;

/**
 *
 * @category models
 * @public
 */
export type WorkPoolPriorityConfigWithoutItemSchema<T, E, R> = Omit<
  WorkPoolConfigBase<T>,
  "laneCount"
> &
  CustomQueueLaneConfig & {
    readonly itemSchema?: undefined;
    readonly effect: (
      item: T,
      ctx: EffectContext<T, never, R>,
    ) => Effect.Effect<void, E, R>;
    readonly onFailure?: QueueOnFailure<T, E, R>;
    readonly refill?: CustomQueueRefill<T, E, never, R>;
  };

/**
 *
 * @category models
 * @public
 */
export type WorkPoolPriorityConfigWithItemSchema<T, E, R> = Omit<
  WorkPoolConfigBase<T>,
  "laneCount"
> &
  CustomQueueLaneConfig & {
    readonly itemSchema: Schema.Codec<T, unknown, never, never>;
    readonly effect: (
      item: T,
      ctx: EffectContext<T, QueueEnqueueErrors, R>,
    ) => Effect.Effect<void, E, R>;
    readonly onFailure?: QueueOnFailure<T, E, R>;
    readonly refill?: CustomQueueRefill<T, E, QueueEnqueueErrors, R>;
    /** Internal store recorder — wired by {@link WorkPoolPriority.layer}. @internal */
    readonly store?: QueueStoreWriter<T, E, void>;
  };

/**
 *
 * @category models
 * @public
 */
export type WorkPoolPriorityConfig<T, E, R> =
  | WorkPoolPriorityConfigWithoutItemSchema<T, E, R>
  | WorkPoolPriorityConfigWithItemSchema<T, E, R>;

/** @public */
export type WorkPoolPriorityOptionsWithoutItemSchema<T, E, R> = Omit<
  WorkPoolPriorityConfigWithoutItemSchema<T, E, R>,
  "effect"
>;

/** @public */
export type WorkPoolPriorityOptionsWithItemSchema<T, E, R> = Omit<
  WorkPoolPriorityConfigWithItemSchema<T, E, R>,
  "effect"
>;

/**
 *
 * @category models
 * @public
 */
export interface CustomQueueRefill<T, E, EEnqueue, R> {
  readonly onStart?: boolean;
  readonly onDrained?: boolean;
  readonly load: (
    queue: CustomQueueHandle<T, E, EEnqueue, R>,
  ) => Effect.Effect<void, never, R>;
}

// ============================================================================
// Internal helpers
// ============================================================================

const isReadonlyArray = <A>(input: A | ReadonlyArray<A>): input is ReadonlyArray<A> =>
  Array.isArray(input);

const normalizeEnqueueInput = <A>(input: A | ReadonlyArray<A>): ReadonlyArray<A> =>
  isReadonlyArray(input) ? input : [input];

const levelResolution = (config: CustomQueueLaneConfig) => ({
  laneCount: Math.max(1, Math.floor(config.laneCount)),
  namedLanes: config.namedLanes ?? {},
  defaultLevel: config.defaultLevel ?? 0,
});

const wrapCustomQueueHandle = <T, E, EEnqueue, R>(
  engine: QueueEngineHandle<T, E, EEnqueue, R>,
  levels: ReturnType<typeof levelResolution>,
  projection: ReturnType<typeof buildCustomQueueProjection>,
): CustomQueueHandle<T, E, EEnqueue, R> => {
  const resolveLevel = (input?: number | string) =>
    resolveCustomQueueLane({ ...levels, input });

  return {
    add: (items, level?) =>
      engine.enqueueAtLane(normalizeEnqueueInput(items), resolveLevel(level)),
    enqueue: engine.enqueue,
    size: engine.size,
    sizes: Effect.map(engine.levelSizes, projection.projectSizes),
    levelSizes: engine.levelSizes,
    isEmpty: engine.isEmpty,
    completed: engine.completed,
    events: engine.events,
    status: engine.status,
    metrics: engine.metrics,
    start: engine.start,
    pause: engine.pause,
    resume: engine.resume,
    shutdown: engine.shutdown,
    clear: engine.clear,
    release: engine.release,
    releaseEncoded: engine.releaseEncoded,
    deadLetter: engine.deadLetter,
    drop: engine.drop,
  };
};

const validateItemsWithSchema = <T>(
  queueName: string,
  itemSchema: Schema.Codec<T, unknown, never, never>,
  codecId: string,
  items: ReadonlyArray<T>,
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
            operation: "add",
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
            operation: "add",
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

const adaptRefill = <T, E, EEnqueue, R>(
  config: WorkPoolPriorityConfig<T, E, R>,
  levels: ReturnType<typeof levelResolution>,
  projection: ReturnType<typeof buildCustomQueueProjection>,
): QueueRefill<T, E, EEnqueue, R> | undefined =>
  config.refill === undefined
    ? undefined
    : ({
        onStart: config.refill.onStart,
        onDrained: config.refill.onDrained,
        load: (queue) => {
          const handle = wrapCustomQueueHandle(
            queue as QueueEngineHandle<T, E, EEnqueue, R>,
            levels,
            projection,
          );
          return (
            config.refill!.load as (
              custom: CustomQueueHandle<T, E, EEnqueue, R>,
            ) => Effect.Effect<void, never, R>
          )(handle);
        },
      } satisfies QueueRefill<T, E, EEnqueue, R>);

const buildCustomProjection = (config: CustomQueueLaneConfig) =>
  buildCustomQueueProjection({
    laneCount: levelResolution(config).laneCount,
    namedLanes: config.namedLanes,
  });

const castProjection = (
  projection: ReturnType<typeof buildCustomQueueProjection>,
): QueueRuntimeProjection<
  { readonly high: number; readonly normal: number; readonly low: number },
  QueueStatus
> =>
  projection as QueueRuntimeProjection<
    { readonly high: number; readonly normal: number; readonly low: number },
    QueueStatus
  >;

const makeCustomQueueEffectWithoutSchema = <
  const C extends WorkPoolPriorityConfigWithoutItemSchema<any, any, any>,
>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  CustomQueueHandle<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    never,
    InferQueueWorkerRequirements<C>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
> =>
  Effect.gen(function* () {
    const levels = levelResolution(config);
    const projection = buildCustomProjection(config);
    const engine = yield* buildQueueEngine({
      config: {
        ...config,
        laneCount: levels.laneCount,
        refill: adaptRefill(config, levels, projection),
      },
      laneCount: levels.laneCount,
      projection: castProjection(projection),
      validateForEnqueue: (items) => Effect.succeed(items),
      encodeForRelease: undefined,
      persistCodec: undefined,
    });
    return wrapCustomQueueHandle(engine, levels, projection);
  });

const makeCustomQueueEffectWithSchema = <
  const C extends WorkPoolPriorityConfigWithItemSchema<any, any, any>,
>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  CustomQueueHandle<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    QueueEnqueueErrors,
    InferQueueWorkerRequirements<C>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
> => {
  const queueName = config.name ?? "anonymous";
  const descriptor = makeQueueItemCodecDescriptor(queueName, config.itemSchema);
  const codecId = descriptor.id;
  const encodeItem = Schema.encodeUnknownExit(config.itemSchema);
  const encodeForRelease = (
    internal: {
      readonly item: InferQueueItem<C>;
      readonly entryId: string;
      readonly retries: number;
      readonly level: number;
      readonly enqueuedAt: number;
      readonly key: string | undefined;
    },
    releaseId: string,
    attributes?: Record<string, unknown>,
  ) => {
    const encoded = encodeItem(internal.item);
    return Exit.match(encoded, {
      onSuccess: (payload) =>
        isJsonValue(payload)
          ? Effect.succeed({
              entryId: internal.entryId,
              key: internal.key,
              priority: levelToDefaultPriority(internal.level),
              attempts: internal.retries + 1,
              timestamps: {
                enqueuedAt: DateTime.makeUnsafe(internal.enqueuedAt),
              },
              releaseId,
              attributes,
              payload,
              item: descriptor,
            } satisfies QueueEncodedEntry)
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

  return Effect.gen(function* () {
    const levels = levelResolution(config);
    const projection = buildCustomProjection(config);
    const engine = yield* buildQueueEngine({
      config: {
        ...config,
        laneCount: levels.laneCount,
        refill: adaptRefill(config, levels, projection),
      },
      laneCount: levels.laneCount,
      projection: castProjection(projection),
      validateForEnqueue: (items) =>
        validateItemsWithSchema(queueName, config.itemSchema, codecId, items),
      encodeForRelease,
      persistCodec: {
        encode: encodeItem,
        decode: Schema.decodeUnknownExit(config.itemSchema),
      },
    });
    return wrapCustomQueueHandle(engine, levels, projection);
  });
};

const hasItemSchema = <T, E, R>(
  config: WorkPoolPriorityConfig<T, E, R>,
): config is WorkPoolPriorityConfigWithItemSchema<T, E, R> =>
  config.itemSchema !== undefined;

const makeCustomQueueEffectFromConfig = (
  config: WorkPoolPriorityConfig<any, any, any>,
): Effect.Effect<CustomQueueHandle<unknown, unknown, unknown, unknown>, never, Scope.Scope | any> =>
  hasItemSchema(config)
    ? makeCustomQueueEffectWithSchema(config)
    : makeCustomQueueEffectWithoutSchema(config);

type CustomConfigFromEffect<
  F extends QueueWorkerEffect<any, any, any, any>,
  O extends
    | WorkPoolPriorityOptionsWithoutItemSchema<any, any, any>
    | WorkPoolPriorityOptionsWithItemSchema<any, any, any>
    | undefined = undefined,
> = { readonly effect: F } & (O extends undefined ? unknown : O);

function makeCustomQueueEffect<
  const F extends QueueWorkerEffect<any, any, any, any>,
  const O extends
    | WorkPoolPriorityOptionsWithoutItemSchema<any, any, any>
    | WorkPoolPriorityOptionsWithItemSchema<any, any, any>
    | undefined = undefined,
>(
  effect: F,
  options: O & CustomQueueLaneConfig,
): Effect.Effect<
  CustomQueueHandle<
    InferQueueItem<CustomConfigFromEffect<F, O>>,
    InferQueueWorkerError<CustomConfigFromEffect<F, O>>,
    InferQueueEnqueueError<CustomConfigFromEffect<F, O>>,
    InferQueueWorkerRequirements<CustomConfigFromEffect<F, O>>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<CustomConfigFromEffect<F, O>>
>;
function makeCustomQueueEffect<const C extends WorkPoolPriorityConfig<any, any, any>>(
  config: C,
): Effect.Effect<
  CustomQueueHandle<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    InferQueueEnqueueError<C>,
    InferQueueWorkerRequirements<C>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
>;
function makeCustomQueueEffect(
  effectOrConfig: QueueWorkerEffect<any, any, any, any> | WorkPoolPriorityConfig<any, any, any>,
  options?: (WorkPoolPriorityOptionsWithoutItemSchema<any, any, any> &
    CustomQueueLaneConfig),
): Effect.Effect<CustomQueueHandle<any, any, any, any>, never, Scope.Scope | any> {
  if (typeof effectOrConfig === "function") {
    if (options === undefined || options.laneCount === undefined) {
      return Effect.die(
        new Error("WorkPoolPriority.make requires laneCount in config or options"),
      );
    }
    return makeCustomQueueEffectFromConfig({ ...(options ?? {}), effect: effectOrConfig });
  }
  return makeCustomQueueEffectFromConfig(effectOrConfig);
}

// Flat engine surface. The public `WorkPoolPriority` namespace (`src/WorkPoolPriority.ts`)
// re-exports `makeCustomQueueEffect` as `make` and `queueRateLimiterLayer` as `rateLimiterLayer` —
// flat (not an object literal) so `import * as WorkPoolPriority` member access tree-shakes:
// `WorkPoolPriority.Tag` pulls no engine code. `queueRateLimiterLayer` re-exported here so the
// public namespace can source both engine helpers from one module.
export { makeCustomQueueEffect, queueRateLimiterLayer };
