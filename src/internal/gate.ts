/**
 * Gate engine — semaphore gate handles with optional live observation.
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
} from "effect";
import {
  builtInGateStoreContract,
  type GateStateChangeReason,
  type RunStateChange,
} from "./store/gateStoreSpec";
import { mapSubscribable, subscribable, type Subscribable } from "../Hyperlink";
import * as Store from "../Store";
import type { StoreScopeTag } from "./store/registration";
import { errorOf, successOf } from "./gateTagSchemas";
import { makeRunStateChange, extractRunFailure } from "./gateFacts";
import { runStatusTransitions } from "./gateStatus";

// ============================================================================
// Engine types
// ============================================================================

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
};

/** @internal */
export interface GateConfig<T, A, E> {
  readonly name?: string;
  readonly scopeKey?: string;
  readonly tag?: StoreScopeTag;
  readonly effect: (input: T) => Effect.Effect<A, E>;
  readonly concurrency?: number;
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
      readonly append: (change: RunStateChange) => Effect.Effect<void>;
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
          const change = makeRunStateChange({
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

const makeObservedRun =
  <T, A, E>(
    sem: Semaphore.Semaphore,
    effect: (input: T) => Effect.Effect<A, E>,
    statusRef: SubscriptionRef.SubscriptionRef<GateStatus>,
    store: GateStoreContext,
    runSeqRef: Ref.Ref<number>,
    concurrency: number,
  ): GateRunFn<T, A, E> => {
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
          const startedId = yield* store.nextFactId(runId, "Started");
          yield* store.fact.append({
            _tag: "Started",
            id: startedId,
            resourceId: store.resourceId,
            runId,
            occurredAt: startedAt,
            concurrency,
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
                    const error = extractRunFailure(exit.cause);
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
        }),
      () => Effect.asVoid(sem.release(1)),
    );
  };

  return ((input?: T) => runBody(input as T)) as GateRunFn<T, A, E>;
};

/**
 * Scoped gate handle with `.run` only — no live observation.
 *
 * @internal
 */
export const makeGateRunHandleEffect = <T, A, E>(
  config: GateConfig<T, A, E>,
): Effect.Effect<GateRunHandle<T, A, E>, never, Store.Storage> =>
  Effect.map(makeGateHandleEffect(config), (handle) => ({
    run: handle.run,
  }));

/**
 * Scoped observable gate handle — {@link SubscriptionRef}-backed status and scalar views.
 *
 * @internal
 */
export const makeGateHandleEffect = <T, A, E>(
  config: GateConfig<T, A, E>,
): Effect.Effect<GateHandle<T, A, E>, never, Store.Storage> => {
  const concurrency = config.concurrency ?? 1;
  const resourceId = config.name ?? "anonymous";
  const scopeKey = config.scopeKey ?? resourceId;
  const scopeTag = config.tag ?? { key: scopeKey };

  return Effect.gen(function* () {
    const sem = yield* Semaphore.make(concurrency);
    const initializedAt = yield* Clock.currentTimeMillis;
    const statusRef = yield* SubscriptionRef.make(
      makeInitialStatus(resourceId, concurrency, initializedAt),
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
        readonly state: { readonly append: (change: RunStateChange) => Effect.Effect<void> };
      },
    });
    const runSeqRef = yield* Ref.make(0);
    yield* Effect.logDebug(
      `Gate "${resourceId}" initialized: concurrency=${String(concurrency)}`,
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
