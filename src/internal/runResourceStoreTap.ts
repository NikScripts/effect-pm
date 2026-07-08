/**
 * Persistence tap for the RunResource gate engine — writes through the Store transform layer.
 *
 * The engine records via {@link engineRunResourceStoreContract} + {@link Store.effects} +
 * {@link Store.catchWriteErrors} (same pattern as {@link QueueResource} `buildQueueImpl`).
 *
 * @module internal/runResourceStoreTap
 * @internal
 */

import { Context, Effect, Ref } from "effect";
import * as Store from "../Store";
import { errorOf, successOf } from "./runTagSchemas";
import type { RunGateStatus } from "./runResource";
import { makeRunStateChange } from "./runResourceFacts";
import {
  engineRunResourceStoreContract,
  type EngineRunResourceStoreContract,
  type RunResourceStateChangeReason,
} from "./store/runResourceStoreSpec";
import type { StoreScopeTag } from "./store/registration";

/** Engine-facing store tap — Storage-free after build. @internal */
export interface RunResourceStoreTap {
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
    success?: unknown,
  ) => Effect.Effect<void>;
  readonly recordRunFailed: (
    runId: string,
    occurredAt: number,
    durationMs: number,
    error: unknown,
  ) => Effect.Effect<void>;
}

/** Guarded store effects for the engine write-extension contract. @internal */
export type RunResourceStoreEffects = ReturnType<typeof buildRunResourceStoreEffects>;

/** Build {@link Store.catchWriteErrors}(`Store.effects`(…)) for a scope. @internal */
export const buildRunResourceStoreEffects = (
  scopeKey: string,
  tag?: StoreScopeTag,
) => {
  const scopeTag = tag ?? { key: scopeKey };
  return Store.catchWriteErrors(
    Store.effects(scopeKey, engineRunResourceStoreContract(scopeTag)),
  );
};

/** Discharge `Storage` from guarded store effects (Queue `provideStorage` pattern). @internal */
export const provideRunResourceStoreEffects =
  (storageContext: Context.Context<Store.Storage>) =>
  <A>(write: Effect.Effect<A, never, Store.Storage>): Effect.Effect<A> =>
    Effect.provide(write, storageContext);

/** Build a Storage-free tap from pre-built guarded effects. @internal */
export const makeRunResourceStoreTapFromEffects = (options: {
  readonly resourceId: string;
  readonly scopeKey: string;
  readonly tag?: StoreScopeTag;
  readonly storeEffects: RunResourceStoreEffects;
  readonly provideStorage: <A>(
    write: Effect.Effect<A, never, Store.Storage>,
  ) => Effect.Effect<A>;
}): Effect.Effect<RunResourceStoreTap> =>
  Effect.gen(function* () {
    const scopeTag = options.tag ?? { key: options.scopeKey };
    const { storeEffects, provideStorage, resourceId } = options;
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

    const recordStateChange = (
      reason: RunResourceStateChangeReason,
      previous: RunGateStatus | null,
      current: RunGateStatus,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const change = makeRunStateChange({
          id: yield* nextStateId(),
          resourceId,
          changedAt: current.observedAt,
          reason,
          previous,
          current,
        });
        yield* provideStorage(storeEffects.recordStateChange(change));
      });

    const recordRunStarted = (
      runId: string,
      occurredAt: number,
      concurrency: number,
    ): Effect.Effect<void> =>
      Effect.flatMap(nextFactId(runId, "Started"), (id) =>
        provideStorage(
          storeEffects.started({
            id,
            resourceId,
            runId,
            occurredAt,
            concurrency,
          }),
        ),
      );

    const recordRunCompleted = (
      runId: string,
      occurredAt: number,
      durationMs: number,
      success?: unknown,
    ): Effect.Effect<void> =>
      Effect.flatMap(nextFactId(runId, "Completed"), (id) =>
        provideStorage(
          storeEffects.completed({
            id,
            resourceId,
            runId,
            occurredAt,
            durationMs,
            ...(persistSuccess ? { success } : {}),
          }),
        ),
      );

    const recordRunFailed = (
      runId: string,
      occurredAt: number,
      durationMs: number,
      error: unknown,
    ): Effect.Effect<void> =>
      Effect.flatMap(nextFactId(runId, "Failed"), (id) =>
        provideStorage(
          storeEffects.failed({
            id,
            resourceId,
            runId,
            occurredAt,
            durationMs,
            error: persistTypedError ? error : String(error),
          }),
        ),
      );

    return {
      recordStateChange,
      recordRunStarted,
      recordRunCompleted,
      recordRunFailed,
    };
  });

/** Resolve guarded store effects once and build the engine tap. @internal */
export const makeRunResourceStoreTap = (
  resourceId: string,
  scopeKey: string,
  tag?: StoreScopeTag,
): Effect.Effect<RunResourceStoreTap, never, Store.Storage> =>
  Effect.gen(function* () {
    const storageContext = yield* Effect.context<Store.Storage>();
    const storeEffects = buildRunResourceStoreEffects(scopeKey, tag);
    return yield* makeRunResourceStoreTapFromEffects({
      resourceId,
      scopeKey,
      tag,
      storeEffects,
      provideStorage: provideRunResourceStoreEffects(storageContext),
    });
  });

/** Mint a stable run id for the current attempt. @internal */
export const nextRunId = (
  resourceId: string,
  runSeq: number,
): string => `${resourceId}/run/${String(runSeq)}`;

/** @internal */
export type { EngineRunResourceStoreContract };
