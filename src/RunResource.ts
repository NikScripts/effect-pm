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
 * ## Runtime observation (optional)
 *
 * {@link RunResource.make}, {@link RunResource.layer}, and {@link RunResource.Service}
 * publish per-run facts and `RunResourceState` transitions through
 * {@link RunResourceHubTelemetry} (`R = TelemetryHub`). Persist optionally
 * via {@link ArchiveSink.layerForStore | RunResourceArchiveSinkLayer} at app
 * compose time; emit succeeds with hub only and zero sinks.
 *
 * {@link RunResource.makeRunner} does **not** emit observations — use `make`
 * when you need per-run analytics.
 *
 * ### In-process listeners (no durability)
 *
 * Provide a custom service whose shape matches
 * {@link RunResourceStore.Type} via `Effect.provideService` /
 * `Layer.succeed` and fan out to your callbacks inside each method. A
 * planned future feature (`RunResourceStore.live(resourceId)`)
 * will replace this pattern with a proper `Stream` subscription.
 *
 * **Durable run history (compose at app / `ProcessGroup.localEnvLayer`):**
 *
 * ```ts
 * import { ProcessStore } from "@nikscripts/effect-pm"
 * import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite"
 *
 * const live = layerProcessStore({ filename: ".effect-pm/data.sqlite" })
 * // or ProcessStorage.layer for in-memory dev
 * ```
 *
 * Query persisted runs via {@link RunResourceStore}:
 *
 * ```ts
 * import { RunResourceStore } from "@nikscripts/effect-pm/store/RunResource"
 *
 * const runs = yield* RunResourceStore
 * yield* runs.facts({ resourceId: "@app/FetchPrices" })
 * yield* runs.runs("@app/FetchPrices") // paired started+ended history
 * ```
 *
 * @see {@link RunResourceStore} for durable read/query after compose.
 *
 * @module RunResource
 */

import {
  Cause,
  Clock,
  Context,
  Effect,
  Layer,
  Ref,
  Semaphore,
} from "effect";
import {
  configureLayer,
  configureWrapEffectField,
  foldConfiguredSpec,
  type ConfigPatch,
} from "./ResourceConfigure";
import { RunResourceHubTelemetry } from "./store/runResource/telemetry";
import type { TelemetryHubError } from "./TelemetryHub";
import type {
  RunResourceFact,
  RunResourceFactType,
  RunResourceRunCompletedFact,
  RunResourceRunCompletedPayload,
  RunResourceRunFailedFact,
  RunResourceRunFailedPayload,
  RunResourceRunStartedFact,
  RunResourceRunStartedPayload,
  RunResourceState,
  RunResourceStateChange,
  RunResourceStateChangeReason,
} from "./store/runResource";

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
  (input: T): Effect.Effect<A, E | TelemetryHubError, import("./TelemetryHub").TelemetryHub>;
}

/** @public */
export interface RunResourceMetadata<Id extends string, T, A, E = never> {
  readonly id: Id;
  readonly kind: "RunResource";
  readonly tag: Context.Service<Id, RunGate<T, A, E>>;
}

/** @public */
export type RunResourceDefinition<
  Id extends string,
  T,
  A,
  E = never,
> = Context.Service<Id, RunGate<T, A, E>> &
  RunResourceMetadata<Id, T, A, E>;

/**
 * A generic runner that wraps any effect with concurrency gating.
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

/**
 * Re-exports of the {@link RunResourceStore} facet's domain types
 * for convenience at the consumer module boundary. The owning module is
 * {@link store/RunResource} — import from
 * `@nikscripts/effect-pm/store/RunResource` if you only need types.
 *
 * @public
 */
export type {
  RunResourceFact,
  RunResourceFactType,
  RunResourceRunCompletedFact,
  RunResourceRunCompletedPayload,
  RunResourceRunFailedFact,
  RunResourceRunFailedPayload,
  RunResourceRunStartedFact,
  RunResourceRunStartedPayload,
  RunResourceState,
  RunResourceStateChange,
  RunResourceStateChangeReason,
};

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
  // Allocate semaphore → return a wrapper that acquires 1 permit per call
  Effect.map(
    Semaphore.make(concurrency),
    (sem) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        sem.withPermits(1)(effect),
  );

// ============================================================================
// Internal: build the scoped RunGate effect
// ============================================================================

const makeRunGateEffect = <T, A, E>(
  config: RunResourceConfig<T, A, E>,
) => {
  const concurrency = config.concurrency ?? 1;
  const resourceId = config.name ?? "anonymous";
  let runSeq = 0;
  const nextRunId = Effect.sync(() => {
    runSeq += 1;
    return `${resourceId}/run/${String(runSeq)}`;
  });
  let stateSeq = 0;
  const nextStateChangeId = Effect.sync(() => {
    stateSeq += 1;
    return `${resourceId}/state/${String(stateSeq)}`;
  });

  const publishRunStarted = (
    runId: string,
    payload: RunResourceRunStartedPayload,
  ): Effect.Effect<void, TelemetryHubError, import("./TelemetryHub").TelemetryHub> =>
    Effect.gen(function* () {
      const occurredAt = yield* Clock.currentTimeMillis;
      yield* RunResourceHubTelemetry.Run.started({
        resourceId,
        runId,
        occurredAt,
        payload,
      });
    });

  const publishRunCompleted = (
    runId: string,
    payload: RunResourceRunCompletedPayload,
  ): Effect.Effect<void, TelemetryHubError, import("./TelemetryHub").TelemetryHub> =>
    Effect.gen(function* () {
      const occurredAt = yield* Clock.currentTimeMillis;
      yield* RunResourceHubTelemetry.Run.completed({
        resourceId,
        runId,
        occurredAt,
        payload,
      });
    });

  const publishRunFailed = (
    runId: string,
    payload: RunResourceRunFailedPayload,
  ): Effect.Effect<void, TelemetryHubError, import("./TelemetryHub").TelemetryHub> =>
    Effect.gen(function* () {
      const occurredAt = yield* Clock.currentTimeMillis;
      yield* RunResourceHubTelemetry.Run.failed({
        resourceId,
        runId,
        occurredAt,
        payload,
      });
    });

  const makeInitialState = (observedAt: number): RunResourceState => ({
    resourceId,
    observedAt,
    configVersion: 1,
    concurrency,
    waiting: 0,
    inFlight: 0,
    completed: 0,
    failed: 0,
    interrupted: 0,
    totalDurationMs: 0,
  });

  // Allocate gate → log init → wrap user's effect with the gate
  return Effect.gen(function* () {
    const sem = yield* Semaphore.make(concurrency);
    const initializedAt = yield* Clock.currentTimeMillis;
    const stateRef = yield* Ref.make(makeInitialState(initializedAt));
    const publishState = (
      reason: RunResourceStateChangeReason,
      update: (state: RunResourceState, observedAt: number) => RunResourceState,
    ): Effect.Effect<void, TelemetryHubError, import("./TelemetryHub").TelemetryHub> =>
      Effect.gen(function* () {
        const id = yield* nextStateChangeId;
        const changedAt = yield* Clock.currentTimeMillis;
        const change = yield* Ref.modify(stateRef, (previous) => {
          const current = update(previous, changedAt);
          return [
            {
              id,
              resourceId,
              changedAt,
              reason,
              previous,
              current,
            },
            current,
          ] as const;
        });
        yield* RunResourceHubTelemetry.State.changed({
          id: change.id,
          changedAt: change.changedAt,
          reason: change.reason,
          previous: change.previous,
          current: change.current,
        });
      });

    yield* Effect.logDebug(
      `RunResource "${config.name ?? "anonymous"}" initialized: concurrency=${String(concurrency)}`,
    );

    // The returned callable applies the gate around each invocation and emits
    // optional runtime observations without changing the user's success/error channel.
    return (input: T) =>
      Effect.gen(function* () {
        const runId = yield* nextRunId;
        const acquirePermit = Effect.gen(function* () {
          yield* publishState("RunResource.State.Waiting", (state, observedAt) => ({
            ...state,
            observedAt,
            waiting: state.waiting + 1,
          }));
          yield* sem.take(1).pipe(
            Effect.onInterrupt(() =>
              publishState("RunResource.State.WaitInterrupted", (state, observedAt) => ({
                ...state,
                observedAt,
                waiting: Math.max(0, state.waiting - 1),
                interrupted: state.interrupted + 1,
              }))
            ),
          );
        });

        return yield* Effect.acquireUseRelease(
          acquirePermit,
          () => Effect.gen(function* () {
            const startedAt = yield* Clock.currentTimeMillis;
            yield* publishState("RunResource.State.Started", (state, observedAt) => ({
              ...state,
              observedAt,
              waiting: Math.max(0, state.waiting - 1),
              inFlight: state.inFlight + 1,
            }));
            yield* publishRunStarted(runId, { concurrency });

            return yield* Effect.matchCauseEffect(config.effect(input), {
              onFailure: (cause) =>
                Effect.gen(function* () {
                  const failedAt = yield* Clock.currentTimeMillis;
                  const durationMs = Math.max(0, failedAt - startedAt);
                  const wasInterrupted = Cause.hasInterrupts(cause);
                  yield* publishState(
                    wasInterrupted ? "RunResource.State.Interrupted" : "RunResource.State.Failed",
                    (state, observedAt) => ({
                      ...state,
                      observedAt,
                      inFlight: Math.max(0, state.inFlight - 1),
                      failed: wasInterrupted ? state.failed : state.failed + 1,
                      interrupted: wasInterrupted ? state.interrupted + 1 : state.interrupted,
                      totalDurationMs: state.totalDurationMs + durationMs,
                    }),
                  );
                  yield* publishRunFailed(runId, {
                    durationMs,
                    cause: Cause.pretty(cause),
                  });
                  return yield* Effect.failCause(cause);
                }),
              onSuccess: (value) =>
                Effect.gen(function* () {
                  const completedAt = yield* Clock.currentTimeMillis;
                  const durationMs = Math.max(0, completedAt - startedAt);
                  yield* publishState("RunResource.State.Completed", (state, observedAt) => ({
                    ...state,
                    observedAt,
                    inFlight: Math.max(0, state.inFlight - 1),
                    completed: state.completed + 1,
                    totalDurationMs: state.totalDurationMs + durationMs,
                  }));
                  yield* publishRunCompleted(runId, { durationMs });
                  return value;
                }),
            });
          }),
          () => Effect.asVoid(sem.release(1)),
        );
      });
  });
};

// ============================================================================
// Internal: build the scoped Runner effect
// ============================================================================

const makeRunnerEffect = (config: RunResourceRunnerConfig) => {
  const concurrency = config.concurrency ?? 1;
  // Allocate gate → log init → return a generic wrapper that gates any effect
  return makeGateInternal(concurrency).pipe(
    Effect.tap(() =>
      Effect.logDebug(
        `RunResource runner "${config.name ?? "anonymous"}" initialized: concurrency=${String(concurrency)}`,
      ),
    ),
    // The runner wraps arbitrary effects (not tied to a specific effect like RunGate)
    Effect.map((gate): RunResourceRunner =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) => gate(effect),
    ),
  );
};

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
  ) =>
    Layer.effect(tag)(
      foldConfiguredSpec(config.name ?? "anonymous", {
        ...config,
        name: config.name ?? "anonymous",
      }).pipe(Effect.flatMap(makeRunGateEffect)),
    ),

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
    const defaultSpec = { ...config, name };
    const base = Context.Service<Self, RunGate<T, A, E>>()(name);
    const buildGate = foldConfiguredSpec(name, defaultSpec).pipe(
      Effect.flatMap(makeRunGateEffect),
    );
    return Object.assign(base, {
      id: name,
      kind: "RunResource" as const,
      tag: base,
      defaultSpec,
      configure: (patch: ConfigPatch<RunResourceConfig<T, A, E>>) =>
        configureLayer(name, patch),
      wrapGate: (
        fn: (
          previous: RunResourceConfig<T, A, E>["effect"],
        ) => RunResourceConfig<T, A, E>["effect"],
      ) => configureWrapEffectField(name, fn),
      layer: Layer.effect(base)(buildGate),
    });
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
    {
      const base = Context.Service<Self, RunGate<T, A, E>>()(name);
      return Object.assign(base, {
        id: name,
        kind: "RunResource" as const,
        tag: base,
      });
    },

  /**
   * Create a generic runner that wraps any effect with concurrency gating.
   *
   * Does not publish {@link RunResourceStore} facts or state — only semaphore gating.
   * Use {@link RunResource.make} when you need durable or in-process run analytics.
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

