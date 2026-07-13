/**
 * CustomQueueResource engine — N-level managed queue engine (local `make` entry point).
 *
 * For toolkit tags, layers, and RPC use the public `CustomQueueResource` namespace
 * (`src/CustomQueueResource.ts`) / `CustomQueueResource.Tag` from the barrel.
 *
 * @module internal/customQueueResource
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
import * as Resource from "../Resource";
import { isJsonValue } from "./json";
import { resolveCustomQueueLevel } from "./customQueueLevels";
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
  type QueueResourceConfigBase,
  type QueueRouteOptions,
  type QueueStatus,
  type QueueRefill,
  type QueueWorkerEffect,
  QueueBatchValidationError,
  QueueItemEncodingError,
  QueueItemValidationError,
  makeQueueItemCodecDescriptor,
  type QueueStoreWriter,
} from "./queueResource";

export type { CustomQueueStatus } from "./queueProjection";

// ============================================================================
// Public types
// ============================================================================

/** Named level registry and default lane for {@link CustomQueueResource}. @public */
export interface CustomQueueLevelConfig {
  /** Required lane count — one bounded queue per level index `0 … levelCount - 1`. */
  readonly levelCount: number;
  /** Map configured names to lane indices (e.g. `{ interactive: 2, batch: 5 }`). */
  readonly namedLevels?: Record<string, number>;
  /** Lane used when `add` omits a level. @default 0 */
  readonly defaultLevel?: number;
}

/** @public */
export interface CustomQueueEnqueue<T, EEnqueue = never, R = never> {
  (
    items: T | ReadonlyArray<T>,
    level?: number | string,
  ): Effect.Effect<void, EEnqueue, R>;
}

/** Control + observe surface for custom N-level queues. @public */
export interface CustomQueueHandleApi<
  T,
  E = never,
  EEnqueue = never,
  R = never,
> {
  readonly add: CustomQueueEnqueue<T, EEnqueue, R>;
  readonly enqueue: QueueEnqueueEntries<T, R>;
  readonly size: Effect.Effect<number>;
  readonly sizes: Effect.Effect<Record<string, number>, never, R>;
  readonly levelSizes: Effect.Effect<ReadonlyArray<number>, never, R>;
  readonly isEmpty: Effect.Effect<boolean>;
  readonly completed: Effect.Effect<number>;
  readonly events: Stream.Stream<QueueEvent<T, E>>;
  readonly status: Resource.Subscribable<CustomQueueStatus>;
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

/** @public */
export type CustomQueueHandle<
  T,
  E = never,
  EEnqueue = never,
  R = never,
> = CustomQueueHandleApi<T, E, EEnqueue, R> &
  QueueHandlePhantomWorkerFailures<E>;

/** @public */
export type CustomQueueResourceConfigWithoutItemSchema<T, E, R> = Omit<
  QueueResourceConfigBase<T>,
  "levelCount"
> &
  CustomQueueLevelConfig & {
    readonly itemSchema?: undefined;
    readonly effect: (
      item: T,
      ctx: EffectContext<T, never, R>,
    ) => Effect.Effect<void, E, R>;
    readonly onFailure?: QueueOnFailure<T, E, R>;
    readonly refill?: CustomQueueRefill<T, E, never, R>;
  };

/** @public */
export type CustomQueueResourceConfigWithItemSchema<T, E, R> = Omit<
  QueueResourceConfigBase<T>,
  "levelCount"
> &
  CustomQueueLevelConfig & {
    readonly itemSchema: Schema.Codec<T, unknown, never, never>;
    readonly effect: (
      item: T,
      ctx: EffectContext<T, QueueEnqueueErrors, R>,
    ) => Effect.Effect<void, E, R>;
    readonly onFailure?: QueueOnFailure<T, E, R>;
    readonly refill?: CustomQueueRefill<T, E, QueueEnqueueErrors, R>;
    /** Internal store recorder — wired by {@link CustomQueueResource.layer}. @internal */
    readonly store?: QueueStoreWriter<T, E, void>;
  };

/** @public */
export type CustomQueueResourceConfig<T, E, R> =
  | CustomQueueResourceConfigWithoutItemSchema<T, E, R>
  | CustomQueueResourceConfigWithItemSchema<T, E, R>;

/** @public */
export type CustomQueueResourceOptionsWithoutItemSchema<T, E, R> = Omit<
  CustomQueueResourceConfigWithoutItemSchema<T, E, R>,
  "effect"
>;

/** @public */
export type CustomQueueResourceOptionsWithItemSchema<T, E, R> = Omit<
  CustomQueueResourceConfigWithItemSchema<T, E, R>,
  "effect"
>;

/** @public */
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

const levelResolution = (config: CustomQueueLevelConfig) => ({
  levelCount: Math.max(1, Math.floor(config.levelCount)),
  namedLevels: config.namedLevels ?? {},
  defaultLevel: config.defaultLevel ?? 0,
});

const wrapCustomQueueHandle = <T, E, EEnqueue, R>(
  engine: QueueEngineHandle<T, E, EEnqueue, R>,
  levels: ReturnType<typeof levelResolution>,
  projection: ReturnType<typeof buildCustomQueueProjection>,
): CustomQueueHandle<T, E, EEnqueue, R> => {
  const resolveLevel = (input?: number | string) =>
    resolveCustomQueueLevel({ ...levels, input });

  return {
    add: (items, level?) =>
      engine.enqueueAtLevel(normalizeEnqueueInput(items), resolveLevel(level)),
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
  config: CustomQueueResourceConfig<T, E, R>,
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

const buildCustomProjection = (config: CustomQueueLevelConfig) =>
  buildCustomQueueProjection({
    levelCount: levelResolution(config).levelCount,
    namedLevels: config.namedLevels,
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
  const C extends CustomQueueResourceConfigWithoutItemSchema<any, any, any>,
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
        levelCount: levels.levelCount,
        refill: adaptRefill(config, levels, projection),
      },
      levelCount: levels.levelCount,
      projection: castProjection(projection),
      validateForEnqueue: (items) => Effect.succeed(items),
      encodeForRelease: undefined,
      persistCodec: undefined,
    });
    return wrapCustomQueueHandle(engine, levels, projection);
  });

const makeCustomQueueEffectWithSchema = <
  const C extends CustomQueueResourceConfigWithItemSchema<any, any, any>,
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
        levelCount: levels.levelCount,
        refill: adaptRefill(config, levels, projection),
      },
      levelCount: levels.levelCount,
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
  config: CustomQueueResourceConfig<T, E, R>,
): config is CustomQueueResourceConfigWithItemSchema<T, E, R> =>
  config.itemSchema !== undefined;

const makeCustomQueueEffectFromConfig = (
  config: CustomQueueResourceConfig<any, any, any>,
): Effect.Effect<CustomQueueHandle<unknown, unknown, unknown, unknown>, never, Scope.Scope | any> =>
  hasItemSchema(config)
    ? makeCustomQueueEffectWithSchema(config)
    : makeCustomQueueEffectWithoutSchema(config);

type CustomConfigFromEffect<
  F extends QueueWorkerEffect<any, any, any, any>,
  O extends
    | CustomQueueResourceOptionsWithoutItemSchema<any, any, any>
    | CustomQueueResourceOptionsWithItemSchema<any, any, any>
    | undefined = undefined,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty config branch
> = { readonly effect: F } & (O extends undefined ? {} : O);

function makeCustomQueueEffect<
  const F extends QueueWorkerEffect<any, any, any, any>,
  const O extends
    | CustomQueueResourceOptionsWithoutItemSchema<any, any, any>
    | CustomQueueResourceOptionsWithItemSchema<any, any, any>
    | undefined = undefined,
>(
  effect: F,
  options: O & CustomQueueLevelConfig,
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
function makeCustomQueueEffect<const C extends CustomQueueResourceConfig<any, any, any>>(
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
  effectOrConfig: QueueWorkerEffect<any, any, any, any> | CustomQueueResourceConfig<any, any, any>,
  options?: (CustomQueueResourceOptionsWithoutItemSchema<any, any, any> &
    CustomQueueLevelConfig),
): Effect.Effect<CustomQueueHandle<any, any, any, any>, never, Scope.Scope | any> {
  if (typeof effectOrConfig === "function") {
    if (options === undefined || options.levelCount === undefined) {
      return Effect.die(
        new Error("CustomQueueResource.make requires levelCount in config or options"),
      );
    }
    return makeCustomQueueEffectFromConfig({ ...(options ?? {}), effect: effectOrConfig });
  }
  return makeCustomQueueEffectFromConfig(effectOrConfig);
}

// Flat engine surface. The public `CustomQueueResource` namespace (`src/CustomQueueResource.ts`)
// re-exports `makeCustomQueueEffect` as `make` and `queueRateLimiterLayer` as `rateLimiterLayer` —
// flat (not an object literal) so `import * as CustomQueueResource` member access tree-shakes:
// `CustomQueueResource.Tag` pulls no engine code. `queueRateLimiterLayer` re-exported here so the
// public namespace can source both engine helpers from one module.
export { makeCustomQueueEffect, queueRateLimiterLayer };
