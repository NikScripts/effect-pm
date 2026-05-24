/**
 * Generic runtime fact and state persistence on {@link RuntimeStorage}.
 *
 * @remarks
 * Records `runtime.fact.recorded` and `runtime.state.changed` analytics events.
 * Domain modules publish through {@link RuntimeObserver}; apps compose
 * {@link ProcessStoreRuntime.layerRuntimeStorage} with other facet layers via
 * {@link ProcessStore.layerRuntimeStorage} or `layerProcessStore` from
 * `@nikscripts/effect-pm/storage/sqlite`.
 *
 * @module ProcessStoreRuntime
 */

import { Cause, Clock, Context, Effect, Layer, Option } from "effect";
import {
  applyQueryOpts,
  byTimestampDesc,
  makeProcessStoreSpine,
  makeRunId,
  runtimeFactStoreQuery,
  runtimeFactsFromEvents,
  runtimeStateChangesFromEvents,
} from "./internal/store/spine";
import type {
  AnalyticsEvent,
  ProcessStoreWriteError,
  QueryOpts,
  RuntimeFactQuery,
  RuntimeFactRecordedEvent,
  RuntimeStateChangedEvent,
  RuntimeStateHistoryQuery,
  StoreEventQuery,
} from "./ProcessStoreEvent";
import type {
  RuntimeFact,
  RuntimeRef,
  RuntimeStateBase,
  RuntimeStateChange,
} from "./RuntimeState";
import { RuntimeStorage } from "./RuntimeStorage";

const makeRuntimeFactRecordedEvent = (
  fact: RuntimeFact,
): RuntimeFactRecordedEvent => ({
  id: `runtime.fact/${fact.id}`,
  type: "runtime.fact.recorded",
  occurredAt: fact.occurredAt,
  entityType: fact.ref.kind,
  entityId: fact.ref.id,
  attributes: fact.attributes,
  fact,
});

const makeRuntimeStateChangedEvent = (
  change: RuntimeStateChange,
): RuntimeStateChangedEvent => ({
  id: `runtime.state/${change.id}`,
  type: "runtime.state.changed",
  occurredAt: change.changedAt,
  entityType: change.ref.kind,
  entityId: change.ref.id,
  change,
});

const stateChangedEventQuery = (ref: RuntimeRef): StoreEventQuery => ({
  entityType: ref.kind,
  entityId: ref.id,
  types: ["runtime.state.changed"],
});

const sortedStateChanges = (
  events: ReadonlyArray<AnalyticsEvent>,
  opts?: QueryOpts,
): RuntimeStateChange[] =>
  applyQueryOpts(
    runtimeStateChangesFromEvents(events).sort(
      byTimestampDesc((change) => change.changedAt),
    ),
    opts,
    (change) => change.changedAt,
  );

/**
 * Runtime observation write/read port backed by {@link RuntimeStorage}.
 *
 * @public
 */
export interface ProcessStoreRuntimeApi {
  readonly recordFact: (
    fact: RuntimeFact,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly recordStateChange: (
    change: RuntimeStateChange,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly recordFactBatch: (
    facts: ReadonlyArray<RuntimeFact>,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly recordStateChangeBatch: (
    changes: ReadonlyArray<RuntimeStateChange>,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly facts: (
    query?: RuntimeFactQuery,
  ) => Effect.Effect<RuntimeFact[], never>;
  readonly stateHistory: (
    query: RuntimeStateHistoryQuery,
  ) => Effect.Effect<RuntimeStateChange[], never>;
  readonly latestState: (
    ref: RuntimeRef,
  ) => Effect.Effect<Option.Option<RuntimeStateBase>, never>;
  readonly runResourceFacts: (
    resourceId: string,
    query?: Omit<RuntimeFactQuery, "ref">,
  ) => Effect.Effect<RuntimeFact[], never>;
}

/**
 * Log persistence failures without changing the caller success/error channel.
 *
 * @public
 */
export const persistRuntimeObservation = (
  effect: Effect.Effect<void, ProcessStoreWriteError>,
): Effect.Effect<void> =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("ProcessStoreRuntime write failed for runtime observation").pipe(
        Effect.annotateLogs("cause", Cause.pretty(cause)),
      ),
    ),
  );

/** @internal */
export const makeProcessStoreRuntime = (deps: {
  readonly append: (
    event: RuntimeFactRecordedEvent | RuntimeStateChangedEvent,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly appendBatch: (
    events: ReadonlyArray<RuntimeFactRecordedEvent | RuntimeStateChangedEvent>,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly events: (
    query?: StoreEventQuery,
  ) => Effect.Effect<ReadonlyArray<AnalyticsEvent>, never>;
}): ProcessStoreRuntimeApi => ({
  recordFact: (fact) => deps.append(makeRuntimeFactRecordedEvent(fact)),
  recordStateChange: (change) => deps.append(makeRuntimeStateChangedEvent(change)),
  recordFactBatch: (facts) =>
    deps.appendBatch(facts.map(makeRuntimeFactRecordedEvent)),
  recordStateChangeBatch: (changes) =>
    deps.appendBatch(changes.map(makeRuntimeStateChangedEvent)),
  facts: (query) =>
    deps.events(runtimeFactStoreQuery(query)).pipe(
      Effect.map((events) => runtimeFactsFromEvents(events, query)),
    ),
  runResourceFacts: (resourceId, query) =>
    deps.events(
      runtimeFactStoreQuery({
        ...query,
        ref: { kind: "run-resource", id: resourceId },
      }),
    ).pipe(
      Effect.map((events) =>
        runtimeFactsFromEvents(events, {
          ...query,
          ref: { kind: "run-resource", id: resourceId },
        }),
      ),
    ),
  stateHistory: (query) =>
    deps.events(stateChangedEventQuery(query.ref)).pipe(
      Effect.map((events) => sortedStateChanges(events, query.opts)),
    ),
  latestState: (ref) =>
    deps.events(stateChangedEventQuery(ref)).pipe(
      Effect.map((events) => {
        const latest = sortedStateChanges(events, { limit: 1 })[0];
        return latest === undefined ? Option.none() : Option.some(latest.current);
      }),
    ),
});

const makeProcessStoreRuntimeFromRuntimeStorage = Effect.all({
  storage: RuntimeStorage,
  now: Clock.currentTimeMillis,
}).pipe(
  Effect.map(({ storage, now }) => {
    const spine = makeProcessStoreSpine(storage, makeRunId(now));
    return makeProcessStoreRuntime({
      append: spine.append,
      appendBatch: spine.appendBatch,
      events: spine.events,
    });
  }),
);

/**
 * Context tag for {@link ProcessStoreRuntimeApi}.
 *
 * @public
 */
export class ProcessStoreRuntime extends Context.Service<
  ProcessStoreRuntime,
  ProcessStoreRuntimeApi
>()("@nikscripts/effect-pm/ProcessStoreRuntime", {
  make: makeProcessStoreRuntimeFromRuntimeStorage,
}) {}

export namespace ProcessStoreRuntime {
  /**
   * `Layer` that provides {@link ProcessStoreRuntime} from injected {@link RuntimeStorage}.
   *
   * @public
   */
  export const layerRuntimeStorage: Layer.Layer<ProcessStoreRuntime, never, RuntimeStorage> =
    Layer.effect(ProcessStoreRuntime, makeProcessStoreRuntimeFromRuntimeStorage);

  /**
   * `Layer` backed by in-memory {@link RuntimeStorage}.
   *
   * @public
   */
  export const layer: Layer.Layer<ProcessStoreRuntime, never, never> = Layer.provide(
    layerRuntimeStorage,
    RuntimeStorage.layer,
  );
}
