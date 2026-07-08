/**
 * RunResource engine — semaphore gate handles with optional live observation.
 *
 * @internal
 */

import {
  Cause,
  Clock,
  Effect,
  Exit,
  Ref,
  Semaphore,
  SubscriptionRef,
  pipe,
} from "effect";
import type { RunResourceStateChangeReason } from "./store/runResourceStoreSpec";
import { engineRunResourceStoreContract } from "./store/runResourceStoreSpec";
import { mapSubscribable, subscribable, type Subscribable } from "../Resource";
import * as Store from "../Store";
import type { StoreScopeNotRegistered } from "./store/errors";
import { runStatusTransitions } from "./runResourceStatus";

// ============================================================================
// Engine types
// ============================================================================

/** Live counters for a gated resource handle. @internal */
export interface RunGateStatus {
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

type RunGateRun<T, A, E> = [T] extends [void]
  ? () => Effect.Effect<A, E>
  : (input: T) => Effect.Effect<A, E>;

/** Minimal handle from {@link makeRunGateHandleEffect} — run only. @internal */
export type RunGateHandle<T, A, E> = {
  readonly run: RunGateRun<T, A, E>;
};

/** Observable handle from {@link makeRunResourceHandleEffect}. @internal */
export type RunResourceHandle<T, A, E> = RunGateHandle<T, A, E> & {
  readonly status: Subscribable<RunGateStatus>;
  readonly waiting: Subscribable<number>;
  readonly inFlight: Subscribable<number>;
  readonly completed: Subscribable<number>;
  readonly failed: Subscribable<number>;
  readonly interrupted: Subscribable<number>;
};

/** @internal */
export interface RunResourceConfig<T, A, E> {
  readonly name?: string;
  readonly scopeKey?: string;
  readonly effect: (input: T) => Effect.Effect<A, E>;
  readonly concurrency?: number;
}

/** @internal */
export interface RunResourceRunnerConfig {
  readonly name?: string;
  readonly concurrency?: number;
}

/** Engine-facing store recorder — Storage discharged at the gate boundary. @internal */
interface RunResourceStoreWriter {
  readonly recordStateChange: (
    reason: RunResourceStateChangeReason,
    previous: RunGateStatus | null,
    current: RunGateStatus,
  ) => Effect.Effect<void>;
  readonly recordRunStarted: (
    runId: string,
    occurredAt: number,
    concurrency: number,
  ) => Effect.Effect<void>;
  readonly recordRunCompleted: (
    runId: string,
    occurredAt: number,
    durationMs: number,
  ) => Effect.Effect<void>;
  readonly recordRunFailed: (
    runId: string,
    occurredAt: number,
    durationMs: number,
    cause: string,
  ) => Effect.Effect<void>;
}

/** Mint a stable run id for the current attempt. @internal */
export const nextRunId = (
  resourceId: string,
  runSeq: number,
): string => `${resourceId}/run/${String(runSeq)}`;

/** @internal */
export interface RunResourceRunner {
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
}

const makeInitialStatus = (
  resourceId: string,
  concurrency: number,
  observedAt: number,
): RunGateStatus => ({
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
  statusRef: SubscriptionRef.SubscriptionRef<RunGateStatus>,
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

const makeObservedRun =
  <T, A, E>(
    sem: Semaphore.Semaphore,
    effect: (input: T) => Effect.Effect<A, E>,
    statusRef: SubscriptionRef.SubscriptionRef<RunGateStatus>,
    store: RunResourceStoreWriter,
    runSeqRef: Ref.Ref<number>,
    concurrency: number,
  ): RunGateRun<T, A, E> => {
  const publishStatus = (
    update: (typeof runStatusTransitions)[keyof typeof runStatusTransitions]["update"],
    reason: RunResourceStateChangeReason,
    durationMs?: number,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const observedAt = yield* Clock.currentTimeMillis;
      const previous = yield* SubscriptionRef.get(statusRef);
      const current = update(previous, observedAt, durationMs);
      yield* SubscriptionRef.set(statusRef, current);
      yield* store.recordStateChange(reason, previous, current);
    });

  const runBody = (input: T) => {
    const acquirePermit = Effect.gen(function* () {
      const waiting = runStatusTransitions.waiting;
      yield* publishStatus(waiting.update, waiting.reason);
      yield* sem.take(1).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
            ? Effect.uninterruptible(
                publishStatus(
                  runStatusTransitions.waitInterrupted.update,
                  runStatusTransitions.waitInterrupted.reason,
                ),
              )
            : Effect.void,
        ),
      );
    });

    return Effect.acquireUseRelease(
      acquirePermit,
      () =>
        Effect.gen(function* () {
          const startedAt = yield* Clock.currentTimeMillis;
          const runSeq = yield* Ref.updateAndGet(runSeqRef, (n) => n + 1);
          const runId = nextRunId(
            (yield* SubscriptionRef.get(statusRef)).resourceId,
            runSeq,
          );
          yield* store.recordRunStarted(runId, startedAt, concurrency);
          const started = runStatusTransitions.started;
          yield* publishStatus(started.update, started.reason);

          return yield* effect(input).pipe(
            Effect.onExit((exit) =>
              Effect.uninterruptible(
                Effect.gen(function* () {
                  const endedAt = yield* Clock.currentTimeMillis;
                  const durationMs = Math.max(0, endedAt - startedAt);
                  if (Exit.isSuccess(exit)) {
                    yield* store.recordRunCompleted(runId, endedAt, durationMs);
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
                    const causeText = Cause.pretty(exit.cause);
                    yield* store.recordRunFailed(runId, endedAt, durationMs, causeText);
                    const failed = runStatusTransitions.failed;
                    yield* publishStatus(failed.update, failed.reason, durationMs);
                  }
                }),
              ),
            ),
          );
        }),
      () => Effect.asVoid(sem.release(1)),
    );
  };

  return ((input?: T) => runBody(input as T)) as RunGateRun<T, A, E>;
};

/**
 * Scoped gate handle with `.run` only — no live observation.
 *
 * @internal
 */
export const makeRunGateHandleEffect = <T, A, E>(
  config: RunResourceConfig<T, A, E>,
): Effect.Effect<RunGateHandle<T, A, E>, StoreScopeNotRegistered, Store.Storage> =>
  Effect.map(makeRunResourceHandleEffect(config), (handle) => ({
    run: handle.run,
  }));

/**
 * Scoped observable gate handle — {@link SubscriptionRef}-backed status and scalar views.
 *
 * @internal
 */
export const makeRunResourceHandleEffect = <T, A, E>(
  config: RunResourceConfig<T, A, E>,
): Effect.Effect<RunResourceHandle<T, A, E>, StoreScopeNotRegistered, Store.Storage> => {
  const concurrency = config.concurrency ?? 1;
  const resourceId = config.name ?? "anonymous";
  const scopeKey = config.scopeKey ?? resourceId;

  return Effect.gen(function* () {
    const sem = yield* Semaphore.make(concurrency);
    const initializedAt = yield* Clock.currentTimeMillis;
    const statusRef = yield* SubscriptionRef.make(
      makeInitialStatus(resourceId, concurrency, initializedAt),
    );
    const storeEffects = pipe(
      Store.effects(scopeKey, engineRunResourceStoreContract(resourceId)),
      Store.catchWriteErrors,
    );
    const storageContext = yield* Effect.context<Store.Storage>();
    const provideStorage = <A>(
      write: Effect.Effect<A, never, Store.Storage>,
    ): Effect.Effect<A> => Effect.provide(write, storageContext);

    const stateSeqRef = yield* Ref.make(0);
    const factSeqRef = yield* Ref.make(0);

    const nextStateId = (): Effect.Effect<string> =>
      Ref.updateAndGet(stateSeqRef, (n) => n + 1).pipe(
        Effect.map((seq) => `${resourceId}/state/${String(seq)}`),
      );

    const nextFactId = (runId: string, suffix: string): Effect.Effect<string> =>
      Ref.updateAndGet(factSeqRef, (n) => n + 1).pipe(
        Effect.map((seq) => `${runId}/${suffix}/${String(seq)}`),
      );

    const store: RunResourceStoreWriter = {
      recordStateChange: (reason, previous, current) =>
        provideStorage(
          nextStateId().pipe(
            Effect.flatMap((id) =>
              storeEffects.recordGateStateChange({
                id,
                changedAt: current.observedAt,
                reason,
                previous,
                current,
              }),
            ),
          ),
        ),
      recordRunStarted: (runId, occurredAt, concurrency) =>
        provideStorage(
          nextFactId(runId, "run-resource.run.started").pipe(
            Effect.flatMap((id) =>
              storeEffects.recordRunStarted({ id, runId, occurredAt, concurrency }),
            ),
          ),
        ),
      recordRunCompleted: (runId, occurredAt, durationMs) =>
        provideStorage(
          nextFactId(runId, "run-resource.run.completed").pipe(
            Effect.flatMap((id) =>
              storeEffects.recordRunCompleted({ id, runId, occurredAt, durationMs }),
            ),
          ),
        ),
      recordRunFailed: (runId, occurredAt, durationMs, cause) =>
        provideStorage(
          nextFactId(runId, "run-resource.run.failed").pipe(
            Effect.flatMap((id) =>
              storeEffects.recordRunFailed({ id, runId, occurredAt, durationMs, cause }),
            ),
          ),
        ),
    };

    const runSeqRef = yield* Ref.make(0);
    yield* Effect.logDebug(
      `RunResource "${resourceId}" initialized: concurrency=${String(concurrency)}`,
    );
    return {
      run: makeObservedRun(
        sem,
        config.effect,
        statusRef,
        store,
        runSeqRef,
        concurrency,
      ),
      ...makeStatusSubscribables(statusRef),
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
    (sem): RunResourceRunner =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) => sem.withPermits(1)(effect),
  );

/** @internal */
export const makeRunnerEffect = (
  config: RunResourceRunnerConfig,
): Effect.Effect<RunResourceRunner> => {
  const concurrency = config.concurrency ?? 1;
  return makeGateInternal(concurrency).pipe(
    Effect.tap(() =>
      Effect.logDebug(
        `RunResource runner "${config.name ?? "anonymous"}" initialized: concurrency=${String(concurrency)}`,
      ),
    ),
  );
};

/** @internal */
export const makeRunnerFromConcurrency = (
  concurrency: number | undefined,
): Effect.Effect<RunResourceRunner, never, never> =>
  concurrency === undefined
    ? Effect.succeed(<A, E, R>(effect: Effect.Effect<A, E, R>) => effect)
    : makeGateInternal(concurrency);
