/**
 * Pure status transitions for the Gate gate engine.
 *
 * @module internal/runHyperlinkStatus
 * @internal
 */

import type { RunGateStatus } from "./runHyperlink";
import type { GateStateChangeReason } from "./store/runHyperlinkStoreSpec";

/** Pair a counter update with the store reason emitted alongside it. @internal */
export interface RunStatusTransition {
  readonly update: (
    state: RunGateStatus,
    observedAt: number,
    durationMs?: number,
  ) => RunGateStatus;
  readonly reason: GateStateChangeReason;
}

const withObservedAt = (
  state: RunGateStatus,
  observedAt: number,
  patch: Omit<Partial<RunGateStatus>, "observedAt">,
): RunGateStatus => ({
  ...state,
  ...patch,
  observedAt,
});

/** Increment waiting before acquiring a permit. @internal */
export const enterWaiting = (
  state: RunGateStatus,
  observedAt: number,
  _durationMs?: number,
): RunGateStatus =>
  withObservedAt(state, observedAt, { waiting: state.waiting + 1 });

/** Waiting permit acquire interrupted — drop waiting, bump interrupted. @internal */
export const interruptWaitingAcquire = (
  state: RunGateStatus,
  observedAt: number,
  _durationMs?: number,
): RunGateStatus =>
  withObservedAt(state, observedAt, {
    waiting: Math.max(0, state.waiting - 1),
    interrupted: state.interrupted + 1,
  });

/** Permit acquired — move one waiter into in-flight. @internal */
export const startRun = (
  state: RunGateStatus,
  observedAt: number,
  _durationMs?: number,
): RunGateStatus =>
  withObservedAt(state, observedAt, {
    waiting: Math.max(0, state.waiting - 1),
    inFlight: state.inFlight + 1,
  });

/** Run body interrupted — drop in-flight, bump interrupted, accumulate duration. @internal */
export const interruptRunBody = (
  state: RunGateStatus,
  observedAt: number,
  durationMs = 0,
): RunGateStatus =>
  withObservedAt(state, observedAt, {
    inFlight: Math.max(0, state.inFlight - 1),
    interrupted: state.interrupted + 1,
    totalDurationMs: state.totalDurationMs + durationMs,
  });

/** Run failed — drop in-flight, bump failed, accumulate duration. @internal */
export const failRun = (
  state: RunGateStatus,
  observedAt: number,
  durationMs = 0,
): RunGateStatus =>
  withObservedAt(state, observedAt, {
    inFlight: Math.max(0, state.inFlight - 1),
    failed: state.failed + 1,
    totalDurationMs: state.totalDurationMs + durationMs,
  });

/** Run completed — drop in-flight, bump completed, accumulate duration. @internal */
export const completeRun = (
  state: RunGateStatus,
  observedAt: number,
  durationMs = 0,
): RunGateStatus =>
  withObservedAt(state, observedAt, {
    inFlight: Math.max(0, state.inFlight - 1),
    completed: state.completed + 1,
    totalDurationMs: state.totalDurationMs + durationMs,
  });

/** @internal */
export const runStatusTransitions = {
  waiting: {
    update: enterWaiting,
    reason: "run-resource.run.waiting",
  },
  waitInterrupted: {
    update: interruptWaitingAcquire,
    reason: "run-resource.run.wait.interrupted",
  },
  started: {
    update: startRun,
    reason: "run-resource.run.started",
  },
  interrupted: {
    update: interruptRunBody,
    reason: "run-resource.run.interrupted",
  },
  failed: {
    update: failRun,
    reason: "run-resource.run.failed",
  },
  completed: {
    update: completeRun,
    reason: "run-resource.run.completed",
  },
} as const satisfies Record<string, RunStatusTransition>;
