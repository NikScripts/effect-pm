/**
 * Persistence tap for the RunResource gate engine — writes to the Store bridge only.
 *
 * The engine targets {@link builtInRunResourceStoreContract} via {@link StoreScopeBridgeTag}.
 *
 * @module internal/runResourceStoreTap
 * @internal
 */

import { Effect, Ref } from "effect";
import { StoreScopeBridgeTag } from "./store/bridge";
import { catchErrorAndLog } from "./store/helpers";
import type { StoreScopeNotRegistered } from "./store/errors";
import type { RunGateStatus } from "./runResource";
import {
  makeRunCompletedFact,
  makeRunFailedFact,
  makeRunStartedFact,
  makeRunStateChange,
} from "./runResourceFacts";
import {
  builtInRunResourceStoreContract,
  type BuiltInRunResourceContract,
  type RunResourceStateChangeReason,
} from "./store/runResourceStoreSpec";
import type { StoreHandleFromContract } from "./store/spec";

/** Engine-facing store tap — Store bridge only. @internal */
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
  ) => Effect.Effect<void>;
  readonly recordRunFailed: (
    runId: string,
    occurredAt: number,
    durationMs: number,
    cause: string,
  ) => Effect.Effect<void>;
}

type RunStoreHandle = Pick<
  StoreHandleFromContract<BuiltInRunResourceContract>,
  "record" | "recordStateChange"
>;

const scopeTagForKey = (scopeKey: string) => ({ key: scopeKey });

const makeRecordWrite =
  (resourceId: string) =>
  (label: string, effect: Effect.Effect<void, unknown>): Effect.Effect<void> =>
    effect.pipe(
      catchErrorAndLog({
        message: `RunResource store write failed for "${resourceId}" ${label}`,
        level: "warning",
        annotations: { resourceId, label },
      }),
    );

/** Resolve the store bridge once and build the engine tap. @internal */
export const makeRunResourceStoreTap = (
  resourceId: string,
  scopeKey: string,
): Effect.Effect<RunResourceStoreTap, StoreScopeNotRegistered, StoreScopeBridgeTag> =>
  Effect.gen(function* () {
    const bridge = yield* StoreScopeBridgeTag;
    const contract = builtInRunResourceStoreContract(scopeTagForKey(scopeKey));
    const store: RunStoreHandle = yield* bridge.at(scopeKey, contract);
    const recordWrite = makeRecordWrite(resourceId);
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
        yield* recordWrite(`state ${reason}`, store.recordStateChange(change));
      });

    const recordRunStarted = (
      runId: string,
      occurredAt: number,
      concurrency: number,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fact = makeRunStartedFact({
          id: yield* nextFactId(runId, "run-resource.run.started"),
          resourceId,
          runId,
          occurredAt,
          concurrency,
        });
        yield* recordWrite(`fact started ${runId}`, store.record(fact));
      });

    const recordRunCompleted = (
      runId: string,
      occurredAt: number,
      durationMs: number,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fact = makeRunCompletedFact({
          id: yield* nextFactId(runId, "run-resource.run.completed"),
          resourceId,
          runId,
          occurredAt,
          durationMs,
        });
        yield* recordWrite(`fact completed ${runId}`, store.record(fact));
      });

    const recordRunFailed = (
      runId: string,
      occurredAt: number,
      durationMs: number,
      cause: string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fact = makeRunFailedFact({
          id: yield* nextFactId(runId, "run-resource.run.failed"),
          resourceId,
          runId,
          occurredAt,
          durationMs,
          cause,
        });
        yield* recordWrite(`fact failed ${runId}`, store.record(fact));
      });

    return {
      recordStateChange,
      recordRunStarted,
      recordRunCompleted,
      recordRunFailed,
    };
  });

/** Mint a stable run id for the current attempt. @internal */
export const nextRunId = (
  resourceId: string,
  runSeq: number,
): string => `${resourceId}/run/${String(runSeq)}`;
