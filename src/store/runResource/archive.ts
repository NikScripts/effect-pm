/**
 * **`RunResource` archive facet** — durable, queryable history of every
 * gated run (started / completed / failed) plus state-machine snapshots.
 *
 * @remarks
 * Telemetry emits live in {@link ./telemetry | runResource/telemetry} and
 * persist optionally through {@link ArchiveSink}. This module owns row codecs
 * (decode), queries, and {@link RunResourceStore}.
 *
 * @module store/runResource/archive
 */

import { DateTime, Effect, Option, Schema } from "effect";
import { leg } from "../../ArchiveSink";
import {
  filterMapNullable,
  nullable,
  numberValue,
  recordValue,
  stringValue,
  valueWhen,
} from "../../internal/store/decode";
import {
  applyQueryOpts,
  byTimestampDesc,
  isString,
  recordAttributesObject,
  runtimeRecordQuery,
  windowOpts,
} from "../../internal/store/helpers";
import type { ProcessStoreSpine } from "../../internal/store/spine";
import { ProcessStore } from "../../ProcessStore";
import type { QueryOpts } from "../../ProcessStoreEvent";
import { ProcessId, Type } from "../../Query";
import type { RuntimeRecord, RuntimeStorageOperationalError } from "../../RuntimeStorage";
import {
  RUN_COMPLETED_WIRE,
  RUN_FAILED_WIRE,
  RUN_RESOURCE_PROCESS_TYPE,
  RUN_STARTED_WIRE,
  RunCompleted,
  RunFailed,
  RunStarted,
  STATE_CHANGE_REASONS,
  STATE_CHANGED_WIRE,
  StateChanged,
  type RunResourceRunCompletedInput,
  type RunResourceRunFailedInput,
  type RunResourceRunStartedInput,
  type RunResourceState,
  type RunResourceStateChangeReason,
  type RunResourceStateChangedInput,
} from "./telemetry";

// ============================================================================
// Public types
// ============================================================================

/**
 * Stable identity for a {@link RunResource} gate, persisted as
 * `entityId: resourceId`. Per-domain — no generic `kind` discriminator.
 *
 * @public
 */
export interface RunResourceRef {
  readonly resourceId: string;
}

/**
 * Fact type discriminators stored for {@link RunResource}.
 *
 * @public
 */
export type RunResourceFactType =
  | typeof RUN_STARTED_WIRE
  | typeof RUN_COMPLETED_WIRE
  | typeof RUN_FAILED_WIRE;

/**
 * Reasons attached to {@link RunResourceState} transitions.
 *
 * @public
 */
export type { RunResourceStateChangeReason } from "./telemetry";

/** @public */
export interface RunResourceRunStartedPayload {
  readonly concurrency: number;
}

/** @public */
export interface RunResourceRunCompletedPayload {
  readonly durationMs: number;
}

/** @public */
export interface RunResourceRunFailedPayload {
  readonly durationMs: number;
  readonly cause: string;
}

/**
 * Discriminated union of every run fact row for {@link RunResource}.
 *
 * @public
 */
export interface RunResourceRunStartedFact {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly type: "RunResource.Run.Started";
  readonly occurredAt: number;
  readonly payload: RunResourceRunStartedPayload;
  readonly attributes?: Record<string, unknown>;
}

/** @public */
export interface RunResourceRunCompletedFact {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly type: "RunResource.Run.Completed";
  readonly occurredAt: number;
  readonly payload: RunResourceRunCompletedPayload;
  readonly attributes?: Record<string, unknown>;
}

/** @public */
export interface RunResourceRunFailedFact {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly type: "RunResource.Run.Failed";
  readonly occurredAt: number;
  readonly payload: RunResourceRunFailedPayload;
  readonly attributes?: Record<string, unknown>;
}

/** @public */
export type RunResourceFact =
  | RunResourceRunStartedFact
  | RunResourceRunCompletedFact
  | RunResourceRunFailedFact;

/**
 * Live state snapshot for a {@link RunResource} gate.
 *
 * @public
 */
export type { RunResourceState } from "./telemetry";

/**
 * State transition recorded for a {@link RunResource} gate.
 *
 * @public
 */
export interface RunResourceStateChange {
  readonly id: string;
  readonly resourceId: string;
  readonly changedAt: number;
  readonly reason: RunResourceStateChangeReason;
  readonly previous: RunResourceState | null;
  readonly current: RunResourceState;
}

/**
 * Filter for {@link RunResourceStore.facts} queries.
 *
 * @public
 */
export interface RunResourceFactQuery {
  readonly resourceId?: string;
  readonly runId?: string;
  readonly types?: ReadonlyArray<RunResourceFactType>;
  readonly opts?: QueryOpts;
}

/**
 * Filter for {@link RunResourceStore.stateHistory} queries.
 *
 * @public
 */
export interface RunResourceStateHistoryQuery {
  readonly resourceId: string;
  readonly opts?: QueryOpts;
}

/**
 * Identifier-bound fact filter (the `resourceId` is supplied by
 * {@link RunResourceStore.for | for(resourceId)}).
 *
 * @public
 */
export interface RunResourceScopedFactQuery {
  readonly runId?: string;
  readonly types?: ReadonlyArray<RunResourceFactType>;
  readonly opts?: QueryOpts;
}

/**
 * Identifier-bound state-history filter (the `resourceId` is supplied by
 * {@link RunResourceStore.for | for(resourceId)}).
 *
 * @public
 */
export interface RunResourceScopedStateHistoryQuery {
  readonly opts?: QueryOpts;
}

/**
 * Identifier-bound run filter for the `byRun` method (the `resourceId` is
 * supplied by {@link RunResourceStore.for | for(resourceId)}).
 *
 * @public
 */
export interface RunResourceScopedByRunQuery {
  readonly runId: string;
}

/**
 * Paired run record produced by {@link RunResourceStore.runs} —
 * joins each `started` fact with its matching `completed` / `failed`
 * fact, ordered by `startedAt` descending.
 *
 * @public
 */
export interface RunResourceRun {
  readonly runId: string;
  readonly resourceId: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly durationMs: number | null;
  readonly outcome: "in-flight" | "completed" | "failed";
  readonly cause?: string;
}

// ============================================================================
// Wire codec (archive decode + ArchiveSink encode)
// ============================================================================

const RUN_RESOURCE_TYPE = RUN_RESOURCE_PROCESS_TYPE;

const RUN_RESOURCE_STATE_CHANGE_REASONS: ReadonlyArray<
  RunResourceStateChangeReason
> = STATE_CHANGE_REASONS;

const isStateChangeReason = (
  value: unknown,
): value is RunResourceStateChangeReason =>
  isString(value) &&
  RUN_RESOURCE_STATE_CHANGE_REASONS.some((reason) => reason === value);

const encodeRunFactRecord = (
  wire: typeof RUN_STARTED_WIRE | typeof RUN_COMPLETED_WIRE | typeof RUN_FAILED_WIRE,
  input: RunResourceRunStartedInput | RunResourceRunCompletedInput | RunResourceRunFailedInput,
): Omit<RuntimeRecord, "runId" | "createdAt"> => ({
  id: `${input.runId}/${wire}`,
  type: wire,
  occurredAt: DateTime.makeUnsafe(input.occurredAt),
  processType: RUN_RESOURCE_TYPE,
  processId: input.resourceId,
  payload: {
    runId: input.runId,
    occurredAt: input.occurredAt,
    payload: input.payload,
  },
});

const encodeStateChangedRecord = (
  input: RunResourceStateChangedInput,
): Omit<RuntimeRecord, "runId" | "createdAt"> => ({
  id: input.id,
  type: STATE_CHANGED_WIRE,
  occurredAt: DateTime.makeUnsafe(input.changedAt),
  processType: RUN_RESOURCE_TYPE,
  processId: input.current.resourceId,
  payload: {
    id: input.id,
    reason: input.reason,
    previous: input.previous,
    current: input.current,
  },
});

/** Archive persist legs derived from hub event definitions. @public */
export const archiveLegs = [
  leg(RunStarted, (input) => encodeRunFactRecord(RUN_STARTED_WIRE, input)),
  leg(RunCompleted, (input) => encodeRunFactRecord(RUN_COMPLETED_WIRE, input)),
  leg(RunFailed, (input) => encodeRunFactRecord(RUN_FAILED_WIRE, input)),
  leg(StateChanged, encodeStateChangedRecord),
] as const;

/** @public */
export type RunResourceArchiveLegs = typeof archiveLegs;

// ============================================================================
// Decoders
// ============================================================================

const decodeStateValueOption = (value: unknown): Option.Option<RunResourceState> =>
  recordValue(value).pipe(
    Option.flatMap((state) =>
      Option.all({
        resourceId: stringValue(state["resourceId"]),
        observedAt: numberValue(state["observedAt"]),
        configVersion: numberValue(state["configVersion"]),
        concurrency: numberValue(state["concurrency"]),
        waiting: numberValue(state["waiting"]),
        inFlight: numberValue(state["inFlight"]),
        completed: numberValue(state["completed"]),
        failed: numberValue(state["failed"]),
        interrupted: numberValue(state["interrupted"]),
        totalDurationMs: numberValue(state["totalDurationMs"]),
      }),
    ),
  );

interface RunResourceRunRecordFields {
  readonly runId: string;
  readonly occurredAt: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attributes?: Record<string, unknown>;
}

const decodeRunRecordFieldsOption = (
  record: RuntimeRecord,
): Option.Option<RunResourceRunRecordFields> =>
  record.processType !== RUN_RESOURCE_TYPE
    ? Option.none()
    : recordValue(record.payload).pipe(
        Option.flatMap((payload) =>
          Option.all({
            runId: stringValue(payload["runId"]),
            occurredAt: numberValue(payload["occurredAt"]),
            payload: recordValue(payload["payload"]),
          }),
        ),
        Option.map((fields) => {
          const attributes = recordAttributesObject(record.attributes);
          return {
            ...fields,
            ...(attributes === undefined ? {} : { attributes }),
          };
        }),
      );

const decodeRunStarted = (
  record: RuntimeRecord,
  type: "RunResource.Run.Started",
) =>
  nullable(
    decodeRunRecordFieldsOption(record).pipe(
      Option.flatMap((fields) =>
        numberValue(fields.payload["concurrency"]).pipe(
          Option.map((concurrency) => ({
            id: record.id,
            resourceId: record.processId,
            runId: fields.runId,
            type,
            occurredAt: fields.occurredAt,
            payload: { concurrency },
            ...(fields.attributes === undefined
              ? {}
              : { attributes: fields.attributes }),
          })),
        ),
      ),
    ),
  );

const decodeRunCompleted = (
  record: RuntimeRecord,
  type: "RunResource.Run.Completed",
) =>
  nullable(
    decodeRunRecordFieldsOption(record).pipe(
      Option.flatMap((fields) =>
        numberValue(fields.payload["durationMs"]).pipe(
          Option.map((durationMs) => ({
            id: record.id,
            resourceId: record.processId,
            runId: fields.runId,
            type,
            occurredAt: fields.occurredAt,
            payload: { durationMs },
            ...(fields.attributes === undefined
              ? {}
              : { attributes: fields.attributes }),
          })),
        ),
      ),
    ),
  );

const decodeRunFailed = (
  record: RuntimeRecord,
  type: "RunResource.Run.Failed",
) =>
  nullable(
    decodeRunRecordFieldsOption(record).pipe(
      Option.flatMap((fields) =>
        Option.all({
          durationMs: numberValue(fields.payload["durationMs"]),
          cause: stringValue(fields.payload["cause"]),
        }).pipe(
          Option.map(({ cause, durationMs }) => ({
            id: record.id,
            resourceId: record.processId,
            runId: fields.runId,
            type,
            occurredAt: fields.occurredAt,
            payload: { durationMs, cause },
            ...(fields.attributes === undefined
              ? {}
              : { attributes: fields.attributes }),
          })),
        ),
      ),
    ),
  );

const decodeStateChanged = (record: RuntimeRecord) => {
  if (record.processType !== RUN_RESOURCE_TYPE) return null;
  return nullable(
    recordValue(record.payload).pipe(
      Option.flatMap((payload) => {
        const previousRaw = payload["previous"];
        return Option.all({
          id: stringValue(payload["id"]),
          reason: valueWhen(payload["reason"], isStateChangeReason),
          previous:
            previousRaw === null
              ? Option.some(null)
              : decodeStateValueOption(previousRaw),
          current: decodeStateValueOption(payload["current"]),
        });
      }),
      Option.map(({ current, id, previous, reason }) => ({
        id,
        resourceId: record.processId,
        changedAt: DateTime.toEpochMillis(record.occurredAt),
        reason,
        previous,
        current,
      })),
    ),
  );
};

// ============================================================================
// Read helpers
// ============================================================================

const matchesFactQuery =
  (query: RunResourceFactQuery | undefined) =>
  (fact: RunResourceFact): boolean => {
    if (query?.resourceId !== undefined && fact.resourceId !== query.resourceId) {
      return false;
    }
    if (query?.runId !== undefined && fact.runId !== query.runId) {
      return false;
    }
    if (
      query?.types !== undefined &&
      query.types.length > 0 &&
      !query.types.includes(fact.type)
    ) {
      return false;
    }
    return true;
  };

const factsFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  query: RunResourceFactQuery | undefined,
): RunResourceFact[] =>
  applyQueryOpts(
    filterMapNullable(records, recordToFact).filter(matchesFactQuery(query)),
    query?.opts,
    (fact) => fact.occurredAt,
  );

const stateChangesFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  resourceId: string | undefined,
): RunResourceStateChange[] =>
  filterMapNullable(records, recordToStateChange)
    .filter((change) => resourceId === undefined || change.resourceId === resourceId);

const sortedStateChanges = (
  changes: ReadonlyArray<RunResourceStateChange>,
  opts?: QueryOpts,
): RunResourceStateChange[] =>
  applyQueryOpts(
    [...changes].sort(
      byTimestampDesc(
        (change) => change.changedAt,
        (change) => change.id,
      ),
    ),
    opts,
    (change) => change.changedAt,
  );

type RunResourceEndedFact =
  | RunResourceRunCompletedFact
  | RunResourceRunFailedFact;

type RunPairAccumulator = {
  readonly startedByRun: Map<string, RunResourceRunStartedFact>;
  readonly endedByRun: Map<string, RunResourceEndedFact>;
};

const isStartedFact = (
  fact: RunResourceFact,
): fact is RunResourceRunStartedFact =>
  fact.type === RUN_STARTED_WIRE;

const isEndedFact = (fact: RunResourceFact): fact is RunResourceEndedFact =>
  fact.type === RUN_COMPLETED_WIRE || fact.type === RUN_FAILED_WIRE;

const setEarlierStart = (
  map: Map<string, RunResourceRunStartedFact>,
  fact: RunResourceRunStartedFact,
): Map<string, RunResourceRunStartedFact> => {
  const existing = map.get(fact.runId);
  if (existing === undefined || fact.occurredAt < existing.occurredAt) {
    map.set(fact.runId, fact);
  }
  return map;
};

const setLaterEnd = (
  map: Map<string, RunResourceEndedFact>,
  fact: RunResourceEndedFact,
): Map<string, RunResourceEndedFact> => {
  const existing = map.get(fact.runId);
  if (existing === undefined || fact.occurredAt > existing.occurredAt) {
    map.set(fact.runId, fact);
  }
  return map;
};

const runFromPair = (
  endedByRun: Map<string, RunResourceEndedFact>,
) =>
  ([runId, started]: readonly [
    string,
    RunResourceRunStartedFact,
  ]): RunResourceRun => {
    const ended = endedByRun.get(runId);
    if (ended === undefined) {
      return {
        runId,
        resourceId: started.resourceId,
        startedAt: started.occurredAt,
        endedAt: null,
        durationMs: null,
        outcome: "in-flight",
      };
    }
    const outcome: "completed" | "failed" =
      ended.type === RUN_COMPLETED_WIRE ? "completed" : "failed";
    return {
      runId,
      resourceId: started.resourceId,
      startedAt: started.occurredAt,
      endedAt: ended.occurredAt,
      durationMs: ended.payload.durationMs,
      outcome,
      ...(ended.type === "RunResource.Run.Failed"
        ? { cause: ended.payload.cause }
        : {}),
    };
  };

const pairRuns = (facts: ReadonlyArray<RunResourceFact>): RunResourceRun[] => {
  const { endedByRun, startedByRun } = facts.reduce<RunPairAccumulator>(
    (acc, fact) => {
      if (isStartedFact(fact)) {
        setEarlierStart(acc.startedByRun, fact);
      }
      if (isEndedFact(fact)) {
        setLaterEnd(acc.endedByRun, fact);
      }
      return acc;
    },
    {
      startedByRun: new Map(),
      endedByRun: new Map(),
    },
  );
  return [...startedByRun.entries()]
    .map(runFromPair(endedByRun))
    .sort((a, b) => b.startedAt - a.startedAt);
};

// ============================================================================
// Read query builders
// ============================================================================

const factPredicates = (
  query: RunResourceFactQuery | undefined,
): import("../../Query").RuntimeRecordPredicate[] => [
    Type.in(factRecordTypes),
    ...(query?.resourceId === undefined
      ? []
      : [ProcessId.equals(query.resourceId)]),
  ];

const stateChangedPredicates = (
  resourceId: string | undefined,
): import("../../Query").RuntimeRecordPredicate[] => [
    Type.in(stateRecordTypes),
    ...(resourceId === undefined ? [] : [ProcessId.equals(resourceId)]),
  ];

const factRecordTypes = [RUN_STARTED_WIRE, RUN_COMPLETED_WIRE, RUN_FAILED_WIRE] as const;
const stateRecordTypes = [STATE_CHANGED_WIRE] as const;

const recordToFact = (record: RuntimeRecord): RunResourceFact | null => {
  if (record.type === "RunResource.Run.Started") {
    return decodeRunStarted(record, "RunResource.Run.Started");
  }
  if (record.type === "RunResource.Run.Completed") {
    return decodeRunCompleted(record, "RunResource.Run.Completed");
  }
  if (record.type === "RunResource.Run.Failed") {
    return decodeRunFailed(record, "RunResource.Run.Failed");
  }
  return null;
};

const recordToStateChange = (
  record: RuntimeRecord,
): RunResourceStateChange | null => decodeStateChanged(record);

// ============================================================================
// Facet
// ============================================================================

/**
 * `RunResource` archive facet (queries only — emits via {@link RunResourceHubTelemetry}).
 *
 * @public
 */
// ============================================================================
// Query + for schemas
// ============================================================================

const QueryOptsSchema = Schema.Struct({
  limit:  Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  order:  Schema.optional(Schema.Literals(["asc", "desc"] as const)),
});

const RunResourceFactQuerySchema = Schema.Struct({
  resourceId: Schema.optional(Schema.String),
  runId:      Schema.optional(Schema.String),
  types:      Schema.optional(Schema.Array(Schema.Literals([RUN_STARTED_WIRE, RUN_COMPLETED_WIRE, RUN_FAILED_WIRE]))),
  opts:       Schema.optional(QueryOptsSchema),
});

const RunResourceStateHistoryQuerySchema = Schema.Struct({
  resourceId: Schema.String,
  opts:       Schema.optional(QueryOptsSchema),
});

const RunResourceLatestStateQuerySchema = Schema.Struct({
  resourceId: Schema.String,
});

const RunResourceRunsQuerySchema = Schema.Struct({
  resourceId: Schema.String,
});

const RunResourceByRunQuerySchema = Schema.Struct({
  runId: Schema.String,
});

// For-bound (no resourceId — bound by id)
const RunResourceScopedFactQuerySchema = Schema.Struct({
  runId:  Schema.optional(Schema.String),
  types:  Schema.optional(Schema.Array(Schema.Literals([RUN_STARTED_WIRE, RUN_COMPLETED_WIRE, RUN_FAILED_WIRE]))),
  opts:   Schema.optional(QueryOptsSchema),
});

const RunResourceScopedStateHistoryQuerySchema = Schema.Struct({
  opts: Schema.optional(QueryOptsSchema),
});

const RunResourceScopedByRunQuerySchema = Schema.Struct({
  runId: Schema.String,
});

// Output schemas
const RunResourceFactCommonFields = {
  id:          Schema.String,
  resourceId:  Schema.String,
  runId:       Schema.String,
  occurredAt:  Schema.Number,
  attributes:  Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
} as const;

const RunResourceRunStartedFactSchema = Schema.Struct({
  ...RunResourceFactCommonFields,
  type:    Schema.Literal("RunResource.Run.Started"),
  payload: Schema.Struct({ concurrency: Schema.Number }),
});

const RunResourceRunCompletedFactSchema = Schema.Struct({
  ...RunResourceFactCommonFields,
  type:    Schema.Literal("RunResource.Run.Completed"),
  payload: Schema.Struct({ durationMs: Schema.Number }),
});

const RunResourceRunFailedFactSchema = Schema.Struct({
  ...RunResourceFactCommonFields,
  type:    Schema.Literal("RunResource.Run.Failed"),
  payload: Schema.Struct({ durationMs: Schema.Number, cause: Schema.String }),
});

const RunResourceFactOutputSchema = Schema.Union([
  RunResourceRunStartedFactSchema,
  RunResourceRunCompletedFactSchema,
  RunResourceRunFailedFactSchema,
]);

const RunResourceStateOutputSchema = Schema.Struct({
  resourceId:     Schema.String,
  observedAt:     Schema.Number,
  configVersion:  Schema.Number,
  concurrency:    Schema.Number,
  waiting:        Schema.Number,
  inFlight:       Schema.Number,
  completed:      Schema.Number,
  failed:         Schema.Number,
  interrupted:    Schema.Number,
  totalDurationMs: Schema.Number,
});

const RunResourceStateChangeOutputSchema = Schema.Struct({
  id:         Schema.String,
  resourceId: Schema.String,
  changedAt:  Schema.Number,
  reason:     Schema.Literals(STATE_CHANGE_REASONS),
  previous: Schema.NullOr(RunResourceStateOutputSchema),
  current:  RunResourceStateOutputSchema,
});

const RunResourceRunOutputSchema = Schema.Struct({
  runId:      Schema.String,
  resourceId: Schema.String,
  startedAt:  Schema.Number,
  endedAt:    Schema.NullOr(Schema.Number),
  durationMs: Schema.NullOr(Schema.Number),
  outcome:    Schema.Literals(["in-flight", "completed", "failed"] as const),
  cause:      Schema.optional(Schema.String),
});

const RunResourceLatestStateOutputSchema = Schema.Option(RunResourceStateOutputSchema);

// ============================================================================
// Facet
// ============================================================================

export class RunResourceStore extends ProcessStore.Service<RunResourceStore>()(
  "@nikscripts/effect-pm/store/runResource/RunResourceStore",
  "RunResource",
  ProcessStore.query({
    facts: ProcessStore
      .payload(RunResourceFactQuerySchema)
      .success(Schema.Array(RunResourceFactOutputSchema))
      .resolve((s: ProcessStoreSpine) => (query) => readFacts(s, query)),

    stateHistory: ProcessStore
      .payload(RunResourceStateHistoryQuerySchema)
      .success(Schema.Array(RunResourceStateChangeOutputSchema))
      .resolve((s: ProcessStoreSpine) => (query) => readStateHistory(s, query)),

    latestState: ProcessStore
      .payload(RunResourceLatestStateQuerySchema)
      .success(RunResourceLatestStateOutputSchema)
      .resolve((s: ProcessStoreSpine) => ({ resourceId }) => readLatestState(s, resourceId)),

    runs: ProcessStore
      .payload(RunResourceRunsQuerySchema)
      .success(Schema.Array(RunResourceRunOutputSchema))
      .resolve((s: ProcessStoreSpine) => ({ resourceId }) => readRuns(s, resourceId)),

    byRun: ProcessStore
      .payload(RunResourceByRunQuerySchema)
      .success(Schema.Array(RunResourceFactOutputSchema))
      .resolve((s: ProcessStoreSpine) => ({ runId }) => readByRun(s, runId)),
  }),
  ProcessStore.for({
    facts: ProcessStore
      .payload(RunResourceScopedFactQuerySchema)
      .success(Schema.Array(RunResourceFactOutputSchema))
      .resolve((resourceId, s) => (query) =>
        readFacts(s, { resourceId, ...query }),
      ),

    stateHistory: ProcessStore
      .payload(RunResourceScopedStateHistoryQuerySchema)
      .success(Schema.Array(RunResourceStateChangeOutputSchema))
      .resolve((resourceId, s) => (query) =>
        readStateHistory(s, { resourceId, ...query }),
      ),

    latestState: ProcessStore
      .payload(Schema.Struct({}))
      .success(RunResourceLatestStateOutputSchema)
      .resolve((resourceId, s) => (_) => readLatestState(s, resourceId)),

    runs: ProcessStore
      .payload(Schema.Struct({}))
      .success(Schema.Array(RunResourceRunOutputSchema))
      .resolve((resourceId, s) => (_) => readRuns(s, resourceId)),

    byRun: ProcessStore
      .payload(RunResourceScopedByRunQuerySchema)
      .success(Schema.Array(RunResourceFactOutputSchema))
      .resolve((resourceId, s) => (query) =>
        readFacts(s, { resourceId, ...query }),
      ),
  }),
) {}

const readFacts = (
  s: ProcessStoreSpine,
  query: RunResourceFactQuery | undefined,
): Effect.Effect<RunResourceFact[], RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(factPredicates(query), windowOpts(query?.opts)))
    .pipe(Effect.map((records) => factsFromRecords(records, query)));

const readStateHistory = (
  s: ProcessStoreSpine,
  query: RunResourceStateHistoryQuery | undefined,
): Effect.Effect<RunResourceStateChange[], RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(stateChangedPredicates(query?.resourceId), undefined))
    .pipe(
      Effect.map((records) =>
        sortedStateChanges(
          stateChangesFromRecords(records, query?.resourceId),
          query?.opts,
        ),
      ),
    );

const readLatestState = (
  s: ProcessStoreSpine,
  resourceId: string,
): Effect.Effect<Option.Option<RunResourceState>, RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(stateChangedPredicates(resourceId), undefined))
    .pipe(
      Effect.map((records) => {
        const latest = sortedStateChanges(
          stateChangesFromRecords(records, resourceId),
          { limit: 1 },
        )[0];
        return latest === undefined
          ? Option.none<RunResourceState>()
          : Option.some(latest.current);
      }),
    );

const readRuns = (
  s: ProcessStoreSpine,
  resourceId: string,
): Effect.Effect<RunResourceRun[], RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(factPredicates({ resourceId }), undefined))
    .pipe(
      Effect.map((records) =>
        pairRuns(factsFromRecords(records, { resourceId })),
      ),
    );

const readByRun = (
  s: ProcessStoreSpine,
  runId: string,
): Effect.Effect<RunResourceFact[], RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(factPredicates(undefined), undefined))
    .pipe(Effect.map((records) => factsFromRecords(records, { runId })));

