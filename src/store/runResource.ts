/**
 * `RunResource` storage facet — durable + queryable history of gated runs.
 *
 * @remarks
 * Per-domain facet for {@link RunResource} (the concurrency gate in
 * `src/RunResource.ts`). Owns its event types
 * (`run-resource.fact.recorded` / `run-resource.state.changed`), its
 * `RunResource`-shaped fact / state / query types, and a `runs()`
 * projection that pairs `started` facts with their matching
 * `completed` / `failed` fact for operator-friendly run history.
 *
 * **No shared generic vocabulary.** This facet does **not** use the
 * removed `RuntimeFact` / `RuntimeRef` / `RuntimeStateChange` envelope.
 * Each per-domain facet (queue, process, schedule, …) owns its own
 * concrete types — see `docs/STORAGE.md`.
 *
 * ## Storage shape
 *
 * Two record types share `processType: "run-resource"` and
 * `processId: <resourceId>`:
 *
 * - `run-resource.fact.recorded` — `payload = { fact: <fact-as-json> }`.
 * - `run-resource.state.changed` — `payload = { change: <change-as-json> }`.
 *
 * The `runId` and fact subtype (`run-resource.run.started` / `.completed`
 * / `.failed`) live inside the payload, not on indexed columns; queries
 * by `runId` and inner type post-filter the decoded facts.
 *
 * ## Emit (optional)
 *
 * `RunResource.make` calls the **static** shortcuts on this class
 * (`ProcessStoreRunResource.recordRunStarted`, `.recordRunCompleted`,
 * `.recordRunFailed`, `.recordStateChange`). When the facet layer is not
 * composed each call is a silent no-op; when composed it writes through
 * the spine.
 *
 * ## Compose
 *
 * - `ProcessStoreRunResource.layerRuntimeStorage` — facet on top of
 *   injected {@link RuntimeStorage}.
 * - `ProcessStoreRunResource.layer` — facet + in-memory `RuntimeStorage`
 *   (dev/test only).
 *
 * ## Query (after compose)
 *
 * ```ts
 * const runs = yield* ProcessStoreRunResource;
 * yield* runs.facts({ resourceId: "@app/Gate" });
 * yield* runs.stateHistory({ resourceId: "@app/Gate" });
 * yield* runs.runs("@app/Gate");          // paired started+ended history
 * yield* runs.byRun(`@app/Gate/run/3`);   // facts for one specific run
 * yield* runs.latestState("@app/Gate");
 * ```
 *
 * @module store/RunResource
 */

import { DateTime, Effect, Option } from "effect";
import {
  applyQueryOpts,
  byTimestampDesc,
  isFiniteNumber,
  isRecord,
  isString,
  recordAttributesObject,
  runtimeRecordQuery,
  toJsonValue,
} from "../internal/store/helpers";
import { ProcessStore } from "../ProcessStore";
import type { JsonValue, QueryOpts } from "../ProcessStoreEvent";
import { ProcessId, Type } from "../Query";
import type { RuntimeRecord } from "../RuntimeStorage";

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
  | "run-resource.run.started"
  | "run-resource.run.completed"
  | "run-resource.run.failed";

/**
 * Reasons attached to {@link RunResourceState} transitions.
 *
 * @public
 */
export type RunResourceStateChangeReason =
  | "run-resource.run.waiting"
  | "run-resource.run.started"
  | "run-resource.run.completed"
  | "run-resource.run.failed"
  | "run-resource.run.interrupted"
  | "run-resource.run.wait.interrupted";

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
  readonly type: "run-resource.run.started";
  readonly occurredAt: number;
  readonly payload: RunResourceRunStartedPayload;
  readonly attributes?: Record<string, unknown>;
}

/** @public */
export interface RunResourceRunCompletedFact {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly type: "run-resource.run.completed";
  readonly occurredAt: number;
  readonly payload: RunResourceRunCompletedPayload;
  readonly attributes?: Record<string, unknown>;
}

/** @public */
export interface RunResourceRunFailedFact {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly type: "run-resource.run.failed";
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
 * Filter for {@link ProcessStoreRunResource.facts} queries.
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
 * Filter for {@link ProcessStoreRunResource.stateHistory} queries.
 *
 * @public
 */
export interface RunResourceStateHistoryQuery {
  readonly resourceId: string;
  readonly opts?: QueryOpts;
}

/**
 * Paired run record produced by {@link ProcessStoreRunResource.runs} —
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

const RUN_RESOURCE_TYPE = "run-resource";
const FACT_RECORDED_TYPE = "run-resource.fact.recorded";
const STATE_CHANGED_TYPE = "run-resource.state.changed";

const RUN_RESOURCE_FACT_TYPES: ReadonlyArray<RunResourceFactType> = [
  "run-resource.run.started",
  "run-resource.run.completed",
  "run-resource.run.failed",
];

const isRunResourceFactType = (
  value: unknown,
): value is RunResourceFactType =>
  isString(value) && RUN_RESOURCE_FACT_TYPES.some((type) => type === value);

const RUN_RESOURCE_STATE_CHANGE_REASONS: ReadonlyArray<
  RunResourceStateChangeReason
> = [
  "run-resource.run.waiting",
  "run-resource.run.started",
  "run-resource.run.completed",
  "run-resource.run.failed",
  "run-resource.run.interrupted",
  "run-resource.run.wait.interrupted",
];

const isStateChangeReason = (
  value: unknown,
): value is RunResourceStateChangeReason =>
  isString(value) &&
  RUN_RESOURCE_STATE_CHANGE_REASONS.some((reason) => reason === value);

const factPayloadAsJson = (fact: RunResourceFact): JsonValue => {
  switch (fact.type) {
    case "run-resource.run.started":
      return { concurrency: fact.payload.concurrency };
    case "run-resource.run.completed":
      return { durationMs: fact.payload.durationMs };
    case "run-resource.run.failed":
      return {
        durationMs: fact.payload.durationMs,
        cause: fact.payload.cause,
      };
  }
};

const factAsJson = (fact: RunResourceFact): JsonValue => ({
  id: fact.id,
  resourceId: fact.resourceId,
  runId: fact.runId,
  type: fact.type,
  occurredAt: fact.occurredAt,
  payload: factPayloadAsJson(fact),
  ...(fact.attributes !== undefined
    ? { attributes: toJsonValue(fact.attributes) }
    : {}),
});

const stateAsJson = (state: RunResourceState): JsonValue => ({
  resourceId: state.resourceId,
  observedAt: state.observedAt,
  configVersion: state.configVersion,
  concurrency: state.concurrency,
  waiting: state.waiting,
  inFlight: state.inFlight,
  completed: state.completed,
  failed: state.failed,
  interrupted: state.interrupted,
  totalDurationMs: state.totalDurationMs,
});

const stateChangeAsJson = (change: RunResourceStateChange): JsonValue => ({
  id: change.id,
  resourceId: change.resourceId,
  changedAt: change.changedAt,
  reason: change.reason,
  previous: change.previous === null ? null : stateAsJson(change.previous),
  current: stateAsJson(change.current),
});

const makeFactRecord = (
  fact: RunResourceFact,
): Omit<RuntimeRecord, "runId" | "createdAt"> => ({
  id: `run-resource.fact/${fact.id}`,
  type: FACT_RECORDED_TYPE,
  occurredAt: DateTime.makeUnsafe(fact.occurredAt),
  processType: RUN_RESOURCE_TYPE,
  processId: fact.resourceId,
  payload: { fact: factAsJson(fact) },
});

const makeStateChangeRecord = (
  change: RunResourceStateChange,
): Omit<RuntimeRecord, "runId" | "createdAt"> => ({
  id: `run-resource.state/${change.id}`,
  type: STATE_CHANGED_TYPE,
  occurredAt: DateTime.makeUnsafe(change.changedAt),
  processType: RUN_RESOURCE_TYPE,
  processId: change.resourceId,
  payload: { change: stateChangeAsJson(change) },
});

// ============================================================================
// Decoders
// ============================================================================

const decodeFactValue = (value: unknown): RunResourceFact | null => {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const resourceId = value["resourceId"];
  const runId = value["runId"];
  const type = value["type"];
  const occurredAt = value["occurredAt"];
  const payload = value["payload"];
  if (
    !isString(id) ||
    !isString(resourceId) ||
    !isString(runId) ||
    !isRunResourceFactType(type) ||
    !isFiniteNumber(occurredAt) ||
    !isRecord(payload)
  ) {
    return null;
  }
  const attributes = recordAttributesObject(value["attributes"]);
  switch (type) {
    case "run-resource.run.started": {
      const concurrency = payload["concurrency"];
      if (!isFiniteNumber(concurrency)) return null;
      return {
        id,
        resourceId,
        runId,
        type,
        occurredAt,
        payload: { concurrency },
        ...(attributes === undefined ? {} : { attributes }),
      };
    }
    case "run-resource.run.completed": {
      const durationMs = payload["durationMs"];
      if (!isFiniteNumber(durationMs)) return null;
      return {
        id,
        resourceId,
        runId,
        type,
        occurredAt,
        payload: { durationMs },
        ...(attributes === undefined ? {} : { attributes }),
      };
    }
    case "run-resource.run.failed": {
      const durationMs = payload["durationMs"];
      const cause = payload["cause"];
      if (!isFiniteNumber(durationMs) || !isString(cause)) return null;
      return {
        id,
        resourceId,
        runId,
        type,
        occurredAt,
        payload: { durationMs, cause },
        ...(attributes === undefined ? {} : { attributes }),
      };
    }
  }
};

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

const decodeStateChangeValue = (
  value: unknown,
): RunResourceStateChange | null => {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const resourceId = value["resourceId"];
  const changedAt = value["changedAt"];
  const reason = value["reason"];
  const previousRaw = value["previous"];
  const previous = previousRaw === null ? null : decodeStateValue(previousRaw);
  const current = decodeStateValue(value["current"]);
  if (
    !isString(id) ||
    !isString(resourceId) ||
    !isFiniteNumber(changedAt) ||
    !isStateChangeReason(reason) ||
    (previousRaw !== null && previous === null) ||
    current === null
  ) {
    return null;
  }
  return { id, resourceId, changedAt, reason, previous, current };
};

const recordToFact = (record: RuntimeRecord): RunResourceFact | null => {
  if (record.type !== FACT_RECORDED_TYPE) return null;
  if (record.processType !== RUN_RESOURCE_TYPE) return null;
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  return decodeFactValue(payload["fact"]);
};

const recordToStateChange = (
  record: RuntimeRecord,
): RunResourceStateChange | null => {
  if (record.type !== STATE_CHANGED_TYPE) return null;
  if (record.processType !== RUN_RESOURCE_TYPE) return null;
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  return decodeStateChangeValue(payload["change"]);
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
    if (fact.type === "run-resource.run.started") {
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
      ended.type === "run-resource.run.completed" ? "completed" : "failed";
    runs.push({
      runId,
      resourceId: started.resourceId,
      startedAt: started.occurredAt,
      endedAt: ended.occurredAt,
      durationMs: ended.payload.durationMs,
      outcome,
      ...(ended.type === "run-resource.run.failed"
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
    Type.equals(FACT_RECORDED_TYPE),
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
    Type.equals(STATE_CHANGED_TYPE),
  ];
  if (resourceId !== undefined) {
    preds.push(ProcessId.equals(resourceId));
  }
  return preds;
};

// Drop opts.limit when the storage query is a superset of the post-filter
// (e.g. when post-filtering by `runId` or fact subtype). Mirrors the legacy
// `runResourceFactsFromEvents` behavior where the limit applied to the
// already-narrowed fact list rather than the broader event stream.
const factWindowOpts = (
  opts: QueryOpts | undefined,
): QueryOpts | undefined => {
  if (opts === undefined) return undefined;
  const out: { -readonly [K in keyof QueryOpts]: QueryOpts[K] } = {};
  if (opts.before !== undefined) out.before = opts.before;
  if (opts.after !== undefined) out.after = opts.after;
  return out;
};

// ============================================================================
// Facet
// ============================================================================

/**
 * `RunResource` storage facet (see module doc).
 *
 * Instance methods (resolved via `yield* ProcessStoreRunResource`) return
 * the raw spine error channel (`ProcessStoreWriteError`) so user-provided
 * mocks supplied via `Effect.provideService` / `Layer.succeed` can exercise
 * failure paths directly. The static optional emitters on the class
 * (`ProcessStoreRunResource.recordRunStarted` etc.) wrap each call with a
 * built-in `catchCause + logWarning` so observation can never change the
 * success/error channel of a gated effect.
 *
 * @public
 */
export class ProcessStoreRunResource extends ProcessStore.Service<
  ProcessStoreRunResource
>()(
  "@nikscripts/effect-pm/store/runResource/ProcessStoreRunResource",
  ProcessStore.record({
    recordRunStarted: (s) => (fact: RunResourceRunStartedFact) =>
      s.create(makeFactRecord(fact)),
    recordRunCompleted: (s) => (fact: RunResourceRunCompletedFact) =>
      s.create(makeFactRecord(fact)),
    recordRunFailed: (s) => (fact: RunResourceRunFailedFact) =>
      s.create(makeFactRecord(fact)),
    recordStateChange: (s) => (change: RunResourceStateChange) =>
      s.create(makeStateChangeRecord(change)),
    recordFactBatch: (s) => (facts: ReadonlyArray<RunResourceFact>) =>
      s.createBatch(facts.map(makeFactRecord)),
    recordStateChangeBatch:
      (s) => (changes: ReadonlyArray<RunResourceStateChange>) =>
        s.createBatch(changes.map(makeStateChangeRecord)),
  }),
  ProcessStore.read((s) => ({
    facts: (query?: RunResourceFactQuery) =>
      s
        .read(runtimeRecordQuery(factPredicates(query), factWindowOpts(query?.opts)))
        .pipe(Effect.map((records) => factsFromRecords(records, query))),
    stateHistory: (query?: RunResourceStateHistoryQuery) =>
      s
        .read(runtimeRecordQuery(stateChangedPredicates(query?.resourceId), undefined))
        .pipe(
          Effect.map((records) =>
            sortedStateChanges(
              stateChangesFromRecords(records, query?.resourceId),
              query?.opts,
            ),
          ),
        ),
    latestState: (resourceId: string) =>
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
        ),
    runs: (resourceId: string) =>
      s
        .read(runtimeRecordQuery(factPredicates({ resourceId }), undefined))
        .pipe(
          Effect.map((records) =>
            pairRuns(factsFromRecords(records, { resourceId })),
          ),
        ),
    byRun: (runId: string) =>
      s
        .read(runtimeRecordQuery(factPredicates(undefined), undefined))
        .pipe(
          Effect.map((records) => factsFromRecords(records, { runId })),
        ),
  })),
) {}

/**
 * Type accessors merged onto {@link ProcessStoreRunResource} via declaration
 * merging:
 *
 * - `ProcessStoreRunResource.Type` — full service shape (record + read).
 * - `ProcessStoreRunResource.EmitType` — record-section emit shape only.
 *
 * Use these to type custom mocks supplied through `Layer.succeed` /
 * `Effect.provideService` (the recommended way to fan-out to in-process
 * listeners until the future `live()` stream lands):
 *
 * ```ts
 * const mock: ProcessStoreRunResource.Type = { ... };
 * ```
 *
 * @public
 */
export declare namespace ProcessStoreRunResource {
  export type Type = ProcessStore.Service.Type<
    typeof ProcessStoreRunResource
  >;
  export type EmitType = ProcessStore.Service.EmitType<
    typeof ProcessStoreRunResource
  >;
}
