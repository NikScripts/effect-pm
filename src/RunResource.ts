/**
 * RunResource — concurrency gate for effects.
 *
 * Wraps any effect with bounded concurrency via `Semaphore`. Unlike
 * {@link QueueResource}, there are no queues, priorities, or background workers —
 * the gate is applied inline at the call site. Each call to the gate acquires
 * a permit, executes the effect, and releases the permit on completion.
 *
 * ## Entry points
 *
 * | Function | Purpose |
 * |----------|---------|
 * | `RunResource.make` | Scoped Effect producing a gated callable |
 * | `RunResource.layer` | Builds a `Layer` from tag + config |
 * | `RunResource.Service` | Class factory: tag + baked-in `.layer` |
 * | `RunResource.Tag` | Class factory: pure identity tag (no layer) |
 * | `RunResource.makeRunner` | Generic runner (wraps arbitrary effects) |
 *
 * ## Usage
 *
 * ```ts
 * import { Effect } from "effect"
 * import { RunResource } from "@nikscripts/effect-pm"
 *
 * // Create a gated callable with concurrency 3
 * const program = Effect.scoped(
 *   Effect.gen(function*() {
 *     const fetchPrices = yield* RunResource.make({
 *       name: "@app/FetchPrices",
 *       effect: (symbol: string) => httpClient.get(`/prices/${symbol}`),
 *       concurrency: 3,
 *     })
 *
 *     // Up to 3 concurrent requests; additional calls block until a slot opens
 *     const [aapl, goog, msft] = yield* Effect.all(
 *       [fetchPrices("AAPL"), fetchPrices("GOOG"), fetchPrices("MSFT")],
 *       { concurrency: "unbounded" },
 *     )
 *   })
 * )
 * ```
 *
 * ## Architecture
 *
 * - **Semaphore** with `concurrency` permits controls max parallel executions
 * - Each call to the gate acquires 1 permit, runs the inner effect, releases on exit
 * - The semaphore is allocated once (scoped) and shared across all call sites
 * - No background fibers, no state management beyond the semaphore
 *
 * @module RunResource
 */

import {
  Context,
  Duration,
  Effect,
  Layer,
  Semaphore,
} from "effect";

// ============================================================================
// Public Types
// ============================================================================

/**
 * A gated callable produced by {@link RunResource.make}.
 *
 * Call it with the input to execute the effect through the concurrency gate.
 *
 * @typeParam T - Input type
 * @typeParam A - Success type
 * @typeParam E - Error type
 *
 * @public
 */
export interface RunGate<in T, out A, out E> {
  (input: T): Effect.Effect<A, E>;
}

/**
 * A generic runner that wraps any effect with concurrency + throttle gating.
 * Produced by {@link RunResource.makeRunner}.
 *
 * @public
 */
export interface RunResourceRunner {
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
}

/**
 * Configuration for {@link RunResource.make} and {@link RunResource.Service}.
 *
 * @typeParam T - Input type (void for unit effects)
 * @typeParam A - Success type
 * @typeParam E - Error type
 *
 * @public
 */
export interface RunResourceConfig<T, A, E> {
  /** Service name used for log annotations. */
  readonly name?: string;
  /**
   * The effect to gate. A function receiving the input and returning the effect.
   * For unit gates (no input), use `() => myEffect`.
   */
  readonly effect: (input: T) => Effect.Effect<A, E>;
  /**
   * Max concurrent executions through this gate.
   * @default 1
   */
  readonly concurrency?: number;
}

/**
 * Configuration for {@link RunResource.makeRunner}.
 *
 * @public
 */
export interface RunResourceRunnerConfig {
  /** Service name used for log annotations. */
  readonly name?: string;
  /**
   * Max concurrent executions through this runner.
   * @default 1
   */
  readonly concurrency?: number;
}

// ============================================================================
// Internal: build the gating wrapper
// ============================================================================

/**
 * Allocate a counting semaphore and return a wrapper function.
 *
 * The returned function acquires 1 permit before executing the inner effect
 * and releases it on completion (success, failure, or interruption).
 * This is the core concurrency primitive — all public APIs delegate here.
 *
 * The semaphore is created once per gate instance (not per call), so repeated
 * `yield*` of the same gate share the same concurrency pool.
 */
const makeGateInternal = (concurrency: number) =>
  Effect.gen(function* () {
    const sem = yield* Semaphore.make(concurrency);

    return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      sem.withPermits(1)(effect);
  });

// ============================================================================
// Internal: build the scoped RunGate effect
// ============================================================================

const makeRunGateEffect = <T, A, E>(
  config: RunResourceConfig<T, A, E>,
) =>
  Effect.gen(function* () {
    const concurrency = config.concurrency ?? 1;
    const gate = yield* makeGateInternal(concurrency);

    yield* Effect.logDebug(
      `RunResource "${config.name ?? "anonymous"}" initialized: concurrency=${String(concurrency)}`,
    );

    const runGate: RunGate<T, A, E> = (input: T) => gate(config.effect(input));
    return runGate;
  });

// ============================================================================
// Internal: build the scoped Runner effect
// ============================================================================

const makeRunnerEffect = (config: RunResourceRunnerConfig) =>
  Effect.gen(function* () {
    const concurrency = config.concurrency ?? 1;
    const gate = yield* makeGateInternal(concurrency);

    yield* Effect.logDebug(
      `RunResource runner "${config.name ?? "anonymous"}" initialized: concurrency=${String(concurrency)}`,
    );

    const runner: RunResourceRunner = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> => gate(effect);

    return runner;
  });

// ============================================================================
// Public API
// ============================================================================

/**
 * RunResource namespace — concurrency gate for effects.
 *
 * @public
 */
export const RunResource = {
  /**
   * Create a scoped Effect that produces a gated callable.
   *
   * @example
   * ```ts
   * const gate = yield* RunResource.make({
   *   effect: fetchData(),
   *   concurrency: 3,
   * })
   * const result = yield* gate()
   * ```
   */
  make: makeRunGateEffect,

  /**
   * Build a `Layer` from a Context tag and config.
   *
   * @example
   * ```ts
   * const FetchLayer = RunResource.layer(FetchGate, {
   *   effect: fetchData(),
   *   concurrency: 3,
   * })
   * ```
   */
  layer: <Self, T, A, E>(
    tag: Context.Key<Self, RunGate<T, A, E>>,
    config: RunResourceConfig<T, A, E>,
  ) => Layer.effect(tag)(makeRunGateEffect(config)),

  /**
   * Class factory: creates a Context tag with a baked-in `.layer`.
   *
   * The returned value is both a yieldable tag and has a `.layer` property.
   * Use `typeof MyService` as the Self type at the call site.
   *
   * @example
   * ```ts
   * // Parameterized gate (with input):
   * const SendSms = RunResource.Service<{ readonly _tag: "SendSms" }, PhoneNumber, SmsResult, SmsError>()(
   *   "@app/SendSms",
   *   { effect: (phone) => smsClient.send(phone), concurrency: 5 },
   * )
   * const send = yield* SendSms
   * yield* send("+1234567890")
   *
   * // Unit gate (no input):
   * const RefreshCache = RunResource.Service<{ readonly _tag: "RefreshCache" }, void, void, never>()(
   *   "@app/RefreshCache",
   *   { effect: () => cache.refresh(), concurrency: 1 },
   * )
   * const refresh = yield* RefreshCache
   * yield* refresh(undefined)
   * ```
   */
  Service: <Self, T, A, E = never>() =>
  <const Name extends string>(
    name: Name,
    config: RunResourceConfig<T, A, E>,
  ) => {
    const tag = Context.Service<Self, RunGate<T, A, E>>(name);
    const layer = Layer.effect(tag)(makeRunGateEffect({ ...config, name }));
    return Object.assign(tag, { layer });
  },

  /**
   * Class factory: creates a pure identity Context tag (no default layer).
   *
   * Use with {@link RunResource.layer} to provide implementations.
   * Useful for shared contracts, library interfaces, and dependency inversion.
   *
   * @example
   * ```ts
   * const FetchGate = RunResource.Tag<{ readonly _tag: "FetchGate" }, void, PriceData, FetchError>()(
   *   "@app/FetchGate",
   * )
   * const FetchGateLive = RunResource.layer(FetchGate, {
   *   effect: () => fetchPriceData(),
   *   concurrency: 3,
   * })
   * ```
   */
  Tag: <Self, T, A, E = never>() =>
  <const Name extends string>(name: Name) =>
    Context.Service<Self, RunGate<T, A, E>>(name),

  /**
   * Create a generic runner that wraps any effect with concurrency gating.
   *
   * Returns a Context.Service tag with `.layer`.
   *
   * @example
   * ```ts
   * const ApiGate = RunResource.makeRunner({
   *   name: "@app/ApiGate",
   *   concurrency: 10,
   * })
   *
   * const runner = yield* ApiGate
   * const result = yield* runner(someEffect)
   * ```
   */
  makeRunner: <const Name extends string>(
    config: RunResourceRunnerConfig & { readonly name: Name },
  ) => {
    const tag = Context.Service<
      RunResourceRunner & { readonly _tag: Name },
      RunResourceRunner
    >(config.name);
    const layer = Layer.effect(tag)(makeRunnerEffect(config));
    return Object.assign(tag, { layer });
  },
} as const;

// ============================================================================
// Backwards-compat exports (used by HttpApiResource until rewritten)
// ============================================================================

/**
 * Legacy limits config shape used by {@link HttpApiResource}.
 *
 * @deprecated Use `concurrency` directly on RunResourceConfig.
 * @internal
 */
export interface RunResourceLimits {
  readonly concurrency?: number;
  readonly throttle?: {
    readonly limit: number;
    readonly duration: Duration.Duration;
  };
}

/**
 * Build the concurrency gate wrapper (shared with HttpApiResource).
 * Accepts the legacy `RunResourceLimits | undefined` shape for backwards compat.
 *
 * @internal
 */
export const makeRunResourceWrap = (
  limits: RunResourceLimits | undefined,
): Effect.Effect<
  <A, E, R>(inner: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
  never,
  never
> => {
  if (limits === undefined) {
    return Effect.succeed(<A, E, R>(inner: Effect.Effect<A, E, R>) => inner);
  }
  return Effect.map(
    makeGateInternal(limits.concurrency ?? 1),
    (gate) => <A, E, R>(inner: Effect.Effect<A, E, R>) => gate(inner),
  );
};
