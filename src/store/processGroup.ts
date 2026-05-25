/**
 * `ProcessGroup` storage facet — group-scoped lifecycle and queries.
 *
 * @remarks
 * Group control paths ({@link ProcessGroup} `start` / `stop` / `restart`) call
 * the **static** emitters on this class so every row carries
 * `attributes.groupId`. Writes delegate to the same wire type as
 * {@link ProcessStoreProcessLifecycle} (`process.lifecycle.changed`).
 *
 * Process-scoped lifecycle without a group (future {@link Process.spawn},
 * supervisors) uses {@link ProcessStoreProcessLifecycle} directly.
 *
 * Compose {@link ProcessStoreProcessGroup.layerRuntimeStorage} together with
 * {@link ProcessStoreProcessLifecycle.layerRuntimeStorage} (this layer
 * requires the lifecycle facet). {@link ProcessStore.layerRuntimeStorage}
 * merges both.
 *
 * @module store/ProcessGroup
 */

import { Clock, Effect } from "effect";
import {
  applyQueryOpts,
  byTimestampDesc,
  isProcessLifecycleChanged,
} from "../internal/store/spine";
import { ProcessStoreBuilder } from "../ProcessStoreBuilder";
import type {
  AnalyticsEvent,
  JsonValue,
  ProcessLifecycleChangedEvent,
  ProcessLifecycleTag,
  QueryOpts,
} from "../ProcessStoreEvent";
import {
  makeProcessLifecycleChangedEvent,
  type ProcessLifecycleRecordInput,
} from "./processLifecycle";

/**
 * Member lifecycle write input (group id is passed separately).
 *
 * @public
 */
export interface ProcessGroupMemberLifecycleInput {
  readonly processId: string;
  readonly tag: ProcessLifecycleTag;
  readonly error?: string;
  readonly occurredAt?: number;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

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

const memberLifecycleInput = (
  groupId: string,
  input: ProcessGroupMemberLifecycleInput,
): ProcessLifecycleRecordInput & { readonly groupId: string } => ({
  processId: input.processId,
  tag: input.tag,
  ...(input.error !== undefined ? { error: input.error } : {}),
  ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
  ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
  groupId,
});

/**
 * `ProcessGroup` storage facet (see module doc).
 *
 * @public
 */
export class ProcessStoreProcessGroup extends ProcessStoreBuilder.Service<
  ProcessStoreProcessGroup
>()(
  "@nikscripts/effect-pm/store/processGroup/ProcessStoreProcessGroup",
  ProcessStoreBuilder.record((s) => ({
    recordMemberLifecycle: (
      groupId: string,
      input: ProcessGroupMemberLifecycleInput,
    ) =>
      Effect.gen(function* () {
        const occurredAtMs = input.occurredAt ?? (yield* Clock.currentTimeMillis);
        yield* s.append(
          makeProcessLifecycleChangedEvent(memberLifecycleInput(groupId, input), occurredAtMs),
        );
      }),
    recordMemberStarted: (groupId: string, processId: string) =>
      Effect.gen(function* () {
        const occurredAtMs = yield* Clock.currentTimeMillis;
        yield* s.append(
          makeProcessLifecycleChangedEvent(
            { processId, tag: "Started", groupId },
            occurredAtMs,
          ),
        );
      }),
    recordMemberStopped: (groupId: string, processId: string) =>
      Effect.gen(function* () {
        const occurredAtMs = yield* Clock.currentTimeMillis;
        yield* s.append(
          makeProcessLifecycleChangedEvent(
            { processId, tag: "Stopped", groupId },
            occurredAtMs,
          ),
        );
      }),
    recordMemberRestarted: (groupId: string, processId: string) =>
      Effect.gen(function* () {
        const occurredAtMs = yield* Clock.currentTimeMillis;
        yield* s.append(
          makeProcessLifecycleChangedEvent(
            { processId, tag: "Restarted", groupId },
            occurredAtMs,
          ),
        );
      }),
  })),
  ProcessStoreBuilder.read((s) => ({
    lifecycleByGroup: (groupId: string, opts?: QueryOpts) =>
      s.events({
        entityType: "process",
        types: ["process.lifecycle.changed"],
        opts,
      }).pipe(
        Effect.map((events) => lifecycleEventsForGroup(events, groupId, opts)),
      ),
  })),
) {}

/**
 * @public
 */
export declare namespace ProcessStoreProcessGroup {
  export type Type = ProcessStoreBuilder.Service.Type<typeof ProcessStoreProcessGroup>;
  export type EmitType = ProcessStoreBuilder.Service.EmitType<
    typeof ProcessStoreProcessGroup
  >;
}
