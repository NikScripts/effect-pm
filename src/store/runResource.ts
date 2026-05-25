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
 * ## Emit (optional)
 *
 * `RunResource.make` calls the **static** shortcuts on this class
 * (`ProcessStoreRunResource.recordRunStarted`, `.recordRunCompleted`,
 * `.recordRunFailed`, `.recordStateChange`). When the facet layer is not
 * composed each call is a silent no-op; when composed it writes through
 * the spine. The builder wraps every static emitter with a built-in
 * `catchCause + Effect.logWarning` so storage failures never propagate
 * into the gated effect's success/error channel.
 *
 * ## Compose
 *
 * - `ProcessStoreRunResource.layerRuntimeStorage` — facet on top of
 *   injected {@link RuntimeStorage}.
 * - `ProcessStoreRunResource.layer` — facet + in-memory `RuntimeStorage`
 *   (dev/test only).
 * - Composed by `ProcessStorage.layerRuntimeStorage` and `layerProcessStore`
 *   from `@nikscripts/effect-pm/storage/sqlite`.
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

import { Effect, Option } from "effect";
import {
  applyQueryOpts,
  byTimestampDesc,
  runResourceFactsFromEvents,
  runResourceFactStoreQuery,
  runResourceStateChangedEventQuery,
  runResourceStateChangesFromEvents,
} from "../internal/store/spine";
import { ProcessStore } from "../ProcessStore";
import type {
  QueryOpts,
  RunResourceFactRecordedEvent,
  RunResourceStateChangedEvent,
} from "../ProcessStoreEvent";

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
// Event encoders (fact → wire event)
// ============================================================================

const makeRunResourceFactRecordedEvent = (
  fact: RunResourceFact,
): RunResourceFactRecordedEvent => ({
  id: `run-resource.fact/${fact.id}`,
  type: "run-resource.fact.recorded",
  occurredAt: fact.occurredAt,
  entityType: "run-resource",
  entityId: fact.resourceId,
  attributes: fact.attributes,
  fact,
});

const makeRunResourceStateChangedEvent = (
  change: RunResourceStateChange,
): RunResourceStateChangedEvent => ({
  id: `run-resource.state/${change.id}`,
  type: "run-resource.state.changed",
  occurredAt: change.changedAt,
  entityType: "run-resource",
  entityId: change.resourceId,
  change,
});

// ============================================================================
// Read helpers
// ============================================================================

const pairRuns = (
  facts: ReadonlyArray<RunResourceFact>,
): RunResourceRun[] => {
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

const sortedStateChanges = (
  changes: ReadonlyArray<RunResourceStateChange>,
  opts?: QueryOpts,
): RunResourceStateChange[] =>
  applyQueryOpts(
    [...changes].sort(byTimestampDesc((change) => change.changedAt, (c) => c.id)),
    opts,
    (change) => change.changedAt,
  );

// ============================================================================
// Facet class
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
  ProcessStore.record((s) => ({
    recordRunStarted: (fact: RunResourceRunStartedFact) =>
      s.append(makeRunResourceFactRecordedEvent(fact)),
    recordRunCompleted: (fact: RunResourceRunCompletedFact) =>
      s.append(makeRunResourceFactRecordedEvent(fact)),
    recordRunFailed: (fact: RunResourceRunFailedFact) =>
      s.append(makeRunResourceFactRecordedEvent(fact)),
    recordStateChange: (change: RunResourceStateChange) =>
      s.append(makeRunResourceStateChangedEvent(change)),
    recordFactBatch: (facts: ReadonlyArray<RunResourceFact>) =>
      s.appendBatch(facts.map(makeRunResourceFactRecordedEvent)),
    recordStateChangeBatch: (
      changes: ReadonlyArray<RunResourceStateChange>,
    ) => s.appendBatch(changes.map(makeRunResourceStateChangedEvent)),
  })),
  ProcessStore.read((s) => ({
    facts: (query?: RunResourceFactQuery) =>
      s.events(runResourceFactStoreQuery(query)).pipe(
        Effect.map((events) => runResourceFactsFromEvents(events, query)),
      ),
    stateHistory: (query?: RunResourceStateHistoryQuery) =>
      s.events(runResourceStateChangedEventQuery(query?.resourceId)).pipe(
        Effect.map((events) =>
          sortedStateChanges(
            runResourceStateChangesFromEvents(events, query?.resourceId),
            query?.opts,
          ),
        ),
      ),
    latestState: (resourceId: string) =>
      s.events(runResourceStateChangedEventQuery(resourceId)).pipe(
        Effect.map((events) => {
          const latest = sortedStateChanges(
            runResourceStateChangesFromEvents(events, resourceId),
            { limit: 1 },
          )[0];
          return latest === undefined
            ? Option.none<RunResourceState>()
            : Option.some(latest.current);
        }),
      ),
    runs: (resourceId: string) =>
      s.events(runResourceFactStoreQuery({ resourceId })).pipe(
        Effect.map((events) =>
          pairRuns(runResourceFactsFromEvents(events, { resourceId })),
        ),
      ),
    byRun: (runId: string) =>
      s.events(runResourceFactStoreQuery({ runId })).pipe(
        Effect.map((events) =>
          runResourceFactsFromEvents(events, { runId }),
        ),
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
