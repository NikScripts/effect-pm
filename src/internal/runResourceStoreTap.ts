/**
 * Optional persistence tap for the RunResource gate engine — legacy facet + new Store API.
 *
 * @module internal/runResourceStoreTap
 * @internal
 */

import { Effect } from "effect";
import { RunResourceStore } from "../store/runResource";
import type {
  RunResourceRunCompletedFact,
  RunResourceRunFailedFact,
  RunResourceRunStartedFact,
  RunResourceState,
  RunResourceStateChange,
  RunResourceStateChangeReason,
} from "../store/runResource";
import { StoreScopeBridgeTag } from "./store/bridge";
import { catchErrorAndLog } from "./store/helpers";
import type { StoreScopeNotRegistered } from "./store/errors";
import type { RunGateStatus } from "./runResource";
import {
  builtInRunResourceStoreContract,
  type RunFact,
  type RunStateChange,
} from "./store/runResourceStoreSpec";

/** Engine-facing store tap — writes to legacy facet and defaulted Store bridge. @internal */
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

const toResourceState = (status: RunGateStatus): RunResourceState => ({
  resourceId: status.resourceId,
  observedAt: status.observedAt,
  configVersion: status.configVersion,
  concurrency: status.concurrency,
  waiting: status.waiting,
  inFlight: status.inFlight,
  completed: status.completed,
  failed: status.failed,
  interrupted: status.interrupted,
  totalDurationMs: status.totalDurationMs,
});

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
    const newStore = yield* bridge.at(scopeKey, contract);
    const recordWrite = makeRecordWrite(resourceId);
    let stateSeq = 0;
    let factSeq = 0;

    const nextStateId = (): string => {
      stateSeq += 1;
      return `${resourceId}/state/${String(stateSeq)}`;
    };

    const nextFactId = (runId: string, suffix: string): string => {
      factSeq += 1;
      return `${runId}/${suffix}/${String(factSeq)}`;
    };

    const writeStateChange = (
      reason: RunResourceStateChangeReason,
      previous: RunGateStatus | null,
      current: RunGateStatus,
    ): Effect.Effect<void> => {
      const change: RunResourceStateChange = {
        id: nextStateId(),
        resourceId,
        changedAt: current.observedAt,
        reason,
        previous: previous === null ? null : toResourceState(previous),
        current: toResourceState(current),
      };
      const wireChange: RunStateChange = {
        id: change.id,
        resourceId: change.resourceId,
        changedAt: change.changedAt,
        reason: change.reason,
        previous: change.previous,
        current: change.current,
      };
      return Effect.gen(function* () {
        yield* recordWrite(
          `state ${reason}`,
          RunResourceStore.recordStateChange(change),
        );
        yield* recordWrite(
          `store state ${reason}`,
          newStore.recordStateChange(wireChange),
        );
      });
    };

    const writeStarted = (
      runId: string,
      occurredAt: number,
      concurrency: number,
    ): Effect.Effect<void> => {
      const fact: RunResourceRunStartedFact = {
        id: nextFactId(runId, "run-resource.run.started"),
        resourceId,
        runId,
        type: "run-resource.run.started",
        occurredAt,
        payload: { concurrency },
      };
      const wireFact: RunFact = {
        id: fact.id,
        resourceId: fact.resourceId,
        runId: fact.runId,
        type: fact.type,
        occurredAt: fact.occurredAt,
        concurrency: fact.payload.concurrency,
      };
      return Effect.gen(function* () {
        yield* recordWrite(`fact started ${runId}`, RunResourceStore.recordRunStarted(fact));
        yield* recordWrite(`store fact started ${runId}`, newStore.record(wireFact));
      });
    };

    const writeCompleted = (
      runId: string,
      occurredAt: number,
      durationMs: number,
    ): Effect.Effect<void> => {
      const fact: RunResourceRunCompletedFact = {
        id: nextFactId(runId, "run-resource.run.completed"),
        resourceId,
        runId,
        type: "run-resource.run.completed",
        occurredAt,
        payload: { durationMs },
      };
      const wireFact: RunFact = {
        id: fact.id,
        resourceId: fact.resourceId,
        runId: fact.runId,
        type: fact.type,
        occurredAt: fact.occurredAt,
        durationMs: fact.payload.durationMs,
      };
      return Effect.gen(function* () {
        yield* recordWrite(
          `fact completed ${runId}`,
          RunResourceStore.recordRunCompleted(fact),
        );
        yield* recordWrite(`store fact completed ${runId}`, newStore.record(wireFact));
      });
    };

    const writeFailed = (
      runId: string,
      occurredAt: number,
      durationMs: number,
      cause: string,
    ): Effect.Effect<void> => {
      const fact: RunResourceRunFailedFact = {
        id: nextFactId(runId, "run-resource.run.failed"),
        resourceId,
        runId,
        type: "run-resource.run.failed",
        occurredAt,
        payload: { durationMs, cause },
      };
      const wireFact: RunFact = {
        id: fact.id,
        resourceId: fact.resourceId,
        runId: fact.runId,
        type: fact.type,
        occurredAt: fact.occurredAt,
        durationMs: fact.payload.durationMs,
        cause: fact.payload.cause,
      };
      return Effect.gen(function* () {
        yield* recordWrite(`fact failed ${runId}`, RunResourceStore.recordRunFailed(fact));
        yield* recordWrite(`store fact failed ${runId}`, newStore.record(wireFact));
      });
    };

    return {
      recordStateChange: (reason, previous, current) =>
        writeStateChange(reason, previous, current),
      recordRunStarted: writeStarted,
      recordRunCompleted: writeCompleted,
      recordRunFailed: writeFailed,
    };
  });

/** Mint a stable run id for the current attempt. @internal */
export const nextRunId = (
  resourceId: string,
  runSeq: number,
): string => `${resourceId}/run/${String(runSeq)}`;
