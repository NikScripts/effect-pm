/**
 * **Process lifecycle storage facet** — `Process.Lifecycle.*` rows keyed
 * by process id.
 *
 * @remarks
 * Process-scoped analytics for {@link Process.spawn}, supervisors, and
 * any writer that records lifecycle without a group. For group control
 * paths (`start` / `stop` / `restart` with a `groupId`), use
 * {@link ProcessGroupStore} instead — it stamps
 * `attributes.groupId` and exposes group-scoped queries.
 *
 * ## At-a-glance
 *
 * | Concern | Where |
 * |--------|-------|
 * | Wire types | `Process.Lifecycle.Started` / `.Stopped` / `.Restarted` / `.Errored` / `.Recovered` / `.Disabled` / `.Enabled` |
 * | Static emit | `ProcessLifecycleScope.run({ processId }, ProcessLifecycleStore.Lifecycle.Started)` |
 * | Reads (instance) | `lifecycle(processId, opts?)`, `lifecycleForProcesses([id], opts?)`, `latestLifecycleByProcess([id])` |
 * | Reads (bound, `for(processId)`) | `lifecycle(opts?)`, `latest()` |
 *
 * ## Storage shape
 *
 * Each transition writes one {@link RuntimeRecord} with:
 *
 * - `type` = one of `Process.Lifecycle.*` (legacy group rows may still use
 *   `process.lifecycle.changed` until `ProcessGroupStore` migrates)
 * - `processType` = `process`
 * - `processId` = the transitioning process id
 * - `payload` = `{ processType, processId, occurredAt, tag, error? }`
 *
 * Compose via {@link ProcessLifecycleStore.layerRuntimeStorage}
 * or {@link ProcessStorage.layerRuntimeStorage}.
 *
 * @module store/ProcessLifecycle
 */

import { DateTime, Effect, Option, Schema } from "effect";
import {
  isRecord,
  isString,
  recordAttributesObject,
  runtimeRecordQuery,
} from "../internal/store/helpers";
import { ProcessStore, Telemetry } from "../ProcessStore";
import { ProcessLifecycleScope } from "../ProcessLifecycleScope";
import type {
  AnalyticsEventBase,
  JsonValue,
  QueryOpts,
} from "../ProcessStoreEvent";
import { ProcessId, Type } from "../Query";
import type { RuntimeRecord } from "../RuntimeStorage";

/**
 * High-level lifecycle labels written by the process supervisor.
 *
 * @public
 */
export type ProcessLifecycleTag =
  | "Started"
  | "Stopped"
  | "Restarted"
  | "Errored"
  | "Recovered"
  | "Disabled"
  | "Enabled";

/**
 * Supervisor-observed lifecycle transition for a process id.
 *
 * @public
 */
export interface ProcessLifecycleChangedEvent extends AnalyticsEventBase {
  type: ProcessLifecycleWireType;
  entityType: "process";
  lifecycle: {
    tag: ProcessLifecycleTag;
    error?: string;
  };
}

/**
 * Legacy write input retained for `ProcessGroupStore` until the group facet
 * migrates to schema-backed telemetry.
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

const PROCESS_TYPE = "process";
const LIFECYCLE_TYPE = "process.lifecycle.changed";
const LIFECYCLE_WIRE: {
  readonly Changed: "process.lifecycle.changed";
  readonly Started: "Process.Lifecycle.Started";
  readonly Stopped: "Process.Lifecycle.Stopped";
  readonly Restarted: "Process.Lifecycle.Restarted";
  readonly Errored: "Process.Lifecycle.Errored";
  readonly Recovered: "Process.Lifecycle.Recovered";
  readonly Disabled: "Process.Lifecycle.Disabled";
  readonly Enabled: "Process.Lifecycle.Enabled";
} = {
  Changed: LIFECYCLE_TYPE,
  Started: "Process.Lifecycle.Started",
  Stopped: "Process.Lifecycle.Stopped",
  Restarted: "Process.Lifecycle.Restarted",
  Errored: "Process.Lifecycle.Errored",
  Recovered: "Process.Lifecycle.Recovered",
  Disabled: "Process.Lifecycle.Disabled",
  Enabled: "Process.Lifecycle.Enabled",
};

export type ProcessLifecycleWireType =
  typeof LIFECYCLE_WIRE[keyof typeof LIFECYCLE_WIRE];

const lifecycleWireTypes: ReadonlyArray<ProcessLifecycleWireType> =
  Object.values(LIFECYCLE_WIRE);

const lifecycleTags: ReadonlyArray<ProcessLifecycleTag> = [
  "Started",
  "Stopped",
  "Restarted",
  "Errored",
  "Recovered",
  "Disabled",
  "Enabled",
];

const isLifecycleTag = (value: unknown): value is ProcessLifecycleTag =>
  isString(value) && lifecycleTags.some((tag) => tag === value);

const isLifecycleWireType = (value: string): value is ProcessLifecycleWireType =>
  lifecycleWireTypes.some((wire) => wire === value);

const lifecycleAttributesBlob = (
  input: ProcessLifecycleRecordInput & { readonly groupId?: string },
): { readonly [key: string]: JsonValue } | undefined => {
  const out: { [key: string]: JsonValue } = {};
  if (input.groupId !== undefined) out["groupId"] = input.groupId;
  if (input.attributes !== undefined) {
    for (const [key, value] of Object.entries(input.attributes)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
};

let processLifecycleSeq = 0;

/**
 * Build a `process.lifecycle.changed` runtime record.
 *
 * @internal Shared with {@link ProcessGroupStore} member writes.
 */
export const makeProcessLifecycleRecord = (
  input: ProcessLifecycleRecordInput & { readonly groupId?: string },
  occurredAtMs: number,
): Omit<RuntimeRecord, "runId" | "createdAt"> => {
  processLifecycleSeq += 1;
  const attributes = lifecycleAttributesBlob(input);
  return {
    id: `${input.processId}-lifecycle-${input.tag.toLowerCase()}-${String(processLifecycleSeq)}`,
    type: LIFECYCLE_TYPE,
    occurredAt: DateTime.makeUnsafe(occurredAtMs),
    processType: PROCESS_TYPE,
    processId: input.processId,
    payload: {
      tag: input.tag,
      ...(input.error !== undefined ? { error: input.error } : {}),
    },
    ...(attributes !== undefined ? { attributes } : {}),
  };
};

/**
 * Decode a `process.lifecycle.changed` runtime record back into a typed event.
 *
 * @internal Shared with {@link ProcessGroupStore} member reads.
 */
export const recordToLifecycleEvent = (
  record: RuntimeRecord,
): ProcessLifecycleChangedEvent | null => {
  if (!isLifecycleWireType(record.type)) return null;
  if (record.processType !== PROCESS_TYPE) return null;
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  const tag = payload["tag"];
  const errorRaw = payload["error"];
  if (!isLifecycleTag(tag)) return null;
  if (errorRaw !== undefined && !isString(errorRaw)) return null;
  return {
    id: record.id,
    type: record.type,
    occurredAt: DateTime.toEpochMillis(record.occurredAt),
    entityType: PROCESS_TYPE,
    entityId: record.processId,
    attributes: recordAttributesObject(record.attributes),
    lifecycle: {
      tag,
      ...(errorRaw === undefined ? {} : { error: errorRaw }),
    },
  };
};

const ProcessLifecycleState = ProcessLifecycleScope.Schema.State;

const lifecycleSchemaFields = {
  processType: Schema.Literal(PROCESS_TYPE),
  processId: ProcessLifecycleState.processId,
  occurredAt: Telemetry.terminal.clockMillis,
} as const;

class ProcessLifecycleStarted extends Telemetry.Schema<ProcessLifecycleStarted>()(
  ProcessLifecycleScope,
)({
  ...lifecycleSchemaFields,
  tag: Schema.Literal("Started"),
}) {}

class ProcessLifecycleStopped extends Telemetry.Schema<ProcessLifecycleStopped>()(
  ProcessLifecycleScope,
)({
  ...lifecycleSchemaFields,
  tag: Schema.Literal("Stopped"),
}) {}

class ProcessLifecycleRestarted extends Telemetry.Schema<ProcessLifecycleRestarted>()(
  ProcessLifecycleScope,
)({
  ...lifecycleSchemaFields,
  tag: Schema.Literal("Restarted"),
}) {}

class ProcessLifecycleErrored extends Telemetry.Schema<ProcessLifecycleErrored>()(
  ProcessLifecycleScope,
)({
  ...lifecycleSchemaFields,
  tag: Schema.Literal("Errored"),
  error: Telemetry.input.errorString,
}) {}

class ProcessLifecycleRecovered extends Telemetry.Schema<ProcessLifecycleRecovered>()(
  ProcessLifecycleScope,
)({
  ...lifecycleSchemaFields,
  tag: Schema.Literal("Recovered"),
}) {}

class ProcessLifecycleDisabled extends Telemetry.Schema<ProcessLifecycleDisabled>()(
  ProcessLifecycleScope,
)({
  ...lifecycleSchemaFields,
  tag: Schema.Literal("Disabled"),
}) {}

class ProcessLifecycleEnabled extends Telemetry.Schema<ProcessLifecycleEnabled>()(
  ProcessLifecycleScope,
)({
  ...lifecycleSchemaFields,
  tag: Schema.Literal("Enabled"),
}) {}

const decodeLifecycleEvents = (
  records: ReadonlyArray<RuntimeRecord>,
): ProcessLifecycleChangedEvent[] => {
  const rows: ProcessLifecycleChangedEvent[] = [];
  for (const record of records) {
    const event = recordToLifecycleEvent(record);
    if (event !== null) rows.push(event);
  }
  return rows;
};

/**
 * Process lifecycle storage facet (see module doc).
 *
 * @public
 */
export class ProcessLifecycleStore extends ProcessStore.Service<
  ProcessLifecycleStore
>()(
  "@nikscripts/effect-pm/store/processLifecycle/ProcessLifecycleStore",
  ProcessStore.telemetry(
    Telemetry.namespace("Process"),
    Telemetry.tag("Lifecycle")(
      Telemetry.event("Started", ProcessLifecycleStarted).pipe(
        Telemetry.logWarning(
          "ProcessLifecycleStore write failed for Started transition",
          ({ processId }) => ({ processId: String(processId), tag: "Started" }),
        ),
      ),
      Telemetry.event("Stopped", ProcessLifecycleStopped).pipe(
        Telemetry.logWarning(
          "ProcessLifecycleStore write failed for Stopped transition",
          ({ processId }) => ({ processId: String(processId), tag: "Stopped" }),
        ),
      ),
      Telemetry.event("Restarted", ProcessLifecycleRestarted).pipe(
        Telemetry.logWarning(
          "ProcessLifecycleStore write failed for Restarted transition",
          ({ processId }) => ({ processId: String(processId), tag: "Restarted" }),
        ),
      ),
      Telemetry.event("Errored", ProcessLifecycleErrored).pipe(
        Telemetry.logWarning(
          ({ processId }) => `ProcessLifecycleStore write failed for Errored transition "${String(processId)}"`,
          ({ processId }) => ({ processId: String(processId), tag: "Errored" }),
        ),
      ),
      Telemetry.event("Recovered", ProcessLifecycleRecovered).pipe(
        Telemetry.logWarning(
          "ProcessLifecycleStore write failed for Recovered transition",
          ({ processId }) => ({ processId: String(processId), tag: "Recovered" }),
        ),
      ),
      Telemetry.event("Disabled", ProcessLifecycleDisabled).pipe(
        Telemetry.logWarning(
          "ProcessLifecycleStore write failed for Disabled transition",
          ({ processId }) => ({ processId: String(processId), tag: "Disabled" }),
        ),
      ),
      Telemetry.event("Enabled", ProcessLifecycleEnabled).pipe(
        Telemetry.logWarning(
          "ProcessLifecycleStore write failed for Enabled transition",
          ({ processId }) => ({ processId: String(processId), tag: "Enabled" }),
        ),
      ),
    ),
  ),
  ProcessStore.query((s) => ({
    lifecycle: (processId: string, opts?: QueryOpts) =>
      s
        .read(
          runtimeRecordQuery(
            [Type.in(lifecycleWireTypes), ProcessId.equals(processId)],
            opts,
          ),
        )
        .pipe(Effect.map(decodeLifecycleEvents)),

    lifecycleForProcesses: (
      processIds: ReadonlyArray<string>,
      opts?: QueryOpts,
    ) => {
      if (processIds.length === 0) {
        return Effect.succeed<ProcessLifecycleChangedEvent[]>([]);
      }
      return s
        .read(
          runtimeRecordQuery(
            [Type.in(lifecycleWireTypes), ProcessId.in(processIds)],
            opts,
          ),
        )
        .pipe(Effect.map(decodeLifecycleEvents));
    },

    latestLifecycleByProcess: (processIds: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const latest = new Map<string, ProcessLifecycleTag>();
        for (const processId of processIds) {
          const records = yield* s.read(
            runtimeRecordQuery(
              [Type.in(lifecycleWireTypes), ProcessId.equals(processId)],
              { limit: 1 },
            ),
          );
          const event = decodeLifecycleEvents(records)[0];
          if (event !== undefined) {
            latest.set(processId, event.lifecycle.tag);
          }
        }
        return latest;
      }),
  })),
  ProcessStore.for((processId, s) => ({
    lifecycle: (opts?: QueryOpts) =>
      s
        .read(
          runtimeRecordQuery(
            [Type.in(lifecycleWireTypes), ProcessId.equals(processId)],
            opts,
          ),
        )
        .pipe(Effect.map(decodeLifecycleEvents)),

    latest: () =>
      s
        .read(
          runtimeRecordQuery(
            [Type.in(lifecycleWireTypes), ProcessId.equals(processId)],
            { limit: 1 },
          ),
        )
        .pipe(
          Effect.map((records) => {
            const event = decodeLifecycleEvents(records)[0];
            return event === undefined
              ? Option.none<ProcessLifecycleTag>()
              : Option.some(event.lifecycle.tag);
          }),
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
export declare namespace ProcessLifecycleStore {
  export type Type = ProcessStore.Service.Type<
    typeof ProcessLifecycleStore
  >;
  export type EmitType = ProcessStore.Service.EmitType<
    typeof ProcessLifecycleStore
  >;
  export type IdentifierType = ProcessStore.Service.IdentifierType<
    typeof ProcessLifecycleStore
  >;
}
