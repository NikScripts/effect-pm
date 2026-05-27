/**
 * **Process execution storage facet** — `process.execution.completed`
 * rows for every supervisor-tracked run (success, failure, interrupt).
 *
 * @remarks
 * Apps compose {@link ProcessStoreProcessExecution.layerRuntimeStorage}
 * via {@link ProcessStorage.layerRuntimeStorage} or `layerProcessStore`
 * from `@nikscripts/effect-pm/storage/sqlite`.
 *
 * ## At-a-glance
 *
 * | Concern | Where |
 * |--------|-------|
 * | Wire type | `process.execution.completed` |
 * | Static emit | `recordCompleted` / `recordFailed` / `recordInterrupted` |
 * | Reads (instance) | `executions({ processId, scheduleKey?, opts? })`, `hasPriorExecutions(processId)` |
 * | Reads + writes (bound, `for(processId)`) | `executions({ scheduleKey?, opts? })`, `hasPriorExecutions()`, `recordCompleted({ scheduleKey, startedAt, completedAt, isStartupRun, error? })` (+ `Failed` / `Interrupted`) |
 *
 * ## Storage shape
 *
 * Each completed execution writes one {@link RuntimeRecord} with:
 *
 * - `type` = `process.execution.completed`
 * - `processType` = `process`
 * - `processId` = the run's process id
 * - `occurredAt` = the run's `completedAt`
 * - `payload` = `{ scheduleKey, startedAt, completedAt, durationMs,
 *   status, isStartupRun, error? }`
 *
 * ## scheduleKey + limit semantics
 *
 * When `query.scheduleKey` is set, the read post-filters decoded rows
 * by `scheduleKey` and re-applies `opts.limit` after filtering (via
 * `windowOpts` / `applyQueryOpts`) so a sparse `scheduleKey` query
 * cannot collapse a `limit: N` result to zero.
 *
 * @module store/ProcessExecution
 */

import { DateTime, Effect } from "effect";
import {
  applyQueryOpts,
  isBoolean,
  isFiniteNumber,
  isRecord,
  isString,
  recordAttributesObject,
  runtimeRecordQuery,
  windowOpts,
} from "../internal/store/helpers";
import type { ProcessStoreSpine } from "../internal/store/spine";
import { ProcessStore } from "../ProcessStore";
import type { AnalyticsEventBase, QueryOpts } from "../ProcessStoreEvent";
import { ProcessId, Type } from "../Query";
import type { RuntimeRecord, RuntimeStorageOperationalError } from "../RuntimeStorage";

// ============================================================================
// Public types
// ============================================================================

/**
 * Terminal status for a tracked process run.
 *
 * @public
 */
export type ProcessExecutionStatus = "completed" | "failed" | "interrupted";

/**
 * One finished process run (success, failure, or interrupt).
 *
 * @public
 */
export interface ProcessExecutionCompletedEvent extends AnalyticsEventBase {
  type: "process.execution.completed";
  entityType: "process";
  execution: {
    scheduleKey: string | null;
    /** Epoch millis when the execution started. */
    startedAt: number;
    /** Epoch millis when the execution completed. */
    completedAt: number;
    durationMs: number;
    status: ProcessExecutionStatus;
    error?: string;
    isStartupRun: boolean;
  };
}

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
 * Write input used by the identifier-bound record methods on
 * {@link ProcessStoreProcessExecution.for | for(processId)}; the
 * `processId` is supplied by the binding.
 *
 * @public
 */
export type ProcessExecutionScopedFinishInput = Omit<
  ProcessExecutionFinishInput,
  "processId"
>;

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

/**
 * Identifier-bound execution query (the `processId` is supplied by
 * {@link ProcessStoreProcessExecution.for | for(processId)}).
 *
 * @public
 */
export interface ProcessExecutionScopedQuery {
  readonly scheduleKey?: string | null;
  readonly opts?: QueryOpts;
}

// ============================================================================
// Wire codec (facet-owned)
// ============================================================================

const PROCESS_TYPE = "process";
const EXECUTION_TYPE = "process.execution.completed";

const executionStatuses: ReadonlyArray<ProcessExecutionStatus> = [
  "completed",
  "failed",
  "interrupted",
];

const isExecutionStatus = (value: unknown): value is ProcessExecutionStatus =>
  isString(value) &&
  executionStatuses.some((status) => status === value);

let processExecutionSeq = 0;

const toExecutionRecord = (
  input: ProcessExecutionFinishInput,
  status: ProcessExecutionStatus,
): Omit<RuntimeRecord, "runId" | "createdAt"> => {
  processExecutionSeq += 1;
  return {
    id: `${input.processId}-execution-${status}-${String(processExecutionSeq)}`,
    type: EXECUTION_TYPE,
    occurredAt: DateTime.makeUnsafe(input.completedAt),
    processType: PROCESS_TYPE,
    processId: input.processId,
    payload: {
      scheduleKey: input.scheduleKey,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: Math.max(0, input.completedAt - input.startedAt),
      status,
      isStartupRun: input.isStartupRun,
      ...(input.error !== undefined ? { error: input.error } : {}),
    },
  };
};

const recordToExecutionEvent = (
  record: RuntimeRecord,
): ProcessExecutionCompletedEvent | null => {
  if (record.type !== EXECUTION_TYPE) return null;
  if (record.processType !== PROCESS_TYPE) return null;
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  const startedAt = payload["startedAt"];
  const completedAt = payload["completedAt"];
  const durationMs = payload["durationMs"];
  const status = payload["status"];
  const scheduleKey = payload["scheduleKey"];
  const isStartupRun = payload["isStartupRun"];
  const errorRaw = payload["error"];
  if (
    !isFiniteNumber(startedAt) ||
    !isFiniteNumber(completedAt) ||
    !isFiniteNumber(durationMs) ||
    !isExecutionStatus(status) ||
    !isBoolean(isStartupRun)
  ) {
    return null;
  }
  if (scheduleKey !== null && !isString(scheduleKey)) return null;
  if (errorRaw !== undefined && !isString(errorRaw)) return null;
  return {
    id: record.id,
    type: EXECUTION_TYPE,
    occurredAt: DateTime.toEpochMillis(record.occurredAt),
    entityType: PROCESS_TYPE,
    entityId: record.processId,
    attributes: recordAttributesObject(record.attributes),
    execution: {
      scheduleKey,
      startedAt,
      completedAt,
      durationMs,
      status,
      isStartupRun,
      ...(errorRaw === undefined ? {} : { error: errorRaw }),
    },
  };
};

const decodeExecutionsForQuery = (
  records: ReadonlyArray<RuntimeRecord>,
  query: ProcessExecutionQuery,
): ProcessExecutionCompletedEvent[] => {
  const rows: ProcessExecutionCompletedEvent[] = [];
  for (const record of records) {
    const event = recordToExecutionEvent(record);
    if (event === null) continue;
    if (
      query.scheduleKey !== undefined &&
      event.execution.scheduleKey !== query.scheduleKey
    ) {
      continue;
    }
    rows.push(event);
  }
  // When `scheduleKey` is set we post-filter the storage rows, so any
  // `opts.limit` must be applied to the projected result — not the broader
  // pre-filter stream — otherwise a high `limit` over a sparse `scheduleKey`
  // can return zero rows. The time window is already pushed down via
  // `windowOpts` in the storage query.
  if (query.scheduleKey !== undefined) {
    return applyQueryOpts(rows, query.opts, (row) => row.occurredAt);
  }
  return rows;
};

// ============================================================================
// Facet
// ============================================================================

/**
 * Process execution storage facet (see module doc).
 *
 * @public
 */
export class ProcessStoreProcessExecution extends ProcessStore.Service<
  ProcessStoreProcessExecution
>()(
  "@nikscripts/effect-pm/store/processExecution/ProcessStoreProcessExecution",
  ProcessStore.record({
    recordCompleted: (s) => (input: ProcessExecutionFinishInput) =>
      s.create(toExecutionRecord(input, "completed")),
    recordFailed: (s) => (input: ProcessExecutionFinishInput) =>
      s.create(toExecutionRecord(input, "failed")),
    recordInterrupted: (s) => (input: ProcessExecutionFinishInput) =>
      s.create(toExecutionRecord(input, "interrupted")),
  }),
  ProcessStore.read((s) => ({
    executions: (query: ProcessExecutionQuery) =>
      readExecutions(s, query),
    hasPriorExecutions: (processId: string) =>
      readHasPriorExecutions(s, processId),
  })),
  ProcessStore.withIdentifier((processId, s) => ({
    executions: (query?: ProcessExecutionScopedQuery) =>
      readExecutions(s, { processId, ...query }),
    hasPriorExecutions: () => readHasPriorExecutions(s, processId),
    recordCompleted: (input: ProcessExecutionScopedFinishInput) =>
      s.create(toExecutionRecord({ processId, ...input }, "completed")),
    recordFailed: (input: ProcessExecutionScopedFinishInput) =>
      s.create(toExecutionRecord({ processId, ...input }, "failed")),
    recordInterrupted: (input: ProcessExecutionScopedFinishInput) =>
      s.create(toExecutionRecord({ processId, ...input }, "interrupted")),
  })),
) {}

const readExecutions = (
  s: ProcessStoreSpine,
  query: ProcessExecutionQuery,
): Effect.Effect<ProcessExecutionCompletedEvent[], RuntimeStorageOperationalError> =>
  s
    .read(
      runtimeRecordQuery(
        [Type.equals(EXECUTION_TYPE), ProcessId.equals(query.processId)],
        // When `scheduleKey` is set we post-filter and re-apply the
        // limit; otherwise the storage query is the final shape and the
        // limit can stay pushed down.
        query.scheduleKey !== undefined
          ? windowOpts(query.opts)
          : query.opts,
      ),
    )
    .pipe(Effect.map((records) => decodeExecutionsForQuery(records, query)));

const readHasPriorExecutions = (
  s: ProcessStoreSpine,
  processId: string,
): Effect.Effect<boolean, RuntimeStorageOperationalError> =>
  s
    .read(
      runtimeRecordQuery(
        [Type.equals(EXECUTION_TYPE), ProcessId.equals(processId)],
        { limit: 1 },
      ),
    )
    .pipe(
      Effect.map((records) =>
        records.some((record) => recordToExecutionEvent(record) !== null),
      ),
    );

export declare namespace ProcessStoreProcessExecution {
  export type Type = ProcessStore.Service.Type<
    typeof ProcessStoreProcessExecution
  >;
  export type EmitType = ProcessStore.Service.EmitType<
    typeof ProcessStoreProcessExecution
  >;
  export type IdentifierType = ProcessStore.Service.IdentifierType<
    typeof ProcessStoreProcessExecution
  >;
}
