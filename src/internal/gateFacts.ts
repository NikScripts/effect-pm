/**
 * Pure builders for Gate store rows.
 *
 * @module internal/gateFacts
 * @internal
 */

import { Cause, Option } from "effect";
import type { GateFact, GateStateChange } from "./store/gateStoreSpec";
import type { GateStatus } from "./gate";

/** Extract the failure value for store rows (store-core §5). @internal */
export const extractGateFailure = (cause: Cause.Cause<unknown>): unknown =>
  Option.getOrElse(Cause.findErrorOption(cause), () => Cause.squash(cause));

/** Map live counters to the persisted state shape. @internal */
export const toHyperlinkState = (status: GateStatus): GateStateChange["current"] => ({
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
export const makeGateStartedFact = (input: {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly concurrency: number;
}): GateFact => ({
  _tag: "Started",
  id: input.id,
  resourceId: input.resourceId,
  runId: input.runId,
  occurredAt: input.occurredAt,
  concurrency: input.concurrency,
});

/** @internal */
export const makeGateCompletedFact = (input: {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly durationMs: number;
  readonly success?: unknown;
}): GateFact =>
  input.success === undefined
    ? {
        _tag: "Completed",
        id: input.id,
        resourceId: input.resourceId,
        runId: input.runId,
        occurredAt: input.occurredAt,
        durationMs: input.durationMs,
      }
    : ({
        _tag: "Completed",
        id: input.id,
        resourceId: input.resourceId,
        runId: input.runId,
        occurredAt: input.occurredAt,
        durationMs: input.durationMs,
        success: input.success,
      } as GateFact);

/** @internal */
export const makeGateFailedFact = (input: {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly durationMs: number;
  readonly error: unknown;
}): GateFact => ({
  _tag: "Failed",
  id: input.id,
  resourceId: input.resourceId,
  runId: input.runId,
  occurredAt: input.occurredAt,
  durationMs: input.durationMs,
  error: input.error,
} as GateFact);

/** @internal */
export const makeGateStateChange = (input: {
  readonly id: string;
  readonly resourceId: string;
  readonly changedAt: number;
  readonly reason: GateStateChange["reason"];
  readonly previous: GateStatus | null;
  readonly current: GateStatus;
}): GateStateChange => ({
  id: input.id,
  resourceId: input.resourceId,
  changedAt: input.changedAt,
  reason: input.reason,
  previous: input.previous === null ? null : toHyperlinkState(input.previous),
  current: toHyperlinkState(input.current),
});
