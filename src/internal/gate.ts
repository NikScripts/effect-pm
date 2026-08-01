/**
 * Gate engine — semaphore gate handles with optional live observation and
 * presence-driven Effect {@link RateLimiter} (Soft memory when no store).
 *
 * @internal
 */

import * as Context from "effect/Context";
import {
  Cause,
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Latch,
  Layer,
  Option,
  Ref,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import * as Lifecycle from "../Lifecycle";
import {
  RateLimitExceeded,
  RateLimiter as RateLimiterTag,
  RateLimiterError,
  RateLimiterStore,
  layer as rateLimiterLayer,
  layerStoreMemory,
  make as makeRateLimiter,
} from "effect/unstable/persistence/RateLimiter";
import type {
  ConsumeResult,
  RateLimiter as EffectRateLimiter,
} from "effect/unstable/persistence/RateLimiter";
import {
  builtInGateStoreContract,
  type GateStateChangeReason,
  type GateStateChange,
} from "./store/gateStoreSpec";
import { mapSubscribable, subscribable, type Subscribable } from "../Hyperlink";
import * as Store from "../Store";
import type { StoreScopeTag } from "./store/registration";
import { errorOf, successOf } from "./gateTagSchemas";
import { makeGateStateChange, extractGateFailure } from "./gateFacts";
import { runStatusTransitions } from "./gateStatus";

// ============================================================================
// Engine types
// ============================================================================

/**
 * Effect `RateLimiter.consume` / {@link makeWithRateLimiter} options — the
 * upstream config shape. New consume fields from Effect flow through here.
 *
 * @category models
 * @public
 */
export type RateLimiterConsumeOptions = Parameters<
  EffectRateLimiter["consume"]
>[0];

/**
 * Gate `rateLimit` config — Effect's {@link RateLimiterConsumeOptions} with
 * optional `key` (defaults to the gate `name` / hyperlink tag id).
 *
 * @remarks
 * This is not a parallel Hyperlink schema: it is Effect's consume options.
 * Hyperlink only defaults omitted `key` and omitted `onExceeded` (`"delay"`;
 * Effect's own consume default is `"fail"`). Store selection is ambient
 * {@link RateLimiterStore} / {@link RateLimiterTag} (Soft memory when absent).
 *
 * @category models
 * @public
 */
export type GateRateLimitOptions = Omit<RateLimiterConsumeOptions, "key"> & {
  /** Shared limit bucket (default: gate `name` / service id). */
  readonly key?: RateLimiterConsumeOptions["key"];
};

/** @public Re-export of Effect rate-limiter consume metadata. */
export type { ConsumeResult };

/**
 * Failure when a call is admitted to a **stopped** gate (Lifecycle `Draining` /
 * `Off`), or a waiting call is failed by a `stopMode: "failWaiting"` stop.
 * In-flight bodies always finish.
 *
 * @remarks
 * Present on the local {@link makeGateRunHandleEffect} / {@link makeGateHandleEffect}
 * `run` error channel (so `Effect.catchTag("GateStopped", …)` typechecks there). On
 * Tag / Service wire `run`, the declared error schema wins — match through
 * `Cause.findErrorOption` (same erasure pattern as {@link RateLimiterError}).
 *
 * @category errors
 * @public
 */
export class GateStopped extends Data.TaggedError("GateStopped")<{
  readonly resourceId: string;
}> {}

/**
 * How a `stop` treats calls already **waiting** for a permit / resume:
 * - `"failWaiting"` (default) — fail them with {@link GateStopped}.
 * - `"finishWaiting"` — let them acquire + run; only new calls are rejected.
 *
 * In-flight bodies always finish regardless.
 *
 * @category models
 * @public
 */
export type GateStopMode = "failWaiting" | "finishWaiting";

/** Live limiter observation under the wire `metrics` nest. @internal */
export interface GateMetrics {
  readonly remaining: number;
  readonly resetAfterMs: number;
  readonly exceeded: number;
}

/** Live counters for a gated resource handle. @internal */
export interface GateStatus {
  readonly resourceId: string;
  readonly observedAt: number;
  readonly configVersion: number;
  readonly concurrency: number;
  readonly waiting: number;
  readonly inFlight: number;
  readonly completed: number;
  readonly failed: number;
  readonly interrupted: number;
  readonly totalDurationMs: number;
}

type GateRunFn<T, A, E> = [T] extends [void]
  ? () => Effect.Effect<A, E>
  : (input: T) => Effect.Effect<A, E>;

/** Minimal handle from {@link makeGateRunHandleEffect} — run only. @internal */
export type GateRunHandle<T, A, E> = {
  readonly run: GateRunFn<T, A, E>;
};

/** Observable handle from {@link makeGateHandleEffect}. @internal */
export type GateHandle<T, A, E> = GateRunHandle<T, A, E> & {
  readonly status: Subscribable<GateStatus>;
  readonly waiting: Subscribable<number>;
  readonly inFlight: Subscribable<number>;
  readonly completed: Subscribable<number>;
  readonly failed: Subscribable<number>;
  readonly interrupted: Subscribable<number>;
  readonly metrics: {
    readonly remaining: Subscribable<number>;
    readonly resetAfter: Subscribable<number>;
    readonly exceeded: Subscribable<number>;
  };
  /** Resolved rate-limit bucket key when `rateLimit` is set; otherwise absent. */
  readonly rateLimitKey: string | undefined;
  /** Wire nest path for limiter fields (v1 always `"metrics"`). */
  readonly metricsKey: "metrics";
  /** Shared {@link Lifecycle} handle — SSOT badge + pause/resume/stop for the gate. */
  readonly lifecycle: Lifecycle.LifecyclePausable;
  /** Live-resize the concurrency limit (`Semaphore.resize` + bump `configVersion`). */
  readonly setConcurrency: (concurrency: number) => Effect.Effect<void>;
  /** Live-reconfigure the rate limit (bumps `configVersion`); `undefined` clears it. */
  readonly setRateLimit: (
    rateLimit: GateRateLimitOptions | null | undefined,
  ) => Effect.Effect<void>;
};

/** @internal */
export interface GateConfig<T, A, E> {
  readonly name?: string;
  readonly scopeKey?: string;
  readonly tag?: StoreScopeTag;
  readonly effect: (input: T) => Effect.Effect<A, E>;
  readonly concurrency?: number;
  /**
   * Optional Effect `RateLimiter` on each `run` (before the concurrency semaphore).
   * Omitted = no rate limit (only `concurrency`).
   */
  readonly rateLimit?: GateRateLimitOptions;
  /**
   * How `stop` treats calls already waiting for a permit / resume.
   * @default "failWaiting"
   */
  readonly stopMode?: GateStopMode;
}

/** @internal */
export interface GateRunnerConfig {
  readonly name?: string;
  readonly concurrency?: number;
}

/** @internal */
export interface GateRunner {
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
}

/** Engine-facing store context — `Storage` discharged at the gate boundary. @internal */
interface GateStoreContext {
  readonly resourceId: string;
  readonly persistSuccess: boolean;
  readonly persistTypedError: boolean;
  readonly fact: {
    readonly append: (row: unknown) => Effect.Effect<void>;
  };
  readonly recordStateChange: (
    reason: GateStateChangeReason,
    previous: GateStatus | null,
    current: GateStatus,
  ) => Effect.Effect<void>;
  readonly nextFactId: (runId: string, suffix: string) => Effect.Effect<string>;
}

/** Mint a stable run id for the current attempt. @internal */
export const nextRunId = (
  resourceId: string,
  runSeq: number,
): string => `${resourceId}/run/${String(runSeq)}`;

const makeInitialStatus = (
  resourceId: string,
  concurrency: number,
  observedAt: number,
): GateStatus => ({
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

const makeStatusSubscribables = (
  statusRef: SubscriptionRef.SubscriptionRef<GateStatus>,
) => {
  const status = subscribable(statusRef);
  return {
    status,
    waiting: mapSubscribable(status, (s) => s.waiting),
    inFlight: mapSubscribable(status, (s) => s.inFlight),
    completed: mapSubscribable(status, (s) => s.completed),
    failed: mapSubscribable(status, (s) => s.failed),
    interrupted: mapSubscribable(status, (s) => s.interrupted),
  } as const;
};

const makeGateStoreContext = (options: {
  readonly resourceId: string;
  readonly scopeKey: string;
  readonly tag?: StoreScopeTag;
  readonly storeEffects: {
    readonly fact: {
      readonly append: (row: unknown) => Effect.Effect<void>;
    };
    readonly state: {
      readonly append: (change: GateStateChange) => Effect.Effect<void>;
    };
  };
}): Effect.Effect<GateStoreContext> =>
  Effect.gen(function* () {
    const scopeTag = options.tag ?? { key: options.scopeKey };
    const { storeEffects, resourceId } = options;
    const stateSeqRef = yield* Ref.make(0);
    const factSeqRef = yield* Ref.make(0);
    const persistSuccess = successOf(scopeTag) !== undefined;
    const persistTypedError = errorOf(scopeTag) !== undefined;

    const nextStateId = (): Effect.Effect<string> =>
      Ref.updateAndGet(stateSeqRef, (n) => n + 1).pipe(
        Effect.map((seq) => `${resourceId}/state/${String(seq)}`),
      );

    const nextFactId = (runId: string, suffix: string): Effect.Effect<string> =>
      Ref.updateAndGet(factSeqRef, (n) => n + 1).pipe(
        Effect.map((seq) => `${runId}/${suffix}/${String(seq)}`),
      );

    return {
      resourceId,
      persistSuccess,
      persistTypedError,
      fact: storeEffects.fact,
      nextFactId,
      recordStateChange: (reason, previous, current) =>
        Effect.gen(function* () {
          const change = makeGateStateChange({
            id: yield* nextStateId(),
            resourceId,
            changedAt: current.observedAt,
            reason,
            previous,
            current,
          });
          yield* storeEffects.state.append(change);
        }),
    };
  });

// ============================================================================
// Rate limit (presence-driven RateLimiterStore)
// ============================================================================

/**
 * Soft in-memory {@link RateLimiterTag} + store — used when `rateLimit` is set
 * and no ambient {@link RateLimiterStore} is in context. Compose
 * `RateLimiter.layerStoreRedis` at the app root for fleet-wide limiting.
 *
 * @category layers & serving
 * @public
 */
export const gateRateLimiterLayer = Layer.provide(rateLimiterLayer, layerStoreMemory);

/** Fill Gate defaults onto Effect's consume options — passthrough otherwise. */
const toConsumeOptions = (
  resourceId: string,
  rateLimit: GateRateLimitOptions,
): RateLimiterConsumeOptions => ({
  ...rateLimit,
  key: rateLimit.key ?? resourceId,
  onExceeded: rateLimit.onExceeded ?? "delay",
});

const assertValidRateLimit = (rateLimit: GateRateLimitOptions): void => {
  if (!(rateLimit.limit > 0) || !Number.isFinite(rateLimit.limit)) {
    throw new Error(
      `Gate rateLimit.limit must be a positive number, got ${String(rateLimit.limit)}`,
    );
  }
  const windowMs = Duration.toMillis(Duration.fromInputUnsafe(rateLimit.window));
  if (!(windowMs > 0) || !Number.isFinite(windowMs)) {
    throw new Error(
      `Gate rateLimit.window must be positive, got ${String(rateLimit.window)}`,
    );
  }
  if (rateLimit.tokens !== undefined) {
    if (!(rateLimit.tokens > 0) || !Number.isFinite(rateLimit.tokens)) {
      throw new Error(
        `Gate rateLimit.tokens must be a positive number, got ${String(rateLimit.tokens)}`,
      );
    }
  }
};

/**
 * Resolve {@link RateLimiterTag} once into the gate scope.
 *
 * Order (Effect services via Context — never passed in the `rateLimit` config bag):
 * 1. Ambient {@link RateLimiterTag} if already provided
 * 2. Else ambient {@link RateLimiterStore} → {@link makeRateLimiter} (fleet Redis / later SQL)
 * 3. Else Soft {@link gateRateLimiterLayer} (memory store + limiter)
 */
const resolveGateRateLimiter = (): Effect.Effect<
  EffectRateLimiter,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const limiterOpt = yield* Effect.serviceOption(RateLimiterTag);
    if (Option.isSome(limiterOpt)) {
      return limiterOpt.value;
    }
    const storeOpt = yield* Effect.serviceOption(RateLimiterStore);
    if (Option.isSome(storeOpt)) {
      return yield* makeRateLimiter.pipe(
        Effect.provideService(RateLimiterStore, storeOpt.value),
      );
    }
    const ctx = yield* Layer.build(gateRateLimiterLayer);
    return Context.get(ctx, RateLimiterTag);
  });

type RateLimitAwait = Effect.Effect<void, RateLimiterError>;

const isRateLimitExceededReason = (
  reason: RateLimiterError["reason"],
): reason is RateLimitExceeded => reason._tag === "RateLimitExceeded";

type MetricsPublisher = {
  readonly publishConsume: (result: ConsumeResult) => Effect.Effect<void>;
  readonly publishExceeded: (
    remaining: number,
    resetAfterMs: number,
  ) => Effect.Effect<void>;
};

/**
 * Build a pre-consume effect that keeps full {@link ConsumeResult} metadata for
 * the `metrics` nest (WorkPool-style — not `makeWithRateLimiter`, which drops it).
 */
const acquireGateRateLimitAwait = (
  resourceId: string,
  rateLimit: GateRateLimitOptions,
  limiter: EffectRateLimiter,
  metrics: MetricsPublisher,
): RateLimitAwait => {
  assertValidRateLimit(rateLimit);
  const options = toConsumeOptions(resourceId, rateLimit);
  const onExceeded = options.onExceeded ?? "delay";

  if (onExceeded === "fail") {
    return limiter.consume(options).pipe(
      Effect.flatMap((result) => metrics.publishConsume(result)),
      Effect.catchTag("RateLimiterError", (error) =>
        Effect.gen(function* () {
          if (isRateLimitExceededReason(error.reason)) {
            yield* metrics.publishExceeded(
              error.reason.remaining,
              Duration.toMillis(error.reason.retryAfter),
            );
          }
          return yield* error;
        }),
      ),
    );
  }

  return Effect.gen(function* () {
    const result = yield* limiter.consume(options);
    yield* metrics.publishConsume(result);
    if (!Duration.isZero(result.delay)) {
      yield* metrics.publishExceeded(
        result.remaining,
        Duration.toMillis(result.resetAfter),
      );
      yield* Effect.sleep(result.delay);
    }
  });
};

const makeMetricsPublisher = (
  remainingRef: SubscriptionRef.SubscriptionRef<number>,
  resetAfterRef: SubscriptionRef.SubscriptionRef<number>,
  exceededRef: SubscriptionRef.SubscriptionRef<number>,
): MetricsPublisher => ({
  publishConsume: (result) =>
    Effect.gen(function* () {
      yield* SubscriptionRef.set(remainingRef, result.remaining);
      yield* SubscriptionRef.set(
        resetAfterRef,
        Duration.toMillis(result.resetAfter),
      );
    }),
  publishExceeded: (remaining, resetAfterMs) =>
    Effect.gen(function* () {
      yield* SubscriptionRef.set(remainingRef, remaining);
      yield* SubscriptionRef.set(resetAfterRef, resetAfterMs);
      yield* SubscriptionRef.update(exceededRef, (n) => n + 1);
    }),
});

const makeMetricsSubscribables = (
  remainingRef: SubscriptionRef.SubscriptionRef<number>,
  resetAfterRef: SubscriptionRef.SubscriptionRef<number>,
  exceededRef: SubscriptionRef.SubscriptionRef<number>,
) => ({
  remaining: subscribable(remainingRef),
  resetAfter: subscribable(resetAfterRef),
  exceeded: subscribable(exceededRef),
});

/** Waiter registry — cancel Deferreds for calls in the waiting phase (`failWaiting`). @internal */
type GateWaiters = Ref.Ref<ReadonlySet<Deferred.Deferred<never, GateStopped>>>;

/** Dependencies threaded into the admit-gated run builder. @internal */
interface GateAdmitDeps<T, A, E> {
  readonly sem: Semaphore.Semaphore;
  readonly effect: (input: T) => Effect.Effect<A, E>;
  readonly statusRef: SubscriptionRef.SubscriptionRef<GateStatus>;
  readonly store: GateStoreContext;
  readonly runSeqRef: Ref.Ref<number>;
  /** Pre-permit rate-limit consume (reads the live options Ref); `void` when no limit. */
  readonly rateLimitStep: Effect.Effect<void, RateLimiterError>;
  readonly latch: Latch.Latch;
  readonly lifecycleState: SubscriptionRef.SubscriptionRef<Lifecycle.State>;
  readonly waiters: GateWaiters;
  readonly stopMode: GateStopMode;
  readonly resourceId: string;
}

const makeObservedRun = <T, A, E>(
  deps: GateAdmitDeps<T, A, E>,
): GateRunFn<T, A, E | RateLimiterError | GateStopped> => {
  const {
    sem,
    effect,
    statusRef,
    store,
    runSeqRef,
    rateLimitStep,
    latch,
    lifecycleState,
    waiters,
    stopMode,
    resourceId,
  } = deps;

  const publishStatus = (
    update: (typeof runStatusTransitions)[keyof typeof runStatusTransitions]["update"],
    reason: GateStateChangeReason,
    durationMs?: number,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const observedAt = yield* Clock.currentTimeMillis;
      const previous = yield* SubscriptionRef.get(statusRef);
      const current = update(previous, observedAt, durationMs);
      yield* SubscriptionRef.set(statusRef, current);
      yield* store.recordStateChange(reason, previous, current);
    });

  // Body run under a held permit — publish `started`, run, record the outcome.
  const bodyEffect = (input: T): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const runSeq = yield* Ref.updateAndGet(runSeqRef, (n) => n + 1);
      const current = yield* SubscriptionRef.get(statusRef);
      const runId = nextRunId(current.resourceId, runSeq);
      const startedId = yield* store.nextFactId(runId, "Started");
      yield* store.fact.append({
        _tag: "Started",
        id: startedId,
        resourceId: store.resourceId,
        runId,
        occurredAt: startedAt,
        concurrency: current.concurrency,
      });
      const started = runStatusTransitions.started;
      yield* publishStatus(started.update, started.reason);

      return yield* effect(input).pipe(
        Effect.onExit((exit) =>
          Effect.uninterruptible(
            Effect.gen(function* () {
              const endedAt = yield* Clock.currentTimeMillis;
              const durationMs = Math.max(0, endedAt - startedAt);
              if (Exit.isSuccess(exit)) {
                const completedId = yield* store.nextFactId(runId, "Completed");
                yield* store.fact.append(
                  store.persistSuccess
                    ? {
                        _tag: "Completed",
                        id: completedId,
                        resourceId: store.resourceId,
                        runId,
                        occurredAt: endedAt,
                        durationMs,
                        success: exit.value,
                      }
                    : {
                        _tag: "Completed",
                        id: completedId,
                        resourceId: store.resourceId,
                        runId,
                        occurredAt: endedAt,
                        durationMs,
                      },
                );
                const completed = runStatusTransitions.completed;
                yield* publishStatus(completed.update, completed.reason, durationMs);
              } else if (Cause.hasInterrupts(exit.cause)) {
                const interrupted = runStatusTransitions.interrupted;
                yield* publishStatus(
                  interrupted.update,
                  interrupted.reason,
                  durationMs,
                );
              } else {
                const failedId = yield* store.nextFactId(runId, "Failed");
                const error = extractGateFailure(exit.cause);
                yield* store.fact.append({
                  _tag: "Failed",
                  id: failedId,
                  resourceId: store.resourceId,
                  runId,
                  occurredAt: endedAt,
                  durationMs,
                  error: store.persistTypedError ? error : String(error),
                });
                const failed = runStatusTransitions.failed;
                yield* publishStatus(failed.update, failed.reason, durationMs);
              }
            }),
          ),
        ),
      );
    });

  const runBody = (
    input: T,
  ): Effect.Effect<A, E | RateLimiterError | GateStopped> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        // 1. Reject new calls once stopped (Draining / Off).
        const state = yield* SubscriptionRef.get(lifecycleState);
        if (state._tag === "Draining" || state._tag === "Off") {
          return yield* new GateStopped({ resourceId });
        }

        // Register a cancel latch for `failWaiting` so a stop can fail this waiter.
        const cancel =
          stopMode === "failWaiting"
            ? yield* Deferred.make<never, GateStopped>()
            : undefined;
        if (cancel !== undefined) {
          yield* Ref.update(waiters, (set) => {
            const next = new Set(set);
            next.add(cancel);
            return next;
          });
        }
        const unregister =
          cancel === undefined
            ? Effect.void
            : Ref.update(waiters, (set) => {
                const next = new Set(set);
                next.delete(cancel);
                return next;
              });

        const waiting = runStatusTransitions.waiting;
        yield* publishStatus(waiting.update, waiting.reason);

        // 2. Wait for admittance: hold while paused, then rate-limit, then a permit.
        //    Race the cancel latch (failWaiting) so a stop fails the waiter.
        const acquireSeq = Latch.whenOpen(
          latch,
          rateLimitStep.pipe(Effect.andThen(Effect.asVoid(sem.take(1)))),
        );
        const raced =
          cancel === undefined
            ? acquireSeq
            : Effect.raceFirst(acquireSeq, Deferred.await(cancel));

        yield* restore(raced).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? Effect.uninterruptible(
                  publishStatus(
                    runStatusTransitions.waitInterrupted.update,
                    runStatusTransitions.waitInterrupted.reason,
                  ),
                )
              : Effect.void,
          ),
          Effect.ensuring(unregister),
        );

        // 3. Permit held. Hold once more while paused, then run the body; in-flight
        //    always finishes. Release the permit on exit.
        return yield* restore(Latch.whenOpen(latch, bodyEffect(input))).pipe(
          Effect.ensuring(Effect.asVoid(sem.release(1))),
        );
      }),
    );

  // Boundary cast: `GateRunFn` is a void-vs-payload conditional TS can't reduce for
  // generic `T`. The implementation always takes `T`; unit gates pass `undefined`.
  return ((input: T) => runBody(input)) as GateRunFn<
    T,
    A,
    E | RateLimiterError | GateStopped
  >;
};

/**
 * Scoped gate handle with `.run` only — no live observation.
 *
 * @internal
 */
export const makeGateRunHandleEffect = <T, A, E>(
  config: GateConfig<T, A, E>,
): Effect.Effect<
  GateRunHandle<T, A, E | RateLimiterError | GateStopped>,
  never,
  Store.Storage | Scope.Scope
> =>
  Effect.map(makeGateHandleEffect(config), (handle) => ({
    run: handle.run,
  }));

/**
 * Scoped observable gate handle — {@link SubscriptionRef}-backed status and scalar views,
 * plus a shared {@link Lifecycle} (pause holds, `stop` rejects new calls) and live
 * `setConcurrency` / `setRateLimit` reconfig.
 *
 * @internal
 */
export const makeGateHandleEffect = <T, A, E>(
  config: GateConfig<T, A, E>,
): Effect.Effect<
  GateHandle<T, A, E | RateLimiterError | GateStopped>,
  never,
  Store.Storage | Scope.Scope
> => {
  const concurrency = config.concurrency ?? 1;
  const resourceId = config.name ?? "anonymous";
  const scopeKey = config.scopeKey ?? resourceId;
  const scopeTag = config.tag ?? { key: scopeKey };
  const stopMode: GateStopMode = config.stopMode ?? "failWaiting";

  return Effect.gen(function* () {
    const sem = yield* Semaphore.make(concurrency);
    const initializedAt = yield* Clock.currentTimeMillis;
    const statusRef = yield* SubscriptionRef.make(
      makeInitialStatus(resourceId, concurrency, initializedAt),
    );
    const initialRemaining =
      config.rateLimit === undefined ? 0 : config.rateLimit.limit;
    const remainingRef = yield* SubscriptionRef.make(initialRemaining);
    const resetAfterRef = yield* SubscriptionRef.make(0);
    const exceededRef = yield* SubscriptionRef.make(0);
    const metricsPublisher = makeMetricsPublisher(
      remainingRef,
      resetAfterRef,
      exceededRef,
    );
    // Fail-loud Soft: AppStore missing this Gate registration dies at layer build.
    yield* Store.resolveOrDie(
      scopeKey,
      builtInGateStoreContract(scopeTag),
    );
    const storageContext = yield* Effect.context<Store.Storage>();
    const storeEffects = Store.provideContext(
      Store.catchWriteErrors(
        Store.effects(scopeKey, builtInGateStoreContract(scopeTag)),
      ),
      storageContext,
    );
    const store = yield* makeGateStoreContext({
      resourceId,
      scopeKey,
      tag: config.tag,
      storeEffects: storeEffects as {
        readonly fact: { readonly append: (row: unknown) => Effect.Effect<void> };
        readonly state: { readonly append: (change: GateStateChange) => Effect.Effect<void> };
      },
    });
    const runSeqRef = yield* Ref.make(0);

    // Resolve the limiter once (presence-driven). Live rate-limit options live in a Ref so
    // `setRateLimit` can enable / disable / retune without rebuilding the limiter.
    const limiter = yield* resolveGateRateLimiter();
    const rateLimitOptionsRef = yield* Ref.make<GateRateLimitOptions | undefined>(
      config.rateLimit,
    );

    const rateLimitKey =
      config.rateLimit === undefined
        ? undefined
        : (config.rateLimit.key ?? resourceId);

    // Pre-permit rate-limit consume, reading the live options Ref each call.
    const rateLimitStep: Effect.Effect<void, RateLimiterError> = Effect.gen(
      function* () {
        const rl = yield* Ref.get(rateLimitOptionsRef);
        if (rl === undefined) return;
        yield* acquireGateRateLimitAwait(resourceId, rl, limiter, metricsPublisher);
      },
    );

    const waiters: GateWaiters = yield* Ref.make<
      ReadonlySet<Deferred.Deferred<never, GateStopped>>
    >(new Set());

    // Latch open ⇒ admitting; closed ⇒ paused (waiters + step-3 holders block).
    const latch = yield* Latch.make(true);

    // Drain gate: `stop` blocks until in-flight drains (and, for finishWaiting, waiters too).
    // A Deferred + status monitor is race-free where a bare `changes` filter would miss the
    // already-drained (idle-at-stop) case (SubscriptionRef.changes does not replay the current).
    const drainingRef = yield* Ref.make(false);
    const offDone = yield* Deferred.make<void>();
    const isDrained = (s: GateStatus): boolean =>
      stopMode === "finishWaiting"
        ? s.inFlight === 0 && s.waiting === 0
        : s.inFlight === 0;
    const maybeSignalDrained = Effect.gen(function* () {
      if (!(yield* Ref.get(drainingRef))) return;
      if (isDrained(yield* SubscriptionRef.get(statusRef))) {
        yield* Deferred.succeed(offDone, undefined);
      }
    });

    // On stop (state already Draining ⇒ new calls rejected): fail waiters (failWaiting), then
    // open the latch so paused waiters / permit-holders can wind down. `awaitBeforeTerminal`
    // then blocks until the gate has drained.
    const release = Effect.gen(function* () {
      yield* Ref.set(drainingRef, true);
      if (stopMode === "failWaiting") {
        const pending = yield* Ref.getAndSet(
          waiters,
          new Set<Deferred.Deferred<never, GateStopped>>(),
        );
        yield* Effect.forEach(
          pending,
          (d) => Deferred.fail(d, new GateStopped({ resourceId })),
          { discard: true },
        );
      }
      yield* latch.open;
      yield* maybeSignalDrained;
    });

    const lifecycle = yield* Lifecycle.make({
      run: Effect.never,
      latch,
      release,
      awaitBeforeTerminal: Deferred.await(offDone),
      afterStop: Lifecycle.off,
    });

    // Post-stop drain watcher — every status change re-checks the drain condition.
    yield* Effect.forkScoped(
      Stream.runForEach(SubscriptionRef.changes(statusRef), () =>
        maybeSignalDrained,
      ),
    );

    const setConcurrency = (next: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* sem.resize(next);
        const observedAt = yield* Clock.currentTimeMillis;
        yield* SubscriptionRef.update(statusRef, (s) => ({
          ...s,
          concurrency: next,
          configVersion: s.configVersion + 1,
          observedAt,
        }));
      });

    const setRateLimit = (
      next: GateRateLimitOptions | null | undefined,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const options = next ?? undefined;
        if (options !== undefined) assertValidRateLimit(options);
        yield* Ref.set(rateLimitOptionsRef, options);
        yield* SubscriptionRef.set(remainingRef, options?.limit ?? 0);
        yield* SubscriptionRef.set(resetAfterRef, 0);
        const observedAt = yield* Clock.currentTimeMillis;
        yield* SubscriptionRef.update(statusRef, (s) => ({
          ...s,
          configVersion: s.configVersion + 1,
          observedAt,
        }));
      });

    yield* Effect.logDebug(
      config.rateLimit === undefined
        ? `Gate "${resourceId}" initialized: concurrency=${String(concurrency)}`
        : `Gate "${resourceId}" initialized: concurrency=${String(concurrency)} rateLimit.limit=${String(config.rateLimit.limit)}`,
    );
    return {
      run: makeObservedRun({
        sem,
        effect: config.effect,
        statusRef,
        store,
        runSeqRef,
        rateLimitStep,
        latch,
        lifecycleState: lifecycle.state,
        waiters,
        stopMode,
        resourceId,
      }),
      ...makeStatusSubscribables(statusRef),
      metrics: makeMetricsSubscribables(
        remainingRef,
        resetAfterRef,
        exceededRef,
      ),
      rateLimitKey,
      metricsKey: "metrics" as const,
      lifecycle,
      setConcurrency,
      setRateLimit,
    };
  });
};

/**
 * Allocate a counting semaphore runner — shared by {@link makeRunner} and HTTP gating.
 *
 * @internal
 */
export const makeGateInternal = (concurrency: number) =>
  Effect.map(
    Semaphore.make(concurrency),
    (sem): GateRunner =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) => sem.withPermits(1)(effect),
  );

/** @internal */
export const makeRunnerEffect = (
  config: GateRunnerConfig,
): Effect.Effect<GateRunner> => {
  const concurrency = config.concurrency ?? 1;
  return makeGateInternal(concurrency).pipe(
    Effect.tap(() =>
      Effect.logDebug(
        `Gate runner "${config.name ?? "anonymous"}" initialized: concurrency=${String(concurrency)}`,
      ),
    ),
  );
};

/** @internal */
export const makeRunnerFromConcurrency = (
  concurrency: number | undefined,
): Effect.Effect<GateRunner, never, never> =>
  concurrency === undefined
    ? Effect.succeed(<A, E, R>(effect: Effect.Effect<A, E, R>) => effect)
    : makeGateInternal(concurrency);
