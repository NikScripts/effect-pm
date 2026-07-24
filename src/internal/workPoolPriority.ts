/**
 * WorkPool priority (N-level lane) engine — N-level managed queue engine (local `make` entry point).
 *
 * For toolkit tags, layers, and RPC use public `WorkPool.priority` /
 * `WorkPool.makePriority` from the WorkPool module.
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
import { resolvePriorityLane } from "./workPoolLanes";
import { levelToDefaultPriority } from "./priorityMapping";
import {
  buildPriorityProjection,
  type WorkPoolPriorityStatus,
} from "./workPoolProjection";
import type { QueueRuntimeProjection } from "./workPoolProjection";
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
import { retype } from "./nodeServerCommon";

const callBuildQueueEngine = retype<typeof buildQueueEngine>(buildQueueEngine as never);
const invokeBuildQueueEngine = retype<(bindings: never) => never>(callBuildQueueEngine as never);

export type { WorkPoolPriorityStatus } from "./workPoolProjection";

// ============================================================================
// Public types
// ============================================================================

/**
 * Named level registry and default lane for `WorkPool.priority`.
 *
 * @category models
 * @internal
 */
export interface WorkPoolPriorityLaneConfig {
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
 * @internal
 */
export interface WorkPoolPriorityEnqueue<T, EEnqueue = never, R = never> {
  (
    items: T | ReadonlyArray<T>,
    lane?: number | string,
  ): Effect.Effect<void, EEnqueue, R>;
}

/** Control + observe surface for custom N-lane queues. @internal */
export interface WorkPoolPriorityHandleApi<
  T,
  E = never,
  EEnqueue = never,
  R = never,
> {
  readonly add: WorkPoolPriorityEnqueue<T, EEnqueue, R>;
  readonly enqueue: QueueEnqueueEntries<T, R>;
  readonly size: Hyperlink.Subscribable<number>;
  readonly sizes: Effect.Effect<Record<string, number>, never, R>;
  readonly levelSizes: Effect.Effect<ReadonlyArray<number>, never, R>;
  readonly isEmpty: Hyperlink.Subscribable<boolean>;
  readonly completed: Effect.Effect<number>;
  readonly events: Stream.Stream<QueueEvent<T, E>>;
  readonly status: Hyperlink.Subscribable<WorkPoolPriorityStatus>;
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
 * @internal
 */
export type WorkPoolPriorityHandle<
  T,
  E = never,
  EEnqueue = never,
  R = never,
> = WorkPoolPriorityHandleApi<T, E, EEnqueue, R> &
  QueueHandlePhantomWorkerFailures<E>;

/**
 *
 * @category models
 * @internal
 */
export type WorkPoolPriorityConfigWithoutItemSchema<T, E, R> = Omit<
  WorkPoolConfigBase<T>,
  "laneCount"
> &
  WorkPoolPriorityLaneConfig & {
    readonly itemSchema?: undefined;
    readonly effect: (
      item: T,
      ctx: EffectContext<T, never, R>,
    ) => Effect.Effect<void, E, R>;
    readonly onFailure?: QueueOnFailure<T, E, R>;
    readonly refill?: WorkPoolPriorityRefill<T, E, never, R>;
  };

/**
 *
 * @category models
 * @internal
 */
export type WorkPoolPriorityConfigWithItemSchema<T, E, R> = Omit<
  WorkPoolConfigBase<T>,
  "laneCount"
> &
  WorkPoolPriorityLaneConfig & {
    readonly itemSchema: Schema.Codec<T, unknown, never, never>;
    readonly effect: (
      item: T,
      ctx: EffectContext<T, QueueEnqueueErrors, R>,
    ) => Effect.Effect<void, E, R>;
    readonly onFailure?: QueueOnFailure<T, E, R>;
    readonly refill?: WorkPoolPriorityRefill<T, E, QueueEnqueueErrors, R>;
    /** Internal store recorder — wired by {@link WorkPool.layer (priority tag)}. @internal */
    readonly store?: QueueStoreWriter<T, E, void>;
  };

/**
 *
 * @category models
 * @internal
 */
export type WorkPoolPriorityConfig<T, E, R> =
  | WorkPoolPriorityConfigWithoutItemSchema<T, E, R>
  | WorkPoolPriorityConfigWithItemSchema<T, E, R>;

/** @internal */
export type WorkPoolPriorityOptionsWithoutItemSchema<T, E, R> = Omit<
  WorkPoolPriorityConfigWithoutItemSchema<T, E, R>,
  "effect"
>;

/** @internal */
export type WorkPoolPriorityOptionsWithItemSchema<T, E, R> = Omit<
  WorkPoolPriorityConfigWithItemSchema<T, E, R>,
  "effect"
>;

/**
 *
 * @category models
 * @internal
 */
export interface WorkPoolPriorityRefill<T, E, EEnqueue, R> {
  readonly onStart?: boolean;
  readonly onDrained?: boolean;
  readonly load: (
    queue: WorkPoolPriorityHandle<T, E, EEnqueue, R>,
  ) => Effect.Effect<void, never, R>;
}

// ============================================================================
// Internal helpers
// ============================================================================

const isReadonlyArray = <A>(input: A | ReadonlyArray<A>): input is ReadonlyArray<A> =>
  Array.isArray(input);

const normalizeEnqueueInput = <A>(input: A | ReadonlyArray<A>): ReadonlyArray<A> =>
  isReadonlyArray(input) ? input : [input];

const levelResolution = (config: WorkPoolPriorityLaneConfig) => ({
  laneCount: Math.max(1, Math.floor(config.laneCount)),
  namedLanes: config.namedLanes ?? {},
  defaultLevel: config.defaultLevel ?? 0,
});

const wrapWorkPoolPriorityHandle = <T, E, EEnqueue, R>(
  engine: QueueEngineHandle<T, E, EEnqueue, R>,
  levels: ReturnType<typeof levelResolution>,
  projection: ReturnType<typeof buildPriorityProjection>,
): WorkPoolPriorityHandle<T, E, EEnqueue, R> => {
  const resolveLevel = (input?: number | string) =>
    resolvePriorityLane({ ...levels, input });

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
  projection: ReturnType<typeof buildPriorityProjection>,
): QueueRefill<T, E, EEnqueue, R> | undefined =>
  config.refill === undefined
    ? undefined
    : ({
        onStart: config.refill.onStart,
        onDrained: config.refill.onDrained,
        load: (queue) => {
          const handle = wrapWorkPoolPriorityHandle(
            queue as QueueEngineHandle<T, E, EEnqueue, R>,
            levels,
            projection,
          );
          return (
            config.refill!.load as (
              queue: WorkPoolPriorityHandle<T, E, EEnqueue, R>,
            ) => Effect.Effect<void, never, R>
          )(handle);
        },
      } satisfies QueueRefill<T, E, EEnqueue, R>);

const buildPriorityProjectionFromConfig = (config: WorkPoolPriorityLaneConfig) =>
  buildPriorityProjection({
    laneCount: levelResolution(config).laneCount,
    namedLanes: config.namedLanes,
  });

const castProjection = (
  projection: ReturnType<typeof buildPriorityProjection>,
): QueueRuntimeProjection<
  { readonly high: number; readonly normal: number; readonly low: number },
  QueueStatus
> =>
  projection as QueueRuntimeProjection<
    { readonly high: number; readonly normal: number; readonly low: number },
    QueueStatus
  >;

const makePriorityEffectWithoutSchema = <
  const C extends WorkPoolPriorityConfigWithoutItemSchema<any, any, any>,
>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  WorkPoolPriorityHandle<
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
    const projection = buildPriorityProjectionFromConfig(config);
    const engine = yield* retype<
      Effect.Effect<
        QueueEngineHandle<
          InferQueueItem<C>,
          InferQueueWorkerError<C>,
          never,
          InferQueueWorkerRequirements<C>
        >,
        never,
        Scope.Scope | InferQueueWorkerRequirements<C>
      >
    >(
      invokeBuildQueueEngine({
        config: {
          ...config,
          laneCount: levels.laneCount,
          refill: adaptRefill(config, levels, projection),
        },
        laneCount: levels.laneCount,
        projection: castProjection(projection),
        validateForEnqueue: (items: ReadonlyArray<InferQueueItem<C>>) => Effect.succeed(items),
        encodeForRelease: undefined,
        persistCodec: undefined,
      } as never) as never,
    );
    return wrapWorkPoolPriorityHandle(engine, levels, projection);
  });

const makePriorityEffectWithSchema = <
  const C extends WorkPoolPriorityConfigWithItemSchema<any, any, any>,
>(
  config: Types.NoInfer<C>,
): Effect.Effect<
  WorkPoolPriorityHandle<
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
    const projection = buildPriorityProjectionFromConfig(config);
    const engine = yield* retype<
      Effect.Effect<
        QueueEngineHandle<
          InferQueueItem<C>,
          InferQueueWorkerError<C>,
          QueueEnqueueErrors,
          InferQueueWorkerRequirements<C>
        >,
        never,
        Scope.Scope | InferQueueWorkerRequirements<C>
      >
    >(
      invokeBuildQueueEngine({
        config: {
          ...config,
          laneCount: levels.laneCount,
          refill: adaptRefill(config, levels, projection),
        },
        laneCount: levels.laneCount,
        projection: castProjection(projection),
        validateForEnqueue: (items: ReadonlyArray<InferQueueItem<C>>) =>
          validateItemsWithSchema(queueName, config.itemSchema, codecId, items),
        encodeForRelease,
        persistCodec: {
          encode: encodeItem,
          decode: Schema.decodeUnknownExit(config.itemSchema),
        },
      } as never) as never,
    );
    return wrapWorkPoolPriorityHandle(engine, levels, projection);
  });
};

const hasItemSchema = <T, E, R>(
  config: WorkPoolPriorityConfig<T, E, R>,
): config is WorkPoolPriorityConfigWithItemSchema<T, E, R> =>
  config.itemSchema !== undefined;

const makePriorityEffectFromConfig = (
  config: WorkPoolPriorityConfig<any, any, any>,
): Effect.Effect<WorkPoolPriorityHandle<unknown, unknown, unknown, unknown>, never, Scope.Scope> =>
  hasItemSchema(config)
    ? retype(makePriorityEffectWithSchema(config) as never)
    : retype(makePriorityEffectWithoutSchema(config) as never);

type CustomConfigFromEffect<
  F extends QueueWorkerEffect<any, any, any, any>,
  O extends
    | WorkPoolPriorityOptionsWithoutItemSchema<any, any, any>
    | WorkPoolPriorityOptionsWithItemSchema<any, any, any>
    | undefined = undefined,
> = { readonly effect: F } & (O extends undefined ? unknown : O);

function makePriorityEffect<
  const F extends QueueWorkerEffect<any, any, any, any>,
  const O extends
    | WorkPoolPriorityOptionsWithoutItemSchema<any, any, any>
    | WorkPoolPriorityOptionsWithItemSchema<any, any, any>
    | undefined = undefined,
>(
  effect: F,
  options: O & WorkPoolPriorityLaneConfig,
): Effect.Effect<
  WorkPoolPriorityHandle<
    InferQueueItem<CustomConfigFromEffect<F, O>>,
    InferQueueWorkerError<CustomConfigFromEffect<F, O>>,
    InferQueueEnqueueError<CustomConfigFromEffect<F, O>>,
    InferQueueWorkerRequirements<CustomConfigFromEffect<F, O>>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<CustomConfigFromEffect<F, O>>
>;
function makePriorityEffect<const C extends WorkPoolPriorityConfig<any, any, any>>(
  config: C,
): Effect.Effect<
  WorkPoolPriorityHandle<
    InferQueueItem<C>,
    InferQueueWorkerError<C>,
    InferQueueEnqueueError<C>,
    InferQueueWorkerRequirements<C>
  >,
  never,
  Scope.Scope | InferQueueWorkerRequirements<C>
>;
function makePriorityEffect(
  effectOrConfig: QueueWorkerEffect<any, any, any, any> | WorkPoolPriorityConfig<any, any, any>,
  options?: (WorkPoolPriorityOptionsWithoutItemSchema<any, any, any> &
    WorkPoolPriorityLaneConfig),
): Effect.Effect<WorkPoolPriorityHandle<any, any, any, any>, never, Scope.Scope> {
  if (typeof effectOrConfig === "function") {
    if (options === undefined || options.laneCount === undefined) {
      return Effect.die(
        new Error("WorkPool.makePriority requires laneCount in config or options"),
      );
    }
    return retype(makePriorityEffectFromConfig({ ...(options ?? {}), effect: effectOrConfig }) as never);
  }
  return retype(makePriorityEffectFromConfig(effectOrConfig) as never);
}

// Flat engine surface. Public `WorkPool` re-exports `makePriorityEffect` as `makePriority` and
// `queueRateLimiterLayer` — flat (not an object literal) so `WorkPool.priority` pulls no engine
// code. `queueRateLimiterLayer` is re-exported here so the public namespace can source both engine
// helpers from one module.
export { makePriorityEffect, queueRateLimiterLayer };
