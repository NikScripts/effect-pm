/**
 * RunResource kernel — concurrency-gate implementation plus the
 * {@link RunResourceApi} factory object. Attaches the factory as statics on
 * {@link ../../RunResource | the domain tag} and exposes {@link runResourceLayer}.
 *
 * Depends on {@link ../../RunResource | `RunResource.ts`} (domain tag) and
 * {@link ../runResource/service | `service.ts`} (types). `service.ts` must not
 * import this module at top level.
 *
 * @module internal/runResource/kernel
 * @internal
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
} from "../../ResourceConfigure";
import type {
  RunResourceState,
  RunResourceStateChangeReason,
} from "../../store/RunResource";
import { RunResourceHubTelemetry } from "../../store/RunResourceTelemetry";
import type { TelemetryHubError, TelemetryRouter } from "../../TelemetryRouter";
import { RunResource } from "../../RunResource";
import {
  type RunGate,
  type RunResourceApi,
  type RunResourceConfig,
  type RunResourceRunner,
  type RunResourceRunnerConfig,
} from "./service";
import type {
  RunResourceRunCompletedPayload,
  RunResourceRunFailedPayload,
  RunResourceRunStartedPayload,
} from "../../store/RunResource";

// ============================================================================
// Internal: build the gating wrapper
// ============================================================================

/**
 * Allocate a counting semaphore and return a wrapper function.
 *
 * The returned function acquires 1 permit before executing the inner effect
 * and releases it on completion (success, failure, or interruption).
 */
const makeGateInternal = (concurrency: number) =>
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
  ): Effect.Effect<void, TelemetryHubError, TelemetryRouter> =>
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
  ): Effect.Effect<void, TelemetryHubError, TelemetryRouter> =>
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
  ): Effect.Effect<void, TelemetryHubError, TelemetryRouter> =>
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

  return Effect.gen(function* () {
    const sem = yield* Semaphore.make(concurrency);
    const initializedAt = yield* Clock.currentTimeMillis;
    const stateRef = yield* Ref.make(makeInitialState(initializedAt));
    const publishState = (
      reason: RunResourceStateChangeReason,
      update: (state: RunResourceState, observedAt: number) => RunResourceState,
    ): Effect.Effect<void, TelemetryHubError, TelemetryRouter> =>
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
  return makeGateInternal(concurrency).pipe(
    Effect.tap(() =>
      Effect.logDebug(
        `RunResource runner "${config.name ?? "anonymous"}" initialized: concurrency=${String(concurrency)}`,
      ),
    ),
    Effect.map((gate): RunResourceRunner =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) => gate(effect),
    ),
  );
};

// ============================================================================
// Factory api + static attach + domain layer
// ============================================================================

/** The {@link RunResourceApi} factory object. @internal */
export const runResourceApi = {
  make: makeRunGateEffect,

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

  Tag: <Self, T, A, E = never>() =>
  <const Name extends string>(name: Name) => {
    const base = Context.Service<Self, RunGate<T, A, E>>()(name);
    return Object.assign(base, {
      id: name,
      kind: "RunResource" as const,
      tag: base,
    });
  },

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
} satisfies RunResourceApi;

const RunResourceWithStatics = Object.assign(RunResource, runResourceApi);

export const runResourceLayer = Layer.succeed(RunResource, runResourceApi);

export { RunResourceWithStatics as RunResource };
