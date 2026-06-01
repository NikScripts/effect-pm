/**
 * **Process execution storage facet** — `Process.Execution.*` telemetry
 * rows for every supervisor-tracked run (success, failure, interrupt).
 *
 * @remarks
 * Apps compose {@link ProcessExecutionStore.layerRuntimeStorage}
 * via {@link ProcessStorage.layerRuntimeStorage} or `layerProcessStore`
 * from `@nikscripts/effect-pm/storage/sqlite`.
 *
 * ## At-a-glance
 *
 * | Concern | Where |
 * |--------|-------|
 * | Wire types | `Process.Execution.Completed` / `.Failed` / `.Interrupted` |
 * | Telemetry emit | `yield* ProcessExecutionStore.Execution.Completed` inside {@link ProcessScope.run} |
 * | Reads (instance) | `executions({ processId, scheduleKey?, opts? })`, `hasPriorExecutions(processId)` |
 * | Reads (bound, `for(processId)`) | `executions({ scheduleKey?, opts? })`, `hasPriorExecutions()` |
 *
 * ## Storage shape
 *
 * Each completed execution writes one {@link RuntimeRecord} with:
 *
 * - `type` = `Process.Execution.Completed` (or `.Failed` / `.Interrupted`)
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
import { ProcessStore, Telemetry } from "../ProcessStore";
import type { AnalyticsEventBase, QueryOpts } from "../ProcessStoreEvent";
import { ProcessScope } from "../ProcessScope";
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
export type ProcessExecutionWireType =
  Telemetry.Type.Event<typeof ProcessExecutionTelemetry, "Execution">;

export interface ProcessExecutionCompletedEvent extends AnalyticsEventBase {
  type: ProcessExecutionWireType;
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
 * {@link ProcessExecutionStore.for | for(processId)}).
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

const executionStatuses: ReadonlyArray<ProcessExecutionStatus> = [
  "completed",
  "failed",
  "interrupted",
];

const isExecutionStatus = (value: unknown): value is ProcessExecutionStatus =>
  isString(value) &&
  executionStatuses.some((status) => status === value);

const decodeExecutionEvent = (
  record: RuntimeRecord,
  type: ProcessExecutionWireType,
): ProcessExecutionCompletedEvent | null => {
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
    type,
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

const ProcessState = ProcessScope.Schema.State;

const executionSchemaFields = {
  processType: PROCESS_TYPE,
  processId: ProcessState.processId,
  scheduleKey: ProcessState.scheduleKey,
  startedAt: ProcessState.startedAt,
  isStartupRun: ProcessState.isStartupRun,
  completedAt: Telemetry.terminal.clockMillis,
  durationMs: Telemetry.terminal.durationMs,
} as const;

class ProcessExecutionCompleted extends Telemetry.Schema<ProcessExecutionCompleted>()(
  ProcessScope,
)({
  ...executionSchemaFields,
  status: "completed",
}) {}

class ProcessExecutionFailed extends Telemetry.Schema<ProcessExecutionFailed>()(
  ProcessScope,
)({
  ...executionSchemaFields,
  status: "failed",
  error: Telemetry.input.errorString,
}) {}

class ProcessExecutionInterrupted extends Telemetry.Schema<ProcessExecutionInterrupted>()(
  ProcessScope,
)({
  ...executionSchemaFields,
  status: "interrupted",
}) {}

const ProcessExecutionTelemetry = ProcessStore.telemetry(
  Telemetry.namespace("Process"),
  Telemetry.tag("Execution")(
    Telemetry.event("Completed", ProcessExecutionCompleted).pipe(
      Telemetry.logWarning(
        "ProcessExecutionStore write failed for completed run",
        ({ processId }) => ({ processId: String(processId) }),
      ),
    ),
    Telemetry.event("Failed", ProcessExecutionFailed).pipe(
      Telemetry.logWarning(
        ({ processId }) => `ProcessExecutionStore write failed for failed run "${String(processId)}"`,
        ({ processId }) => ({ processId: String(processId) }),
      ),
    ),
    Telemetry.event("Interrupted", ProcessExecutionInterrupted).pipe(
      Telemetry.logWarning(
        "ProcessExecutionStore write failed for interrupted run",
        ({ processId }) => ({ processId: String(processId) }),
      ),
    ),
  ),
);

const ProcessExecutionCodec = Telemetry.codec(ProcessExecutionTelemetry)({
  Execution: {
    Completed: decodeExecutionEvent,
    Failed: decodeExecutionEvent,
    Interrupted: decodeExecutionEvent,
  },
});

const executionWireTypes = ProcessExecutionCodec.types("Execution");

const recordToExecutionEvent = (
  record: RuntimeRecord,
): ProcessExecutionCompletedEvent | null =>
  ProcessExecutionCodec.decodeTag("Execution", record);

// ============================================================================
// Facet
// ============================================================================

/**
 * Process execution storage facet (see module doc).
 *
 * @public
 */
export const ProcessExecutionStore = ProcessStore.Service(
  "@nikscripts/effect-pm/store/processExecution/ProcessExecutionStore",
  ProcessExecutionTelemetry,
  ProcessStore.query((s) => ({
    executions: (query: ProcessExecutionQuery) =>
      readExecutions(s, query),
    hasPriorExecutions: (processId: string) =>
      readHasPriorExecutions(s, processId),
  })),
  ProcessStore.for((processId, s) => ({
    executions: (query?: ProcessExecutionScopedQuery) =>
      readExecutions(s, { processId, ...query }),
    hasPriorExecutions: () => readHasPriorExecutions(s, processId),
  })),
);

export type ProcessExecutionStore = typeof ProcessExecutionStore.Identifier;

const readExecutions = (
  s: ProcessStoreSpine,
  query: ProcessExecutionQuery,
): Effect.Effect<ProcessExecutionCompletedEvent[], RuntimeStorageOperationalError> =>
  s
    .read(
      runtimeRecordQuery(
        [Type.in(executionWireTypes), ProcessId.equals(query.processId)],
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
        [Type.in(executionWireTypes), ProcessId.equals(processId)],
        { limit: 1 },
      ),
    )
    .pipe(
      Effect.map((records) =>
        records.some((record) => recordToExecutionEvent(record) !== null),
      ),
    );

