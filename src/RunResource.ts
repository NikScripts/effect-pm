/**
 * RunResource — concurrency + optional start throttling for effects.
 *
 * The tag’s value is a **callable** closed over one scoped gate (same idea as
 * `const m = yield* makeSemaphore(1); const task = m.withPermits(1)(work)` — repeated
 * `yield*` uses the **same** semaphores, not a new scope per call).
 *
 * - {@link RunResource.make} — configured `effect`; `yield* gate()` or `yield* gate(input)`.
 * - {@link RunResource.makeRunner} — `yield* wrap(arbitraryEffect)` for HttpClient, etc.
 *
 * Use {@link RunResourceLimits} via **`limits`**: omit **`limits`** for a pass-through
 * wrapper (no semaphores / throttler); pass **`limits`** (including `{}`) for an execution
 * semaphore with default concurrency **1** and optional throttle.
 *
 * Unlike {@link QueueResource}, there are no queues or priorities.
 *
 * @module RunResource
 */

import { Context, Duration, Effect, Layer, Ref, Semaphore } from "effect";

/**
 * Global throttler: minimum wall-clock gap between *starts* of wrapped effects.
 * Same behavior as QueueResource’s internal throttler.
 *
 * @internal
 */
const makeGlobalThrottler = (minInterval: Duration.Duration) =>
  Effect.gen(function* () {
    const lastStartTime = yield* Ref.make<number>(0);

    return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.gen(function* () {
        const now = Date.now();
        const lastStart = yield* Ref.get(lastStartTime);
        const timeSinceLastStart = now - lastStart;
        const minIntervalMs = Duration.toMillis(minInterval);

        if (timeSinceLastStart < minIntervalMs) {
          const waitTime = minIntervalMs - timeSinceLastStart;
          yield* Effect.sleep(Duration.millis(waitTime));
        }

        yield* Ref.set(lastStartTime, Date.now());
        return yield* effect;
      });
  });

/**
 * Concurrency and optional start throttle when **`limits`** is passed to
 * {@link RunResource.make} / {@link RunResource.makeRunner}.
 *
 * - **`concurrency`** — max concurrent inner effects; default **1** when **`limits`** is set.
 * - **`throttle`** — if omitted, no minimum gap between starts.
 *
 * @public
 */
export interface RunResourceLimits {
  /**
   * Max gated effects executing at once.
   *
   * @defaultValue 1 (when `limits` is present)
   */
  readonly concurrency?: number;

  /**
   * Start throttling: at most `limit` effect starts per `duration`, spread across
   * execution slots (same formula as {@link QueueResource}).
   */
  readonly throttle?: {
    readonly limit: number;
    readonly duration: Duration.Duration;
  };
}

/**
 * Config when `effect` is a single `Effect` value — tag is `() => Effect`.
 *
 * @public
 */
export type RunResourceConfigUnit<A, E, R> = {
  readonly name: string;
  readonly effect: Effect.Effect<A, E, R>;
  /**
   * When omitted, effects pass through unchanged (no semaphores / throttler).
   * When present (including `{}`), an execution semaphore is allocated;
   * {@link RunResourceLimits.concurrency} defaults to **1**.
   */
  readonly limits?: RunResourceLimits;
};

/**
 * Config when `effect` is a function — tag is `(input: T) => Effect`.
 *
 * @public
 */
export type RunResourceConfigWithArg<T, A, E, R> = {
  readonly name: string;
  readonly effect: (input: T) => Effect.Effect<A, E, R>;
  readonly limits?: RunResourceLimits;
};

/**
 * Gated configured effect with no parameters (`yield* gate()`).
 *
 * @public
 */
export type RunResourceUnit<A, E, R> = () => Effect.Effect<A, E, R>;

/**
 * Gated configured effect with parameter (`yield* gate(input)`).
 *
 * @public
 */
export type RunResourceApply<T, A, E, R> = (
  input: T
) => Effect.Effect<A, E, R>;

/**
 * Config for {@link RunResource.makeRunner} (limits only, no baked-in effect).
 *
 * @public
 */
export type RunResourceRunnerConfig = {
  readonly name: string;
  readonly limits?: RunResourceLimits;
};

/**
 * Wrap any effect with the same concurrency and throttle rules (`yield* wrap(e)`).
 *
 * @public
 */
export interface RunResourceRunner {
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
}

/**
 * Build the inner `wrap` used by {@link RunResource} and {@link HttpApiResource}.
 * `limits === undefined` → identity; otherwise scoped semaphore (+ optional throttler).
 *
 * @internal
 */
export const makeRunResourceWrap = (
  limits: RunResourceLimits | undefined
): Effect.Effect<
  <A, E, R>(inner: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
  never,
  never
> =>
  limits === undefined
    ? Effect.succeed(<A, E, R>(inner: Effect.Effect<A, E, R>) => inner)
    : Effect.gen(function* () {
        const concurrency = limits.concurrency ?? 1;
        const exec = yield* Semaphore.make(concurrency);

        const throttleStep =
          limits.throttle !== undefined
            ? yield* makeGlobalThrottler(
                Duration.millis(
                  Duration.toMillis(limits.throttle.duration) /
                    limits.throttle.limit /
                    concurrency
                )
              )
            : <A, E, R>(e: Effect.Effect<A, E, R>) => e;

        return <A, E, R>(inner: Effect.Effect<A, E, R>) =>
          exec.withPermits(1)(throttleStep(inner));
      });

function makeRunResourceGate<A, E, R, const Name extends string>(
  config: RunResourceConfigUnit<A, E, R> & { readonly name: Name }
): Context.Service<
  RunResourceUnit<A, E, R> & { _brand: Name },
  RunResourceUnit<A, E, R>
> & {
  readonly layer: Layer.Layer<
    RunResourceUnit<A, E, R> & { _brand: Name },
    never,
    never
  >;
};

function makeRunResourceGate<T, A, E, R, const Name extends string>(
  config: RunResourceConfigWithArg<T, A, E, R> & { readonly name: Name }
): Context.Service<
  RunResourceApply<T, A, E, R> & { _brand: Name },
  RunResourceApply<T, A, E, R>
> & {
  readonly layer: Layer.Layer<
    RunResourceApply<T, A, E, R> & { _brand: Name },
    never,
    never
  >;
};

function makeRunResourceGate<
  A,
  E,
  R,
  T,
  const Name extends string,
>(
  config:
    | (RunResourceConfigUnit<A, E, R> & { readonly name: Name })
    | (RunResourceConfigWithArg<T, A, E, R> & { readonly name: Name })
):
  | (Context.Service<
      RunResourceUnit<A, E, R> & { _brand: Name },
      RunResourceUnit<A, E, R>
    > & {
      readonly layer: Layer.Layer<
        RunResourceUnit<A, E, R> & { _brand: Name },
        never,
        never
      >;
    })
  | (Context.Service<
      RunResourceApply<T, A, E, R> & { _brand: Name },
      RunResourceApply<T, A, E, R>
    > & {
      readonly layer: Layer.Layer<
        RunResourceApply<T, A, E, R> & { _brand: Name },
        never,
        never
      >;
    }) {
  const { name, effect, limits } = config;

  if (Effect.isEffect(effect)) {
    const tag = Context.Service<
      RunResourceUnit<A, E, R> & { _brand: Name },
      RunResourceUnit<A, E, R>
    >(name);

    const layer = Layer.effect(
      tag,
      Effect.gen(function* () {
        const wrap = yield* makeRunResourceWrap(limits);
        const unit: RunResourceUnit<A, E, R> = () =>
          wrap(effect as Effect.Effect<A, E, R>);
        return unit;
      })
    );

    return Object.assign(tag, { layer });
  }

  const tag = Context.Service<
    RunResourceApply<T, A, E, R> & { _brand: Name },
    RunResourceApply<T, A, E, R>
  >(name);

  const effectFn = effect as (input: T) => Effect.Effect<A, E, R>;

  const layer = Layer.effect(
    tag,
    Effect.gen(function* () {
      const wrap = yield* makeRunResourceWrap(limits);
      const apply: RunResourceApply<T, A, E, R> = (input: T) =>
        wrap(effectFn(input));
      return apply;
    })
  );

  return Object.assign(tag, { layer });
}

function makeRunResourceRunnerImpl<const Name extends string>(
  config: RunResourceRunnerConfig & { readonly name: Name }
): Context.Service<
  RunResourceRunner & { _brand: Name },
  RunResourceRunner
> & {
  readonly layer: Layer.Layer<
    RunResourceRunner & { _brand: Name },
    never,
    never
  >;
} {
  const { name, limits } = config;
  const tag = Context.Service<
    RunResourceRunner & { _brand: Name },
    RunResourceRunner
  >(name);

  const layer = Layer.effect(
    tag,
    Effect.gen(function* () {
      const wrap = yield* makeRunResourceWrap(limits);
      const runner: RunResourceRunner = <A, E, R>(e: Effect.Effect<A, E, R>) =>
        wrap(e);
      return runner;
    })
  );

  return Object.assign(tag, { layer });
}

/**
 * Factories: {@link RunResource.make} (configured effect) and {@link RunResource.makeRunner} (generic wrap).
 *
 * @public
 */
export const RunResource = {
  make: makeRunResourceGate,
  makeRunner: makeRunResourceRunnerImpl,
} as {
  readonly make: typeof makeRunResourceGate;
  readonly makeRunner: typeof makeRunResourceRunnerImpl;
};
