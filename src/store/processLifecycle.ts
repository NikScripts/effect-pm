/**
 * **Process lifecycle storage facet** — `process.lifecycle.changed` rows
 * keyed by process id.
 *
 * @remarks
 * Process-scoped analytics for {@link Process.spawn}, supervisors, and
 * any writer that records lifecycle without a group. For group control
 * paths (`start` / `stop` / `restart` with a `groupId`), use
 * {@link ProcessStoreProcessGroup} instead — it stamps
 * `attributes.groupId` and exposes group-scoped queries.
 *
 * ## At-a-glance
 *
 * | Concern | Where |
 * |--------|-------|
 * | Wire type | `process.lifecycle.changed` |
 * | Static emit | `lifecycleChanged({ processId, tag, error?, ... })` |
 * | Reads (instance) | `lifecycle(processId, opts?)`, `lifecycleForProcesses([id], opts?)`, `latestLifecycleByProcess([id])` |
 * | Reads (bound, `for(processId)`) | `lifecycle(opts?)`, `latest()`, `recordTransition({ tag, error?, ... })` |
 *
 * ## Storage shape
 *
 * Each transition writes one {@link RuntimeRecord} with:
 *
 * - `type` = `process.lifecycle.changed`
 * - `processType` = `process`
 * - `processId` = the transitioning process id
 * - `payload` = `{ tag, error? }`
 * - `attributes` = `{ groupId?, ...extra }` if any extra attributes
 *   were supplied; otherwise omitted.
 *
 * Compose via {@link ProcessStoreProcessLifecycle.layerRuntimeStorage}
 * or {@link ProcessStorage.layerRuntimeStorage}.
 *
 * @module store/ProcessLifecycle
 */

import { Clock, DateTime, Effect, Option } from "effect";
import {
  isRecord,
  isString,
  recordAttributesObject,
  runtimeRecordQuery,
} from "../internal/store/helpers";
import { ProcessStore } from "../ProcessStore";
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
  type: "process.lifecycle.changed";
  entityType: "process";
  lifecycle: {
    tag: ProcessLifecycleTag;
    error?: string;
  };
}

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

const PROCESS_TYPE = "process";
const LIFECYCLE_TYPE = "process.lifecycle.changed";

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
 * @internal Shared with {@link ProcessStoreProcessGroup} member writes.
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
 * @internal Shared with {@link ProcessStoreProcessGroup} member reads.
 */
export const recordToLifecycleEvent = (
  record: RuntimeRecord,
): ProcessLifecycleChangedEvent | null => {
  if (record.type !== LIFECYCLE_TYPE) return null;
  if (record.processType !== PROCESS_TYPE) return null;
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  const tag = payload["tag"];
  const errorRaw = payload["error"];
  if (!isLifecycleTag(tag)) return null;
  if (errorRaw !== undefined && !isString(errorRaw)) return null;
  return {
    id: record.id,
    type: LIFECYCLE_TYPE,
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
export class ProcessStoreProcessLifecycle extends ProcessStore.Service<
  ProcessStoreProcessLifecycle
>()(
  "@nikscripts/effect-pm/store/processLifecycle/ProcessStoreProcessLifecycle",
  ProcessStore.record({
    lifecycleChanged: (s) => (input: ProcessLifecycleRecordInput) =>
      Effect.gen(function* () {
        const occurredAtMs = input.occurredAt ?? (yield* Clock.currentTimeMillis);
        yield* s.create(makeProcessLifecycleRecord(input, occurredAtMs));
      }),
  }),
  ProcessStore.read((s) => ({
    lifecycle: (processId: string, opts?: QueryOpts) =>
      s
        .read(
          runtimeRecordQuery(
            [Type.equals(LIFECYCLE_TYPE), ProcessId.equals(processId)],
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
            [Type.equals(LIFECYCLE_TYPE), ProcessId.in(processIds)],
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
              [Type.equals(LIFECYCLE_TYPE), ProcessId.equals(processId)],
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
  ProcessStore.withIdentifier((processId, s) => ({
    lifecycle: (opts?: QueryOpts) =>
      s
        .read(
          runtimeRecordQuery(
            [Type.equals(LIFECYCLE_TYPE), ProcessId.equals(processId)],
            opts,
          ),
        )
        .pipe(Effect.map(decodeLifecycleEvents)),

    latest: () =>
      s
        .read(
          runtimeRecordQuery(
            [Type.equals(LIFECYCLE_TYPE), ProcessId.equals(processId)],
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

    recordTransition: (
      input: Omit<ProcessLifecycleRecordInput, "processId">,
    ) =>
      Effect.gen(function* () {
        const occurredAtMs =
          input.occurredAt ?? (yield* Clock.currentTimeMillis);
        yield* s.create(
          makeProcessLifecycleRecord({ processId, ...input }, occurredAtMs),
        );
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
  export type IdentifierType = ProcessStore.Service.IdentifierType<
    typeof ProcessStoreProcessLifecycle
  >;
}
