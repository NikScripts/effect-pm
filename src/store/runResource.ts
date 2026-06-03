/**
 * **`RunResource` storage facet** — durable, queryable history of every
 * gated run (started / completed / failed) plus state-machine snapshots.
 *
 * @remarks
 * Per-domain facet for {@link RunResource} (the concurrency gate in
 * `src/RunResource.ts`). Owns its concrete fact / change / query types
 * and provides a `runs()` projection that pairs each `started` fact
 * with its matching `completed` / `failed` fact for operator-friendly
 * run history.
 *
 * ## At-a-glance
 *
 * | Concern | Where |
 * |--------|-------|
 * | Wire types | `RunResource.Run.Started` / `.Completed` / `.Failed`, `RunResource.State.Changed` |
 * | Static emit | `Run.Started({ payload })` / `Run.Completed({ payload })` / `Run.Failed({ payload })` / `State.Changed({ ... })` |
 * | Reads (instance) | `facts(query?)`, `stateHistory(query?)`, `latestState(id)`, `runs(id)`, `byRun(runId)` |
 * | Reads (bound, `for(resourceId)`) | `facts(query?)`, `stateHistory(query?)`, `latestState()`, `runs()`, `byRun(runId)` |
 *
 * ## Storage shape
 *
 * Run resource records share `processType: "RunResource"` and
 * `processId: <resourceId>`:
 *
 * - `RunResource.Run.*` — `payload = { runId, occurredAt, payload }`.
 * - `RunResource.State.Changed` — `payload = { id, changedAt, reason,
 *   previous, current }`.
 *
 * ## Compose
 *
 * - `RunResourceStore.layerRuntimeStorage` — facet on top of an
 *   injected {@link RuntimeStorage} (durable backends).
 * - `RunResourceStore.layer` — facet + in-memory storage
 *   (dev / test).
 *
 * ## Read (after compose)
 *
 * ```ts
 * const runs = yield* RunResourceStore;
 * yield* runs.facts({ resourceId: "@app/Gate" });
 * yield* runs.stateHistory({ resourceId: "@app/Gate" });
 * yield* runs.runs("@app/Gate");           // paired started+ended history
 * yield* runs.byRun("@app/Gate/run/3");    // facts for one run
 * yield* runs.latestState("@app/Gate");
 *
 * // Identifier-bound shortcut:
 * const gate = yield* RunResourceStore.for("@app/Gate");
 * yield* gate.runs();
 * yield* gate.latestState();
 * ```
 *
 * @module store/RunResource
 */

import { DateTime, Effect, Option, Schema } from "effect";
import {
  filterMapNullable,
  nullable,
  numberValue,
  recordValue,
  stringValue,
  valueWhen,
} from "../internal/store/decode";
import {
  applyQueryOpts,
  byTimestampDesc,
  isString,
  recordAttributesObject,
  runtimeRecordQuery,
  windowOpts,
} from "../internal/store/helpers";
import type { ProcessStoreSpine } from "../internal/store/spine";
import { ProcessStore, Telemetry } from "../ProcessStore";
import type { QueryOpts } from "../ProcessStoreEvent";
import { ProcessId, Type } from "../Query";
import type { RuntimeRecord, RuntimeStorageOperationalError } from "../RuntimeStorage";
import { RunResourceScope, RunScope } from "../RunResourceScope";

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
 * Fact type discriminators emitted by {@link RunResource}.
 *
 * @public
 */
export type RunResourceFactType =
  Telemetry.Type.Event<typeof RunResourceTelemetry, "Run">;

/**
 * Reasons attached to {@link RunResourceState} transitions.
 *
 * @public
 */
export type RunResourceStateChangeReason =
  | "RunResource.State.Waiting"
  | "RunResource.State.Started"
  | "RunResource.State.Completed"
  | "RunResource.State.Failed"
  | "RunResource.State.Interrupted"
  | "RunResource.State.WaitInterrupted";

/**
 * Discriminated union of every fact emitted by {@link RunResource}.
 *
 * @public
 */
export type RunResourceFact =
  Telemetry.Type.CodecTag<typeof RunResourceCodec, "Run">;

/** @public */
export type RunResourceRunStartedFact = Extract<
  RunResourceFact,
  { readonly type: "RunResource.Run.Started" }
>;

/** @public */
export type RunResourceRunCompletedFact = Extract<
  RunResourceFact,
  { readonly type: "RunResource.Run.Completed" }
>;

/** @public */
export type RunResourceRunFailedFact = Extract<
  RunResourceFact,
  { readonly type: "RunResource.Run.Failed" }
>;

/** @public */
export type RunResourceRunStartedPayload =
  RunResourceRunStartedFact["payload"];

/** @public */
export type RunResourceRunCompletedPayload =
  RunResourceRunCompletedFact["payload"];

/** @public */
export type RunResourceRunFailedPayload =
  RunResourceRunFailedFact["payload"];

/**
 * Live state snapshot for a {@link RunResource} gate.
 *
 * @public
 */
export interface RunResourceState {
  readonly resourceId: string;
  readonly observedAt: number;
  readonly configVersion: number;
  readonly concurrency: number;
  readonly waiting: number;
  readonly inFlight: number;
  readonly completed: number;
  readonly failed: number;
  readonly interrupted: number;
  readonly totalDurationMs: number;
}

/**
 * State transition recorded for a {@link RunResource} gate.
 *
 * @public
 */
export type RunResourceStateChange =
  Telemetry.Type.CodecTag<typeof RunResourceCodec, "State">;

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
// Wire codec (facet-owned)
// ============================================================================

const RUN_RESOURCE_TYPE = "RunResource";
const runResourcePath = <
  const Tag extends string,
  const Event extends string,
>(
  tag: Tag,
  event: Event,
): `RunResource.${Tag}.${Event}` =>
  `RunResource.${tag}.${event}`;

const RUN_STARTED_WIRE = runResourcePath("Run", "Started");
const RUN_COMPLETED_WIRE = runResourcePath("Run", "Completed");
const RUN_FAILED_WIRE = runResourcePath("Run", "Failed");
const STATE_WAITING_WIRE = runResourcePath("State", "Waiting");
const STATE_STARTED_WIRE = runResourcePath("State", "Started");
const STATE_COMPLETED_WIRE = runResourcePath("State", "Completed");
const STATE_FAILED_WIRE = runResourcePath("State", "Failed");
const STATE_INTERRUPTED_WIRE = runResourcePath("State", "Interrupted");
const STATE_WAIT_INTERRUPTED_WIRE = runResourcePath("State", "WaitInterrupted");

const RUN_RESOURCE_STATE_CHANGE_REASONS: ReadonlyArray<
  RunResourceStateChangeReason
> = [
  STATE_WAITING_WIRE,
  STATE_STARTED_WIRE,
  STATE_COMPLETED_WIRE,
  STATE_FAILED_WIRE,
  STATE_INTERRUPTED_WIRE,
  STATE_WAIT_INTERRUPTED_WIRE,
];

const isStateChangeReason = (
  value: unknown,
): value is RunResourceStateChangeReason =>
  isString(value) &&
  RUN_RESOURCE_STATE_CHANGE_REASONS.some((reason) => reason === value);

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
      ...(ended.type === RUN_FAILED_WIRE
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
): import("../Query").RuntimeRecordPredicate[] => [
    Type.in(factRecordTypes),
    ...(query?.resourceId === undefined
      ? []
      : [ProcessId.equals(query.resourceId)]),
  ];

const stateChangedPredicates = (
  resourceId: string | undefined,
): import("../Query").RuntimeRecordPredicate[] => [
    Type.in(stateRecordTypes),
    ...(resourceId === undefined ? [] : [ProcessId.equals(resourceId)]),
  ];

const RunResourceStateSchema = Schema.Struct({
  resourceId: Schema.String,
  observedAt: Schema.Number,
  configVersion: Schema.Number,
  concurrency: Schema.Number,
  waiting: Schema.Number,
  inFlight: Schema.Number,
  completed: Schema.Number,
  failed: Schema.Number,
  interrupted: Schema.Number,
  totalDurationMs: Schema.Number,
});

const RunState = RunScope.Schema.State;

class RunResourceRunStarted extends Telemetry.Schema<RunResourceRunStarted>()(
  RunScope,
)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({
    concurrency: Schema.Number,
  }),
}) {}

class RunResourceRunCompleted extends Telemetry.Schema<RunResourceRunCompleted>()(
  RunScope,
)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({
    durationMs: Schema.Number,
  }),
}) {}

class RunResourceRunFailed extends Telemetry.Schema<RunResourceRunFailed>()(
  RunScope,
)({
  runId: RunState.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({
    durationMs: Schema.Number,
    cause: Schema.String,
  }),
}) {}

class RunResourceStateChanged extends Telemetry.Schema<RunResourceStateChanged>()(
  RunResourceScope,
)({
  id: Schema.String,
  changedAt: Telemetry.terminal.clockMillis,
  reason: Schema.Literals([
    STATE_WAITING_WIRE,
    STATE_STARTED_WIRE,
    STATE_COMPLETED_WIRE,
    STATE_FAILED_WIRE,
    STATE_INTERRUPTED_WIRE,
    STATE_WAIT_INTERRUPTED_WIRE,
  ]),
  previous: Schema.NullOr(RunResourceStateSchema),
  current: RunResourceStateSchema,
}) {}

const RunResourceTelemetry = ProcessStore.telemetry(RunResourceScope)(
  Telemetry.namespace("RunResource"),
  Telemetry.tag("Run")(
    Telemetry.event("Started", RunResourceRunStarted).pipe(
      Telemetry.logWarning(
        "RunResourceStore write failed for run start",
        ({ runId }) => ({ runId: String(runId) }),
      ),
    ),
    Telemetry.event("Completed", RunResourceRunCompleted).pipe(
      Telemetry.logWarning(
        "RunResourceStore write failed for run completion",
        ({ runId }) => ({ runId: String(runId) }),
      ),
    ),
    Telemetry.event("Failed", RunResourceRunFailed).pipe(
      Telemetry.logWarning(
        "RunResourceStore write failed for run failure",
        ({ runId }) => ({ runId: String(runId) }),
      ),
    ),
  ),
  Telemetry.tag("State")(
    Telemetry.event("Changed", RunResourceStateChanged).pipe(
      Telemetry.logWarning(
        "RunResourceStore write failed for state change",
        ({ reason }) => ({ reason: String(reason) }),
      ),
    ),
  ),
);

const RunResourceCodec = Telemetry.codec(RunResourceTelemetry)({
  Run: {
    Started: decodeRunStarted,
    Completed: decodeRunCompleted,
    Failed: decodeRunFailed,
  },
  State: {
    Changed: decodeStateChanged,
  },
});

const factRecordTypes = RunResourceCodec.types("Run");
const stateRecordTypes = RunResourceCodec.types("State");

const recordToFact = (record: RuntimeRecord): RunResourceFact | null =>
  RunResourceCodec.decodeTag("Run", record);

const recordToStateChange = (
  record: RuntimeRecord,
): RunResourceStateChange | null =>
  RunResourceCodec.decodeTag("State", record);

// ============================================================================
// Facet
// ============================================================================

/**
 * `RunResource` storage facet (see module doc).
 *
 * Static optional telemetry emitters no-op when the facet is absent. Event
 * definitions own storage-failure logging through `Telemetry.logWarning`, so
 * run telemetry never changes the gated effect's success/error channel.
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
  types:      Schema.optional(Schema.Array(Schema.String)),
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
  types:  Schema.optional(Schema.Array(Schema.String)),
  opts:   Schema.optional(QueryOptsSchema),
});

const RunResourceScopedStateHistoryQuerySchema = Schema.Struct({
  opts: Schema.optional(QueryOptsSchema),
});

const RunResourceScopedByRunQuerySchema = Schema.Struct({
  runId: Schema.String,
});

type RunResourceScopedByRunQuery = typeof RunResourceScopedByRunQuerySchema.Type;

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
  reason:     Schema.Literals([
    STATE_WAITING_WIRE,
    STATE_STARTED_WIRE,
    STATE_COMPLETED_WIRE,
    STATE_FAILED_WIRE,
    STATE_INTERRUPTED_WIRE,
    STATE_WAIT_INTERRUPTED_WIRE,
  ]),
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

export const RunResourceStore = ProcessStore.Service(
  "@nikscripts/effect-pm/store/runResource/RunResourceStore",
  "RunResource",
  RunResourceTelemetry,
  ProcessStore.query({
    facts: ProcessStore
      .payload(RunResourceFactQuerySchema)
      .success(Schema.Array(RunResourceFactOutputSchema))
      .resolve((s: ProcessStoreSpine) => (query) => readFacts(s, query as RunResourceFactQuery)),

    stateHistory: ProcessStore
      .payload(RunResourceStateHistoryQuerySchema)
      .success(Schema.Array(RunResourceStateChangeOutputSchema))
      .resolve((s: ProcessStoreSpine) => (query) => readStateHistory(s, query as RunResourceStateHistoryQuery)),

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
      .resolve((resourceId: string, s: ProcessStoreSpine) => (query: unknown) =>
        readFacts(s, { resourceId, ...(query as RunResourceScopedFactQuery) } as RunResourceFactQuery),
      ),

    stateHistory: ProcessStore
      .payload(RunResourceScopedStateHistoryQuerySchema)
      .success(Schema.Array(RunResourceStateChangeOutputSchema))
      .resolve((resourceId: string, s: ProcessStoreSpine) => (query: unknown) =>
        readStateHistory(s, { resourceId, ...(query as RunResourceScopedStateHistoryQuery) } as RunResourceStateHistoryQuery),
      ),

    latestState: ProcessStore
      .payload(Schema.Struct({}))
      .success(RunResourceLatestStateOutputSchema)
      .resolve((resourceId: string, s: ProcessStoreSpine) => (_: unknown) => readLatestState(s, resourceId)),

    runs: ProcessStore
      .payload(Schema.Struct({}))
      .success(Schema.Array(RunResourceRunOutputSchema))
      .resolve((resourceId: string, s: ProcessStoreSpine) => (_: unknown) => readRuns(s, resourceId)),

    byRun: ProcessStore
      .payload(RunResourceScopedByRunQuerySchema)
      .success(Schema.Array(RunResourceFactOutputSchema))
      .resolve((resourceId: string, s: ProcessStoreSpine) => (query: unknown) =>
        readFacts(s, { resourceId, ...(query as RunResourceScopedByRunQuery) }),
      ),
  }),
);

export type RunResourceStore = typeof RunResourceStore.Identifier;

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

