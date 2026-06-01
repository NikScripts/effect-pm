/**
 * Scoped runtime fields merged into facet telemetry writes (storage rows,
 * spans, log annotations).
 *
 * @remarks
 * Kernel modules layer this context around work units (process tick, queue
 * item, run invocation). Facet telemetry emitters read required fields here
 * instead of accepting duplicate caller arguments.
 *
 * @module RuntimeEmitContext
 */

import { Context, Data, Effect, Option } from "effect";

/**
 * Fields available while emitting facet telemetry.
 *
 * @public
 */
export interface RuntimeEmitContextShape {
  readonly groupId?: string;
  readonly processType?: "process" | "queue-resource" | "run-resource" | "app";
  readonly processId?: string;
  readonly instanceId?: string;
  readonly scheduleKey?: string | null;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  /** Epoch millis when the tracked unit of work started. */
  readonly startedAt?: number;
  /** Epoch millis when the tracked unit of work finished. */
  readonly completedAt?: number;
  readonly isStartupRun?: boolean;
  readonly error?: string;
}

const emptyContext = (): RuntimeEmitContextShape => ({});

/**
 * Fiber-scoped emit context (optional in context; empty object when absent).
 *
 * @public
 */
export class RuntimeEmitContext extends Context.Service<
  RuntimeEmitContext,
  RuntimeEmitContextShape
>()("@nikscripts/effect-pm/RuntimeEmitContext") {}

const readContext = (): Effect.Effect<RuntimeEmitContextShape> =>
  Effect.serviceOption(RuntimeEmitContext).pipe(
    Effect.map(Option.getOrElse(() => emptyContext())),
  );

/**
 * Read the current emit context (empty when the service is not provided).
 *
 * @public
 */
export const getRuntimeEmitContext: Effect.Effect<RuntimeEmitContextShape> =
  readContext();

/**
 * Run `effect` with emit context fields merged over the current scope.
 *
 * @public
 */
export const withRuntimeEmitContext = <A, E, R>(
  patch: RuntimeEmitContextShape,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const current = yield* readContext();
    return yield* effect.pipe(
      Effect.provideService(RuntimeEmitContext, { ...current, ...patch }),
    );
  });

/**
 * Emitted when a telemetry event requires context fields that are absent.
 *
 * @public
 */
export class RuntimeEmitContextMissingError extends Data.TaggedError(
  "RuntimeEmitContextMissingError",
)<{
  readonly missing: ReadonlyArray<string>;
}> {}

const hasRuntimeEmitContextKeys = <
  const Keys extends ReadonlyArray<keyof RuntimeEmitContextShape>,
>(
  ctx: RuntimeEmitContextShape,
  keys: Keys,
): ctx is RuntimeEmitContextShape &
  Required<Pick<RuntimeEmitContextShape, Keys[number]>> =>
  keys.every((key) => ctx[key] !== undefined);

/**
 * Require named fields on the current emit context.
 *
 * @public
 */
export const requireRuntimeEmitContext = <
  const Keys extends ReadonlyArray<keyof RuntimeEmitContextShape>,
>(
  ...keys: Keys
): Effect.Effect<
  Required<Pick<RuntimeEmitContextShape, Keys[number]>>,
  RuntimeEmitContextMissingError
> =>
  Effect.gen(function* () {
    const ctx = yield* readContext();
    if (!hasRuntimeEmitContextKeys(ctx, keys)) {
      const missing = keys
        .filter((key) => ctx[key] === undefined)
        .map((key) => String(key));
      return yield* new RuntimeEmitContextMissingError({ missing });
    }
    return ctx;
  });

/**
 * Helpers for runtime emit context.
 *
 * @public
 */
export const RuntimeEmitContextApi = {
  get: getRuntimeEmitContext,
  with: withRuntimeEmitContext,
  require: requireRuntimeEmitContext,
} as const;
