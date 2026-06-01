/**
 * **`ProcessGroup` storage facet** — group-scoped lifecycle reads and
 * writes layered on top of {@link ProcessLifecycleStore}.
 *
 * @remarks
 * Group control paths ({@link ProcessGroup} `start` / `stop` / `restart`)
 * call the **static** emitters on this class so every row carries
 * `attributes.groupId`. Process-scoped lifecycle without a group uses
 * {@link ProcessLifecycleStore} directly.
 *
 * Compose {@link ProcessGroupStore.layerRuntimeStorage} together
 * with {@link ProcessLifecycleStore.layerRuntimeStorage} — this
 * layer requires the lifecycle facet.
 * {@link ProcessStorage.layerRuntimeStorage} merges both.
 *
 * ## At-a-glance
 *
 * | Concern | Where |
 * |--------|-------|
 * | Wire types | `Process.Lifecycle.*` (shared with {@link ProcessLifecycleStore}) |
 * | Static emit | `ProcessGroupScope.run({ groupId }, ProcessGroupMemberScope.run({ processId }, ProcessGroupStore.Lifecycle.Started))` |
 * | Reads (instance) | `lifecycleByGroup(groupId, opts?)` |
 * | Reads (bound, `for(groupId)`) | `lifecycle(opts?)` |
 *
 * ## Group filter
 *
 * `groupId` lives in `record.attributes.groupId`. Group queries fetch
 * `Process.Lifecycle.*` rows from storage and post-filter on the
 * JSON attribute; `windowOpts` defers
 * `limit` until after the post-filter so a sparse group cannot collapse
 * a `limit: N` query to zero rows.
 *
 * @module store/ProcessGroup
 */

import { Effect, Schema } from "effect";
import {
  applyQueryOpts,
  byTimestampDesc,
  runtimeRecordQuery,
  windowOpts,
} from "../internal/store/helpers";
import { ProcessStore, Telemetry } from "../ProcessStore";
import type { QueryOpts } from "../ProcessStoreEvent";
import { Type } from "../Query";
import type { RuntimeRecord } from "../RuntimeStorage";
import { ProcessGroupMemberScope, ProcessGroupScope } from "../ProcessGroupScope";
import {
  processLifecycleWireTypes,
  recordToLifecycleEvent,
  type ProcessLifecycleChangedEvent,
} from "./processLifecycle";

const lifecycleEventsForGroup = (
  records: ReadonlyArray<RuntimeRecord>,
  groupId: string,
  opts?: QueryOpts,
): ProcessLifecycleChangedEvent[] => {
  const matching: ProcessLifecycleChangedEvent[] = [];
  for (const record of records) {
    const event = recordToLifecycleEvent(record);
    if (event === null) continue;
    if (event.attributes === undefined) continue;
    if (event.attributes["groupId"] !== groupId) continue;
    matching.push(event);
  }
  matching.sort(
    byTimestampDesc(
      (event) => event.occurredAt,
      (event) => event.id,
    ),
  );
  return applyQueryOpts(matching, opts, (event) => event.occurredAt);
};

const groupMemberLifecycleFields = {
  processType: Schema.Literal("process"),
  groupId: ProcessGroupScope.Schema.State.groupId,
  processId: ProcessGroupMemberScope.Schema.Leaf.processId,
  occurredAt: Telemetry.terminal.clockMillis,
} as const;

class ProcessGroupMemberStarted extends Telemetry.Schema<ProcessGroupMemberStarted>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: Schema.Literal("Started"),
}) {}

class ProcessGroupMemberStopped extends Telemetry.Schema<ProcessGroupMemberStopped>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: Schema.Literal("Stopped"),
}) {}

class ProcessGroupMemberRestarted extends Telemetry.Schema<ProcessGroupMemberRestarted>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: Schema.Literal("Restarted"),
}) {}

class ProcessGroupMemberErrored extends Telemetry.Schema<ProcessGroupMemberErrored>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: Schema.Literal("Errored"),
  error: Telemetry.input.errorString,
}) {}

class ProcessGroupMemberRecovered extends Telemetry.Schema<ProcessGroupMemberRecovered>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: Schema.Literal("Recovered"),
}) {}

class ProcessGroupMemberDisabled extends Telemetry.Schema<ProcessGroupMemberDisabled>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: Schema.Literal("Disabled"),
}) {}

class ProcessGroupMemberEnabled extends Telemetry.Schema<ProcessGroupMemberEnabled>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: Schema.Literal("Enabled"),
}) {}

/**
 * `ProcessGroup` storage facet (see module doc).
 *
 * @public
 */
export class ProcessGroupStore extends ProcessStore.Service<
  ProcessGroupStore
>()(
  "@nikscripts/effect-pm/store/processGroup/ProcessGroupStore",
  ProcessStore.telemetry(
    Telemetry.namespace("Process"),
    Telemetry.tag("Lifecycle")(
      Telemetry.event("Started", ProcessGroupMemberStarted).pipe(
        Telemetry.logWarning(
          "ProcessGroupStore write failed for Started transition",
          ({ groupId, processId }) => ({
            groupId: String(groupId),
            processId: String(processId),
            tag: "Started",
          }),
        ),
      ),
      Telemetry.event("Stopped", ProcessGroupMemberStopped).pipe(
        Telemetry.logWarning(
          "ProcessGroupStore write failed for Stopped transition",
          ({ groupId, processId }) => ({
            groupId: String(groupId),
            processId: String(processId),
            tag: "Stopped",
          }),
        ),
      ),
      Telemetry.event("Restarted", ProcessGroupMemberRestarted).pipe(
        Telemetry.logWarning(
          "ProcessGroupStore write failed for Restarted transition",
          ({ groupId, processId }) => ({
            groupId: String(groupId),
            processId: String(processId),
            tag: "Restarted",
          }),
        ),
      ),
      Telemetry.event("Errored", ProcessGroupMemberErrored).pipe(
        Telemetry.logWarning(
          ({ groupId, processId }) =>
            `ProcessGroupStore write failed for Errored transition "${String(groupId)}/${String(processId)}"`,
          ({ groupId, processId }) => ({
            groupId: String(groupId),
            processId: String(processId),
            tag: "Errored",
          }),
        ),
      ),
      Telemetry.event("Recovered", ProcessGroupMemberRecovered).pipe(
        Telemetry.logWarning(
          "ProcessGroupStore write failed for Recovered transition",
          ({ groupId, processId }) => ({
            groupId: String(groupId),
            processId: String(processId),
            tag: "Recovered",
          }),
        ),
      ),
      Telemetry.event("Disabled", ProcessGroupMemberDisabled).pipe(
        Telemetry.logWarning(
          "ProcessGroupStore write failed for Disabled transition",
          ({ groupId, processId }) => ({
            groupId: String(groupId),
            processId: String(processId),
            tag: "Disabled",
          }),
        ),
      ),
      Telemetry.event("Enabled", ProcessGroupMemberEnabled).pipe(
        Telemetry.logWarning(
          "ProcessGroupStore write failed for Enabled transition",
          ({ groupId, processId }) => ({
            groupId: String(groupId),
            processId: String(processId),
            tag: "Enabled",
          }),
        ),
      ),
    ),
  ),
  ProcessStore.query((s) => ({
    lifecycleByGroup: (groupId: string, opts?: QueryOpts) =>
      s
        .read(
          runtimeRecordQuery([Type.in(processLifecycleWireTypes)], windowOpts(opts)),
        )
        .pipe(
          Effect.map((records) =>
            lifecycleEventsForGroup(records, groupId, opts),
          ),
        ),
  })),
  ProcessStore.for((groupId, s) => ({
    lifecycle: (opts?: QueryOpts) =>
      s
        .read(
          runtimeRecordQuery([Type.in(processLifecycleWireTypes)], windowOpts(opts)),
        )
        .pipe(
          Effect.map((records) =>
            lifecycleEventsForGroup(records, groupId, opts),
          ),
        ),
  })),
) {
  declare static Lifecycle: {
    readonly Started: Effect.Effect<void>;
    readonly Stopped: Effect.Effect<void>;
    readonly Restarted: Effect.Effect<void>;
    readonly Errored: (error: unknown) => Effect.Effect<void>;
    readonly Recovered: Effect.Effect<void>;
    readonly Disabled: Effect.Effect<void>;
    readonly Enabled: Effect.Effect<void>;
  };
}

/**
 * @public
 */
export declare namespace ProcessGroupStore {
  export type Type = ProcessStore.Service.Type<typeof ProcessGroupStore>;
  export type EmitType = ProcessStore.Service.EmitType<
    typeof ProcessGroupStore
  >;
  export type IdentifierType = ProcessStore.Service.IdentifierType<
    typeof ProcessGroupStore
  >;
}
