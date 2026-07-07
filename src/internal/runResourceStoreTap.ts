/**
 * Optional persistence tap for the RunResource gate engine — legacy facet + new Store API.
 *
 * @module internal/runResourceStoreTap
 * @internal
 */

import { Effect, Option } from "effect";
import { ProcessStore } from "../ProcessStore";
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
import type { StoreScopeTag } from "./store/registration";
import type { RunGateStatus } from "./runResource";
import type { StoreHandleFromContract } from "./store/spec";
import {
  builtInRunResourceStoreContract,
  type BuiltInRunResourceContract,
  type RunFact,
  type RunStateChange,
} from "./store/runResourceStoreSpec";

/** Minimal new-store handle used by the engine tap. @internal */
type NewRunStoreHandle = Pick<
  StoreHandleFromContract<BuiltInRunResourceContract>,
  "record" | "recordStateChange"
>;

/** Engine-facing store tap — no-ops when no backing store is composed. @internal */
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

const scopeTagForKey = (scopeKey: string): StoreScopeTag => ({ key: scopeKey });

const resolveNewStoreHandle = (
  scopeKey: string,
): Effect.Effect<Option.Option<NewRunStoreHandle>> =>
  Effect.gen(function* () {
    const bridge = yield* Effect.serviceOption(StoreScopeBridgeTag);
    if (Option.isNone(bridge)) {
      return Option.none();
    }
    const contract = builtInRunResourceStoreContract(scopeTagForKey(scopeKey));
    const handle = yield* bridge.value
      .at(scopeKey, contract.spec, contract)
      .pipe(Effect.option);
    if (Option.isNone(handle)) {
      return Option.none();
    }
    const store = handle.value as unknown as StoreHandleFromContract<BuiltInRunResourceContract>;
    return Option.some({
      record: store.record,
      recordStateChange: store.recordStateChange,
    });
  });

const makeRecordWrite =
  (resourceId: string) =>
  (label: string, effect: Effect.Effect<void, unknown>): Effect.Effect<void> =>
    effect.pipe(
      ProcessStore.catchErrorAndLog({
        message: `RunResource store write failed for "${resourceId}" ${label}`,
        level: "warning",
        annotations: { resourceId, label },
      }),
    );

/** Resolve optional new store handle and build the engine tap. @internal */
export const makeRunResourceStoreTap = (
  resourceId: string,
  scopeKey: string,
): Effect.Effect<RunResourceStoreTap> =>
  Effect.sync(() => {
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

    const writeToNewStore = (
      label: string,
      write: (store: NewRunStoreHandle) => Effect.Effect<void>,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const newStore = yield* resolveNewStoreHandle(scopeKey);
        if (Option.isSome(newStore)) {
          yield* recordWrite(label, write(newStore.value));
        }
      });

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
        yield* writeToNewStore(
          `store state ${reason}`,
          (store) => store.recordStateChange(wireChange),
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
        yield* writeToNewStore(
          `store fact started ${runId}`,
          (store) => store.record(wireFact),
        );
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
        yield* writeToNewStore(
          `store fact completed ${runId}`,
          (store) => store.record(wireFact),
        );
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
        yield* writeToNewStore(
          `store fact failed ${runId}`,
          (store) => store.record(wireFact),
        );
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
