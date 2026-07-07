/**
 * Optional persistence tap for the RunResource gate engine — legacy facet + new Store API.
 *
 * @module internal/runResourceStoreTap
 * @internal
 */

import { Effect, Ref } from "effect";
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
  type BuiltInRunResourceContract,
  type RunFact,
  type RunStateChange,
} from "./store/runResourceStoreSpec";
import type { StoreHandleFromContract } from "./store/spec";

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

type NewRunStoreHandle = Pick<
  StoreHandleFromContract<BuiltInRunResourceContract>,
  "record" | "recordStateChange"
>;

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

const dualRecord =
  (recordWrite: ReturnType<typeof makeRecordWrite>) =>
  (
    label: string,
    legacy: Effect.Effect<void, unknown>,
    store: Effect.Effect<void, unknown>,
  ): Effect.Effect<void> =>
    Effect.all(
      [
        recordWrite(`legacy ${label}`, legacy),
        recordWrite(`store ${label}`, store),
      ],
      { discard: true },
    );

const toWireStateChange = (change: RunResourceStateChange): RunStateChange => ({
  id: change.id,
  resourceId: change.resourceId,
  changedAt: change.changedAt,
  reason: change.reason,
  previous: change.previous,
  current: change.current,
});

const toWireStarted = (fact: RunResourceRunStartedFact): RunFact => ({
  id: fact.id,
  resourceId: fact.resourceId,
  runId: fact.runId,
  type: fact.type,
  occurredAt: fact.occurredAt,
  concurrency: fact.payload.concurrency,
});

const toWireCompleted = (fact: RunResourceRunCompletedFact): RunFact => ({
  id: fact.id,
  resourceId: fact.resourceId,
  runId: fact.runId,
  type: fact.type,
  occurredAt: fact.occurredAt,
  durationMs: fact.payload.durationMs,
});

const toWireFailed = (fact: RunResourceRunFailedFact): RunFact => ({
  id: fact.id,
  resourceId: fact.resourceId,
  runId: fact.runId,
  type: fact.type,
  occurredAt: fact.occurredAt,
  durationMs: fact.payload.durationMs,
  cause: fact.payload.cause,
});

/** Resolve the store bridge once and build the engine tap. @internal */
export const makeRunResourceStoreTap = (
  resourceId: string,
  scopeKey: string,
): Effect.Effect<RunResourceStoreTap, StoreScopeNotRegistered, StoreScopeBridgeTag> =>
  Effect.gen(function* () {
    const bridge = yield* StoreScopeBridgeTag;
    const contract = builtInRunResourceStoreContract(scopeTagForKey(scopeKey));
    const newStore: NewRunStoreHandle = yield* bridge.at(scopeKey, contract);
    const recordWrite = makeRecordWrite(resourceId);
    const writeBoth = dualRecord(recordWrite);
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
        const change: RunResourceStateChange = {
          id: yield* nextStateId(),
          resourceId,
          changedAt: current.observedAt,
          reason,
          previous: previous === null ? null : toResourceState(previous),
          current: toResourceState(current),
        };
        yield* writeBoth(
          `state ${reason}`,
          RunResourceStore.recordStateChange(change),
          newStore.recordStateChange(toWireStateChange(change)),
        );
      });

    const recordRunStarted = (
      runId: string,
      occurredAt: number,
      concurrency: number,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fact: RunResourceRunStartedFact = {
          id: yield* nextFactId(runId, "run-resource.run.started"),
          resourceId,
          runId,
          type: "run-resource.run.started",
          occurredAt,
          payload: { concurrency },
        };
        yield* writeBoth(
          `fact started ${runId}`,
          RunResourceStore.recordRunStarted(fact),
          newStore.record(toWireStarted(fact)),
        );
      });

    const recordRunCompleted = (
      runId: string,
      occurredAt: number,
      durationMs: number,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fact: RunResourceRunCompletedFact = {
          id: yield* nextFactId(runId, "run-resource.run.completed"),
          resourceId,
          runId,
          type: "run-resource.run.completed",
          occurredAt,
          payload: { durationMs },
        };
        yield* writeBoth(
          `fact completed ${runId}`,
          RunResourceStore.recordRunCompleted(fact),
          newStore.record(toWireCompleted(fact)),
        );
      });

    const recordRunFailed = (
      runId: string,
      occurredAt: number,
      durationMs: number,
      cause: string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fact: RunResourceRunFailedFact = {
          id: yield* nextFactId(runId, "run-resource.run.failed"),
          resourceId,
          runId,
          type: "run-resource.run.failed",
          occurredAt,
          payload: { durationMs, cause },
        };
        yield* writeBoth(
          `fact failed ${runId}`,
          RunResourceStore.recordRunFailed(fact),
          newStore.record(toWireFailed(fact)),
        );
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
