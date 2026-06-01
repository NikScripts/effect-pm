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
  applyQueryOpts,
  byTimestampDesc,
  isFiniteNumber,
  isRecord,
  isString,
  recordAttributesObject,
  runtimeRecordQuery,
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

/** @public */
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

/**
 * Discriminated union of every fact emitted by {@link RunResource}.
 *
 * @public
 */
export type RunResourceFact =
  | RunResourceRunStartedFact
  | RunResourceRunCompletedFact
  | RunResourceRunFailedFact;

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
const STATE_CHANGED_WIRE = runResourcePath("State", "Changed");

const factRecordTypes = [
  RUN_STARTED_WIRE,
  RUN_COMPLETED_WIRE,
  RUN_FAILED_WIRE,
] as const;

const stateRecordTypes = [
  STATE_CHANGED_WIRE,
] as const;

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

const decodeStateValue = (value: unknown): RunResourceState | null => {
  if (!isRecord(value)) return null;
  const resourceId = value["resourceId"];
  const observedAt = value["observedAt"];
  const configVersion = value["configVersion"];
  const concurrency = value["concurrency"];
  const waiting = value["waiting"];
  const inFlight = value["inFlight"];
  const completed = value["completed"];
  const failed = value["failed"];
  const interrupted = value["interrupted"];
  const totalDurationMs = value["totalDurationMs"];
  if (
    !isString(resourceId) ||
    !isFiniteNumber(observedAt) ||
    !isFiniteNumber(configVersion) ||
    !isFiniteNumber(concurrency) ||
    !isFiniteNumber(waiting) ||
    !isFiniteNumber(inFlight) ||
    !isFiniteNumber(completed) ||
    !isFiniteNumber(failed) ||
    !isFiniteNumber(interrupted) ||
    !isFiniteNumber(totalDurationMs)
  ) {
    return null;
  }
  return {
    resourceId,
    observedAt,
    configVersion,
    concurrency,
    waiting,
    inFlight,
    completed,
    failed,
    interrupted,
    totalDurationMs,
  };
};

const recordToFact = (record: RuntimeRecord): RunResourceFact | null => {
  if (record.processType !== RUN_RESOURCE_TYPE) return null;
  if (!isRecord(record.payload)) return null;
  const runId = record.payload["runId"];
  const occurredAt = record.payload["occurredAt"];
  const payload = record.payload["payload"];
  if (!isString(runId) || !isFiniteNumber(occurredAt) || !isRecord(payload)) {
    return null;
  }
  const attributes = recordAttributesObject(record.attributes);
  switch (record.type) {
    case RUN_STARTED_WIRE: {
      const concurrency = payload["concurrency"];
      if (!isFiniteNumber(concurrency)) return null;
      return {
        id: record.id,
        resourceId: record.processId,
        runId,
        type: RUN_STARTED_WIRE,
        occurredAt,
        payload: { concurrency },
        ...(attributes === undefined ? {} : { attributes }),
      };
    }
    case RUN_COMPLETED_WIRE: {
      const durationMs = payload["durationMs"];
      if (!isFiniteNumber(durationMs)) return null;
      return {
        id: record.id,
        resourceId: record.processId,
        runId,
        type: RUN_COMPLETED_WIRE,
        occurredAt,
        payload: { durationMs },
        ...(attributes === undefined ? {} : { attributes }),
      };
    }
    case RUN_FAILED_WIRE: {
      const durationMs = payload["durationMs"];
      const cause = payload["cause"];
      if (!isFiniteNumber(durationMs) || !isString(cause)) return null;
      return {
        id: record.id,
        resourceId: record.processId,
        runId,
        type: RUN_FAILED_WIRE,
        occurredAt,
        payload: { durationMs, cause },
        ...(attributes === undefined ? {} : { attributes }),
      };
    }
    default:
      return null;
  }
};

const recordToStateChange = (
  record: RuntimeRecord,
): RunResourceStateChange | null => {
  if (record.processType !== RUN_RESOURCE_TYPE) return null;
  if (record.type !== STATE_CHANGED_WIRE) return null;
  if (!isRecord(record.payload)) return null;
  const id = record.payload["id"];
  const reason = record.payload["reason"];
  const previousRaw = record.payload["previous"];
  const previous = previousRaw === null ? null : decodeStateValue(previousRaw);
  const current = decodeStateValue(record.payload["current"]);
  if (
    !isString(id) ||
    !isStateChangeReason(reason) ||
    (previousRaw !== null && previous === null) ||
    current === null
  ) {
    return null;
  }
  return {
    id,
    resourceId: record.processId,
    changedAt: DateTime.toEpochMillis(record.occurredAt),
    reason,
    previous,
    current,
  };
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
): RunResourceFact[] => {
  const matches = matchesFactQuery(query);
  const facts: RunResourceFact[] = [];
  for (const record of records) {
    const fact = recordToFact(record);
    if (fact === null) continue;
    if (!matches(fact)) continue;
    facts.push(fact);
  }
  return applyQueryOpts(facts, query?.opts, (fact) => fact.occurredAt);
};

const stateChangesFromRecords = (
  records: ReadonlyArray<RuntimeRecord>,
  resourceId: string | undefined,
): RunResourceStateChange[] => {
  const changes: RunResourceStateChange[] = [];
  for (const record of records) {
    const change = recordToStateChange(record);
    if (change === null) continue;
    if (resourceId !== undefined && change.resourceId !== resourceId) continue;
    changes.push(change);
  }
  return changes;
};

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

const pairRuns = (facts: ReadonlyArray<RunResourceFact>): RunResourceRun[] => {
  const startedByRun = new Map<string, RunResourceRunStartedFact>();
  const endedByRun = new Map<
    string,
    RunResourceRunCompletedFact | RunResourceRunFailedFact
  >();

  for (const fact of facts) {
    if (fact.type === RUN_STARTED_WIRE) {
      const existing = startedByRun.get(fact.runId);
      if (existing === undefined || fact.occurredAt < existing.occurredAt) {
        startedByRun.set(fact.runId, fact);
      }
      continue;
    }
    const existing = endedByRun.get(fact.runId);
    if (existing === undefined || fact.occurredAt > existing.occurredAt) {
      endedByRun.set(fact.runId, fact);
    }
  }

  const runs: RunResourceRun[] = [];
  for (const [runId, started] of startedByRun) {
    const ended = endedByRun.get(runId);
    if (ended === undefined) {
      runs.push({
        runId,
        resourceId: started.resourceId,
        startedAt: started.occurredAt,
        endedAt: null,
        durationMs: null,
        outcome: "in-flight",
      });
      continue;
    }
    const outcome: "completed" | "failed" =
      ended.type === RUN_COMPLETED_WIRE ? "completed" : "failed";
    runs.push({
      runId,
      resourceId: started.resourceId,
      startedAt: started.occurredAt,
      endedAt: ended.occurredAt,
      durationMs: ended.payload.durationMs,
      outcome,
      ...(ended.type === RUN_FAILED_WIRE
        ? { cause: ended.payload.cause }
        : {}),
    });
  }

  runs.sort((a, b) => b.startedAt - a.startedAt);
  return runs;
};

// ============================================================================
// Read query builders
// ============================================================================

const factPredicates = (
  query: RunResourceFactQuery | undefined,
): import("../Query").RuntimeRecordPredicate[] => {
  const preds: import("../Query").RuntimeRecordPredicate[] = [
    Type.in(factRecordTypes),
  ];
  if (query?.resourceId !== undefined) {
    preds.push(ProcessId.equals(query.resourceId));
  }
  return preds;
};

const stateChangedPredicates = (
  resourceId: string | undefined,
): import("../Query").RuntimeRecordPredicate[] => {
  const preds: import("../Query").RuntimeRecordPredicate[] = [
    Type.in(stateRecordTypes),
  ];
  if (resourceId !== undefined) {
    preds.push(ProcessId.equals(resourceId));
  }
  return preds;
};

// Drop opts.limit when the storage query is a superset of the post-filter
// (e.g. when post-filtering by `runId` or fact subtype) so limits apply to
// the already-narrowed fact list rather than the broader event stream.
const factWindowOpts = (
  opts: QueryOpts | undefined,
): QueryOpts | undefined => {
  if (opts === undefined) return undefined;
  const out: { -readonly [K in keyof QueryOpts]: QueryOpts[K] } = {};
  if (opts.before !== undefined) out.before = opts.before;
  if (opts.after !== undefined) out.after = opts.after;
  return out;
};

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
export const RunResourceStore = ProcessStore.Service(
  "@nikscripts/effect-pm/store/runResource/RunResourceStore",
  RunResourceTelemetry,
  ProcessStore.query((s) => ({
    facts: (query?: RunResourceFactQuery) => readFacts(s, query),
    stateHistory: (query?: RunResourceStateHistoryQuery) =>
      readStateHistory(s, query),
    latestState: (resourceId: string) => readLatestState(s, resourceId),
    runs: (resourceId: string) => readRuns(s, resourceId),
    byRun: (runId: string) => readByRun(s, runId),
  })),
  ProcessStore.for((resourceId, s) => ({
    facts: (query?: RunResourceScopedFactQuery) =>
      readFacts(s, { resourceId, ...query }),
    stateHistory: (query?: RunResourceScopedStateHistoryQuery) =>
      readStateHistory(s, { resourceId, ...query }),
    latestState: () => readLatestState(s, resourceId),
    runs: () => readRuns(s, resourceId),
    byRun: (runId: string) =>
      readFacts(s, { resourceId, runId }),
  })),
);

export type RunResourceStore = typeof RunResourceStore.Identifier;

const readFacts = (
  s: ProcessStoreSpine,
  query: RunResourceFactQuery | undefined,
): Effect.Effect<RunResourceFact[], RuntimeStorageOperationalError> =>
  s
    .read(runtimeRecordQuery(factPredicates(query), factWindowOpts(query?.opts)))
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

