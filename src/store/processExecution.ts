/**
 * Process supervisor execution persistence on {@link RuntimeStorage}.
 *
 * @remarks
 * Records `process.execution.completed` rows from {@link Process} tracked runs
 * (success, failure, or interrupt). Apps compose
 * {@link ProcessStoreProcessExecution.layerRuntimeStorage} via
 * {@link ProcessStore.layerRuntimeStorage} or `layerProcessStore` from
 * `@nikscripts/effect-pm/storage/sqlite`.
 *
 * ## Emit (optional)
 *
 * {@link Process} calls the **static** shortcuts on this class
 * (`ProcessStoreProcessExecution.recordCompleted`, `.recordFailed`,
 * `.recordInterrupted`). Query via `.executions` / `.hasPriorExecutions` (same
 * optional-presence semantics). When the facet layer is not composed each call is a
 * silent no-op; when composed it writes through the spine. The builder wraps
 * every static emitter with a built-in `catchCause + Effect.logWarning` so
 * storage failures never propagate into the supervisor success/error channel.
 *
 * @module store/ProcessExecution
 */

import { Effect } from "effect";
import {
  processExecutionStoreQuery,
  processExecutionsFromEvents,
} from "../internal/store/spine";
import { ProcessStoreBuilder } from "../ProcessStoreBuilder";
import type {
  ProcessExecutionCompletedEvent,
  ProcessExecutionStatus,
  QueryOpts,
} from "../ProcessStoreEvent";

// ============================================================================
// Public types
// ============================================================================

/**
 * Write input for one finished process run (status chosen by the record method).
 *
 * @public
 */
export interface ProcessExecutionFinishInput {
  readonly processId: string;
  readonly scheduleKey: string | null;
  /** Epoch millis when the execution started. */
  readonly startedAt: number;
  /** Epoch millis when the execution completed. */
  readonly completedAt: number;
  readonly error?: string;
  readonly isStartupRun: boolean;
}

/**
 * Query for process execution history.
 *
 * @public
 */
export interface ProcessExecutionQuery {
  readonly processId: string;
  readonly scheduleKey?: string | null;
  readonly opts?: QueryOpts;
}

// ============================================================================
// Wire encoding
// ============================================================================

let processExecutionSeq = 0;

const toExecutionEvent = (
  input: ProcessExecutionFinishInput,
  status: ProcessExecutionStatus,
): ProcessExecutionCompletedEvent => {
  processExecutionSeq += 1;
  return {
    id: `${input.processId}-execution-${status}-${String(processExecutionSeq)}`,
    type: "process.execution.completed",
    occurredAt: input.completedAt,
    entityType: "process",
    entityId: input.processId,
    execution: {
      scheduleKey: input.scheduleKey,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: Math.max(0, input.completedAt - input.startedAt),
      status,
      ...(input.error !== undefined ? { error: input.error } : {}),
      isStartupRun: input.isStartupRun,
    },
  };
};

const filterByScheduleKey = (
  rows: ProcessExecutionCompletedEvent[],
  scheduleKey: string | null | undefined,
): ProcessExecutionCompletedEvent[] => {
  if (scheduleKey === undefined) {
    return rows;
  }
  return rows.filter((row) => row.execution.scheduleKey === scheduleKey);
};

// ============================================================================
// Facet
// ============================================================================

/**
 * Process execution storage facet (see module doc).
 *
 * @public
 */
export class ProcessStoreProcessExecution extends ProcessStoreBuilder.Service<
  ProcessStoreProcessExecution
>()(
  "@nikscripts/effect-pm/store/processExecution/ProcessStoreProcessExecution",
  ProcessStoreBuilder.record((s) => ({
    recordCompleted: (input: ProcessExecutionFinishInput) =>
      s.append(toExecutionEvent(input, "completed")),
    recordFailed: (input: ProcessExecutionFinishInput) =>
      s.append(toExecutionEvent(input, "failed")),
    recordInterrupted: (input: ProcessExecutionFinishInput) =>
      s.append(toExecutionEvent(input, "interrupted")),
  })),
  ProcessStoreBuilder.read((s) => ({
    executions: (query: ProcessExecutionQuery) =>
      s.events(processExecutionStoreQuery(query.processId, query.opts)).pipe(
        Effect.map((events) =>
          filterByScheduleKey(
            processExecutionsFromEvents(events, query.processId, query.opts),
            query.scheduleKey,
          ),
        ),
      ),
    hasPriorExecutions: (processId: string) =>
      s.events(processExecutionStoreQuery(processId, { limit: 1 })).pipe(
        Effect.map(
          (events) =>
            processExecutionsFromEvents(events, processId, { limit: 1 }).length > 0,
        ),
      ),
  })),
) {}

export declare namespace ProcessStoreProcessExecution {
  export type Type = ProcessStoreBuilder.Service.Type<
    typeof ProcessStoreProcessExecution
  >;
  export type EmitType = ProcessStoreBuilder.Service.EmitType<
    typeof ProcessStoreProcessExecution
  >;
}
