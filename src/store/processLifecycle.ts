/**
 * Process lifecycle storage facet — `process.lifecycle.changed` by process id.
 *
 * @remarks
 * Process-scoped analytics: {@link Process.spawn}, supervisors, and any writer
 * that records lifecycle without a group. For group control paths
 * (`start` / `stop` / `restart` with a `groupId`), use
 * {@link ProcessStoreProcessGroup} instead — it stamps `attributes.groupId`
 * and exposes group-scoped queries.
 *
 * Compose via {@link ProcessStoreProcessLifecycle.layerRuntimeStorage} or
 * {@link ProcessStorage.layerRuntimeStorage}.
 *
 * @module store/ProcessLifecycle
 */

import { Clock, Effect } from "effect";
import {
  applyQueryOpts,
  byTimestampDesc,
  isProcessLifecycleChanged,
  processLifecycleFromEvents,
  processLifecycleStoreQuery,
} from "../internal/store/spine";
import { ProcessStore } from "../ProcessStore";
import type {
  AnalyticsEvent,
  JsonValue,
  ProcessLifecycleChangedEvent,
  ProcessLifecycleTag,
  QueryOpts,
} from "../ProcessStoreEvent";

/**
 * Write input for a process lifecycle transition (no group scope).
 *
 * @public
 */
export interface ProcessLifecycleRecordInput {
  readonly processId: string;
  readonly tag: ProcessLifecycleTag;
  readonly error?: string;
  /** Epoch millis; defaults to {@link Clock.currentTimeMillis}. */
  readonly occurredAt?: number;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

let processLifecycleSeq = 0;

const lifecycleEventAttributes = (
  input: ProcessLifecycleRecordInput & { readonly groupId?: string },
): Record<string, unknown> | undefined => {
  const merged: Record<string, unknown> = {
    ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
    ...(input.attributes ?? {}),
  };
  return Object.keys(merged).length === 0 ? undefined : merged;
};

/**
 * Builds a `process.lifecycle.changed` wire event.
 *
 * @internal Shared with {@link ProcessStoreProcessGroup} member writes.
 */
export const makeProcessLifecycleChangedEvent = (
  input: ProcessLifecycleRecordInput & { readonly groupId?: string },
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

/**
 * Process lifecycle storage facet (see module doc).
 *
 * @public
 */
export class ProcessStoreProcessLifecycle extends ProcessStore.Service<
  ProcessStoreProcessLifecycle
>()(
  "@nikscripts/effect-pm/store/processLifecycle/ProcessStoreProcessLifecycle",
  ProcessStore.record((s) => ({
    lifecycleChanged: (input: ProcessLifecycleRecordInput) =>
      Effect.gen(function* () {
        const occurredAtMs = input.occurredAt ?? (yield* Clock.currentTimeMillis);
        yield* s.append(makeProcessLifecycleChangedEvent(input, occurredAtMs));
      }),
  })),
  ProcessStore.read((s) => ({
    lifecycle: (processId: string, opts?: QueryOpts) =>
      s.events(processLifecycleStoreQuery(processId, opts)).pipe(
        Effect.map((events) => processLifecycleFromEvents(events, processId, opts)),
      ),
    lifecycleForProcesses: (processIds: ReadonlyArray<string>, opts?: QueryOpts) =>
      s.events({
        entityType: "process",
        types: ["process.lifecycle.changed"],
        opts,
      }).pipe(
        Effect.map((events) => lifecycleEventsForProcesses(events, processIds, opts)),
      ),
    latestLifecycleByProcess: (processIds: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const latest = new Map<string, ProcessLifecycleTag>();
        for (const processId of processIds) {
          const rows = yield* s.events(processLifecycleStoreQuery(processId));
          const event = processLifecycleFromEvents(rows, processId, { limit: 1 })[0];
          if (event !== undefined) {
            latest.set(processId, event.lifecycle.tag);
          }
        }
        return latest;
      }),
  })),
) {}

/**
 * @public
 */
export declare namespace ProcessStoreProcessLifecycle {
  export type Type = ProcessStore.Service.Type<
    typeof ProcessStoreProcessLifecycle
  >;
  export type EmitType = ProcessStore.Service.EmitType<
    typeof ProcessStoreProcessLifecycle
  >;
}
