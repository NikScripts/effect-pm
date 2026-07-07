/**
 * Pure builders for RunResource store rows.
 *
 * @module internal/runResourceFacts
 * @internal
 */

import type { RunFact, RunStateChange } from "./store/runResourceStoreSpec";
import type { RunGateStatus } from "./runResource";

/** Map live counters to the persisted state shape. @internal */
export const toResourceState = (status: RunGateStatus): RunStateChange["current"] => ({
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

/** @internal */
export const makeRunStartedFact = (input: {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly concurrency: number;
}): RunFact => ({
  id: input.id,
  resourceId: input.resourceId,
  runId: input.runId,
  type: "run-resource.run.started",
  occurredAt: input.occurredAt,
  concurrency: input.concurrency,
});

/** @internal */
export const makeRunCompletedFact = (input: {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly durationMs: number;
}): RunFact => ({
  id: input.id,
  resourceId: input.resourceId,
  runId: input.runId,
  type: "run-resource.run.completed",
  occurredAt: input.occurredAt,
  durationMs: input.durationMs,
});

/** @internal */
export const makeRunFailedFact = (input: {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly durationMs: number;
  readonly cause: string;
}): RunFact => ({
  id: input.id,
  resourceId: input.resourceId,
  runId: input.runId,
  type: "run-resource.run.failed",
  occurredAt: input.occurredAt,
  durationMs: input.durationMs,
  cause: input.cause,
});

/** @internal */
export const makeRunStateChange = (input: {
  readonly id: string;
  readonly resourceId: string;
  readonly changedAt: number;
  readonly reason: RunStateChange["reason"];
  readonly previous: RunGateStatus | null;
  readonly current: RunGateStatus;
}): RunStateChange => ({
  id: input.id,
  resourceId: input.resourceId,
  changedAt: input.changedAt,
  reason: input.reason,
  previous: input.previous === null ? null : toResourceState(input.previous),
  current: toResourceState(input.current),
});
