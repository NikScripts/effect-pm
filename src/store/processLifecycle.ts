/**
 * Process supervisor lifecycle persistence on {@link RuntimeStorage}.
 *
 * @remarks
 * Records `process.lifecycle.changed` events from {@link ProcessGroup} controls
 * (`Started`, `Stopped`, `Restarted`, …). Apps compose
 * {@link ProcessStoreProcessLifecycle.layerRuntimeStorage} via
 * {@link ProcessStore.layerRuntimeStorage} or `layerProcessStore` from
 * `@nikscripts/effect-pm/storage/sqlite`.
 *
 * @module store/ProcessLifecycle
 */

import { Cause, Clock, Context, Effect, Layer } from "effect";
import {
  applyQueryOpts,
  byTimestampDesc,
  isProcessLifecycleChanged,
  makeProcessStoreSpine,
  makeRunId,
  processLifecycleFromEvents,
  processLifecycleStoreQuery,
} from "../internal/store/spine";
import type {
  AnalyticsEvent,
  JsonValue,
  ProcessLifecycleChangedEvent,
  ProcessLifecycleTag,
  ProcessStoreWriteError,
  QueryOpts,
  StoreEventQuery,
} from "../ProcessStoreEvent";
import { RuntimeStorage } from "../RuntimeStorage";

/**
 * Write input for a process lifecycle transition.
 *
 * @public
 */
export interface ProcessLifecycleRecordInput {
  readonly processId: string;
  readonly tag: ProcessLifecycleTag;
  readonly error?: string;
  /** Optional group id stored on `attributes.groupId` for {@link ProcessStoreProcessLifecycleApi.lifecycleByGroup}. */
  readonly groupId?: string;
  /** Epoch millis; defaults to {@link Clock.currentTimeMillis}. */
  readonly occurredAt?: number;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

/**
 * Process lifecycle write/read port backed by {@link RuntimeStorage}.
 *
 * @public
 */
export interface ProcessStoreProcessLifecycleApi {
  readonly lifecycleChanged: (
    input: ProcessLifecycleRecordInput,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly lifecycle: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ProcessLifecycleChangedEvent[]>;
  readonly lifecycleForProcesses: (
    processIds: ReadonlyArray<string>,
    opts?: QueryOpts,
  ) => Effect.Effect<ProcessLifecycleChangedEvent[]>;
  readonly lifecycleByGroup: (
    groupId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ProcessLifecycleChangedEvent[]>;
  readonly latestLifecycleByProcess: (
    processIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, ProcessLifecycleTag>>;
}

/**
 * Log lifecycle persistence failures without failing group controls.
 *
 * @public
 */
export const persistProcessLifecycle = (
  effect: Effect.Effect<void, ProcessStoreWriteError>,
): Effect.Effect<void> =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("ProcessStoreProcessLifecycle write failed for process lifecycle").pipe(
        Effect.annotateLogs("cause", Cause.pretty(cause)),
      ),
    ),
  );

let processLifecycleSeq = 0;

const lifecycleEventAttributes = (
  input: ProcessLifecycleRecordInput,
): Record<string, unknown> | undefined => {
  const merged: Record<string, unknown> = {
    ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
    ...(input.attributes ?? {}),
  };
  return Object.keys(merged).length === 0 ? undefined : merged;
};

const makeProcessLifecycleChangedEvent = (
  input: ProcessLifecycleRecordInput,
  occurredAtMs: number,
): ProcessLifecycleChangedEvent => {
  processLifecycleSeq++;
  const attributes = lifecycleEventAttributes(input);
  return {
    id: `${input.processId}-lifecycle-${input.tag.toLowerCase()}-${String(processLifecycleSeq)}`,
    type: "process.lifecycle.changed",
    occurredAt: occurredAtMs,
    entityType: "process",
    entityId: input.processId,
    ...(attributes !== undefined ? { attributes } : {}),
    lifecycle: {
      tag: input.tag,
      ...(input.error !== undefined ? { error: input.error } : {}),
    },
  };
};

const lifecycleEventsForProcesses = (
  events: ReadonlyArray<AnalyticsEvent>,
  processIds: ReadonlyArray<string>,
  opts?: QueryOpts,
): ProcessLifecycleChangedEvent[] => {
  const allowed = new Set(processIds);
  const rows = events
    .filter(
      (event): event is ProcessLifecycleChangedEvent =>
        isProcessLifecycleChanged(event) && allowed.has(event.entityId),
    )
    .sort(byTimestampDesc((event) => event.occurredAt));
  return applyQueryOpts(rows, opts, (event) => event.occurredAt);
};

const lifecycleEventsForGroup = (
  events: ReadonlyArray<AnalyticsEvent>,
  groupId: string,
  opts?: QueryOpts,
): ProcessLifecycleChangedEvent[] => {
  const rows = events
    .filter((event): event is ProcessLifecycleChangedEvent => {
      if (!isProcessLifecycleChanged(event)) {
        return false;
      }
      const attributes = event.attributes;
      return attributes !== undefined && attributes["groupId"] === groupId;
    })
    .sort(byTimestampDesc((event) => event.occurredAt));
  return applyQueryOpts(rows, opts, (event) => event.occurredAt);
};

/** @internal */
export const makeProcessStoreProcessLifecycle = (deps: {
  readonly append: (
    event: ProcessLifecycleChangedEvent,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly events: (
    query?: StoreEventQuery,
  ) => Effect.Effect<ReadonlyArray<AnalyticsEvent>, never>;
}): ProcessStoreProcessLifecycleApi => ({
  lifecycleChanged: (input) =>
    Effect.gen(function* () {
      const occurredAtMs = input.occurredAt ?? (yield* Clock.currentTimeMillis);
      yield* deps.append(makeProcessLifecycleChangedEvent(input, occurredAtMs));
    }),
  lifecycle: (processId, opts) =>
    deps.events(processLifecycleStoreQuery(processId, opts)).pipe(
      Effect.map((events) => processLifecycleFromEvents(events, processId, opts)),
    ),
  lifecycleForProcesses: (processIds, opts) =>
    deps.events({
      entityType: "process",
      types: ["process.lifecycle.changed"],
      opts,
    }).pipe(
      Effect.map((events) => lifecycleEventsForProcesses(events, processIds, opts)),
    ),
  lifecycleByGroup: (groupId, opts) =>
    deps.events({
      entityType: "process",
      types: ["process.lifecycle.changed"],
      opts,
    }).pipe(
      Effect.map((events) => lifecycleEventsForGroup(events, groupId, opts)),
    ),
  latestLifecycleByProcess: (processIds) =>
    Effect.gen(function* () {
      const latest = new Map<string, ProcessLifecycleTag>();
      for (const processId of processIds) {
        const rows = yield* deps.events(processLifecycleStoreQuery(processId));
        const event = processLifecycleFromEvents(rows, processId, { limit: 1 })[0];
        if (event !== undefined) {
          latest.set(processId, event.lifecycle.tag);
        }
      }
      return latest;
    }),
});

const makeProcessStoreProcessLifecycleFromRuntimeStorage = Effect.gen(function* () {
  const storage = yield* RuntimeStorage;
  const now = yield* Clock.currentTimeMillis;
  const spine = makeProcessStoreSpine(storage, makeRunId(now));
  return makeProcessStoreProcessLifecycle({
    append: spine.append,
    events: spine.events,
  });
});

/**
 * Context tag for {@link ProcessStoreProcessLifecycleApi}.
 *
 * @public
 */
export class ProcessStoreProcessLifecycle extends Context.Service<
  ProcessStoreProcessLifecycle,
  ProcessStoreProcessLifecycleApi
>()("@nikscripts/effect-pm/store/processLifecycle/ProcessStoreProcessLifecycle", {
  make: makeProcessStoreProcessLifecycleFromRuntimeStorage,
}) {}

export namespace ProcessStoreProcessLifecycle {
  /**
   * `Layer` that provides {@link ProcessStoreProcessLifecycle} from injected {@link RuntimeStorage}.
   *
   * @public
   */
  export const layerRuntimeStorage: Layer.Layer<
    ProcessStoreProcessLifecycle,
    never,
    RuntimeStorage
  > = Layer.effect(ProcessStoreProcessLifecycle, makeProcessStoreProcessLifecycleFromRuntimeStorage);

  /**
   * `Layer` backed by in-memory {@link RuntimeStorage}.
   *
   * @public
   */
  export const layer: Layer.Layer<ProcessStoreProcessLifecycle, never, never> = Layer.provide(
    layerRuntimeStorage,
    RuntimeStorage.layer,
  );
}
