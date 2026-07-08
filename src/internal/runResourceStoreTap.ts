/**
 * Persistence tap for the RunResource gate engine — writes through the Store transform layer.
 *
 * The engine records via {@link engineRunResourceStoreContract} + {@link Store.effects} +
 * {@link Store.catchWriteErrors}. Each write carries `Storage` in its requirement; the toolkit layer
 * merges {@link Store.layerDefaultMemory} at the boundary (same as {@link QueueResource}).
 *
 * @module internal/runResourceStoreTap
 * @internal
 */

import { Effect, Ref } from "effect";
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

/** Engine-facing store tap — each method returns a guarded store effect (`Storage` requirement). @internal */
export interface RunResourceStoreTap {
  readonly recordStateChange: (
    reason: RunResourceStateChangeReason,
    previous: RunGateStatus | null,
    current: RunGateStatus,
  ) => Effect.Effect<void, never, Store.Storage>;
  readonly recordRunStarted: (
    runId: string,
    occurredAt: number,
    concurrency: number,
  ) => Effect.Effect<void, never, Store.Storage>;
  readonly recordRunCompleted: (
    runId: string,
    occurredAt: number,
    durationMs: number,
    success?: unknown,
  ) => Effect.Effect<void, never, Store.Storage>;
  readonly recordRunFailed: (
    runId: string,
    occurredAt: number,
    durationMs: number,
    error: unknown,
  ) => Effect.Effect<void, never, Store.Storage>;
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

/** Build the engine tap from pre-built guarded store effects. @internal */
export const makeRunResourceStoreTapFromEffects = (options: {
  readonly resourceId: string;
  readonly scopeKey: string;
  readonly tag?: StoreScopeTag;
  readonly storeEffects: RunResourceStoreEffects;
}): Effect.Effect<RunResourceStoreTap> =>
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

    const recordStateChange = (
      reason: RunResourceStateChangeReason,
      previous: RunGateStatus | null,
      current: RunGateStatus,
    ): Effect.Effect<void, never, Store.Storage> =>
      Effect.gen(function* () {
        const change = makeRunStateChange({
          id: yield* nextStateId(),
          resourceId,
          changedAt: current.observedAt,
          reason,
          previous,
          current,
        });
        yield* storeEffects.recordStateChange(change);
      });

    const recordRunStarted = (
      runId: string,
      occurredAt: number,
      concurrency: number,
    ): Effect.Effect<void, never, Store.Storage> =>
      Effect.flatMap(nextFactId(runId, "Started"), (id) =>
        storeEffects.started({
          id,
          resourceId,
          runId,
          occurredAt,
          concurrency,
        }),
      );

    const recordRunCompleted = (
      runId: string,
      occurredAt: number,
      durationMs: number,
      success?: unknown,
    ): Effect.Effect<void, never, Store.Storage> =>
      Effect.flatMap(nextFactId(runId, "Completed"), (id) =>
        storeEffects.completed({
          id,
          resourceId,
          runId,
          occurredAt,
          durationMs,
          ...(persistSuccess ? { success } : {}),
        }),
      );

    const recordRunFailed = (
      runId: string,
      occurredAt: number,
      durationMs: number,
      error: unknown,
    ): Effect.Effect<void, never, Store.Storage> =>
      Effect.flatMap(nextFactId(runId, "Failed"), (id) =>
        storeEffects.failed({
          id,
          resourceId,
          runId,
          occurredAt,
          durationMs,
          error: persistTypedError ? error : String(error),
        }),
      );

    return {
      recordStateChange,
      recordRunStarted,
      recordRunCompleted,
      recordRunFailed,
    };
  });

/** Build guarded store effects and the engine tap. @internal */
export const makeRunResourceStoreTap = (
  resourceId: string,
  scopeKey: string,
  tag?: StoreScopeTag,
): Effect.Effect<RunResourceStoreTap> =>
  makeRunResourceStoreTapFromEffects({
    resourceId,
    scopeKey,
    tag,
    storeEffects: buildRunResourceStoreEffects(scopeKey, tag),
  });

/** Mint a stable run id for the current attempt. @internal */
export const nextRunId = (
  resourceId: string,
  runSeq: number,
): string => `${resourceId}/run/${String(runSeq)}`;

/** @internal */
export type { EngineRunResourceStoreContract };
