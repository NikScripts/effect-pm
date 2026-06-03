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

import { Effect } from "effect";
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
  processType: "process",
  groupId: ProcessGroupScope.Schema.State.groupId,
  processId: ProcessGroupMemberScope.Schema.Leaf.processId,
  occurredAt: Telemetry.terminal.clockMillis,
} as const;

class ProcessGroupMemberStarted extends Telemetry.Schema<ProcessGroupMemberStarted>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: "Started",
}) {}

class ProcessGroupMemberStopped extends Telemetry.Schema<ProcessGroupMemberStopped>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: "Stopped",
}) {}

class ProcessGroupMemberRestarted extends Telemetry.Schema<ProcessGroupMemberRestarted>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: "Restarted",
}) {}

class ProcessGroupMemberErrored extends Telemetry.Schema<ProcessGroupMemberErrored>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: "Errored",
  error: Telemetry.input.errorString,
}) {}

class ProcessGroupMemberRecovered extends Telemetry.Schema<ProcessGroupMemberRecovered>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: "Recovered",
}) {}

class ProcessGroupMemberDisabled extends Telemetry.Schema<ProcessGroupMemberDisabled>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: "Disabled",
}) {}

class ProcessGroupMemberEnabled extends Telemetry.Schema<ProcessGroupMemberEnabled>()(
  ProcessGroupMemberScope,
)({
  ...groupMemberLifecycleFields,
  tag: "Enabled",
}) {}

const ProcessGroupTelemetry = ProcessStore.telemetry(
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
);

const processGroupLifecycleWireTypes = Telemetry.events(
  ProcessGroupTelemetry,
  "Lifecycle",
);

/**
 * `ProcessGroup` storage facet (see module doc).
 *
 * @public
 */
export const ProcessGroupStore = ProcessStore.Service(
  "@nikscripts/effect-pm/store/processGroup/ProcessGroupStore",
  "ProcessGroup",
  ProcessGroupTelemetry,
  ProcessStore.query((s) => ({
    lifecycleByGroup: (groupId: string, opts?: QueryOpts) =>
      s
        .read(
          runtimeRecordQuery([Type.in(processGroupLifecycleWireTypes)], windowOpts(opts)),
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
          runtimeRecordQuery([Type.in(processGroupLifecycleWireTypes)], windowOpts(opts)),
        )
        .pipe(
          Effect.map((records) =>
            lifecycleEventsForGroup(records, groupId, opts),
          ),
        ),
  })),
);

export type ProcessGroupStore = typeof ProcessGroupStore.Identifier;

/**
 * @public
 */
