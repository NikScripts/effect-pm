/**
 * **`ProcessGroup` storage facet** — group-scoped lifecycle reads and
 * writes layered on top of {@link ProcessLifecycleStore}.
 *
 * @remarks
 * Group control paths ({@link ProcessGroup} `start` / `stop` / `restart`)
 * call the **static** emitters on this class so every row carries
 * `attributes.groupId`. Writes delegate to the same wire type as
 * {@link ProcessLifecycleStore} (`process.lifecycle.changed`) by
 * importing its row encoder/decoder, so the on-disk shape stays
 * identical. Process-scoped lifecycle without a group (future
 * {@link Process.spawn}, supervisors) uses
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
 * | Wire type | `process.lifecycle.changed` (shared with {@link ProcessLifecycleStore}) |
 * | Static emit | `recordMemberLifecycle(groupId, input)`, `recordMemberStarted(groupId, processId)` (+ `Stopped` / `Restarted`) |
 * | Reads (instance) | `lifecycleByGroup(groupId, opts?)` |
 * | Reads + writes (bound, `for(groupId)`) | `lifecycle(opts?)`, `recordMemberLifecycle(input)`, `recordMemberStarted(processId)`, `recordMemberStopped(processId)`, `recordMemberRestarted(processId)` |
 *
 * ## Group filter
 *
 * `groupId` lives in `record.attributes.groupId`. Group queries fetch
 * `process.lifecycle.changed` rows from storage and post-filter on the
 * JSON attribute (matching the shape produced by
 * {@link ProcessLifecycleStore} writes); `windowOpts` defers
 * `limit` until after the post-filter so a sparse group cannot collapse
 * a `limit: N` query to zero rows.
 *
 * @module store/ProcessGroup
 */

import { Clock, Effect } from "effect";
import {
  applyQueryOpts,
  byTimestampDesc,
  runtimeRecordQuery,
  windowOpts,
} from "../internal/store/helpers";
import { ProcessStore } from "../ProcessStore";
import type { JsonValue, QueryOpts } from "../ProcessStoreEvent";
import { Type } from "../Query";
import type { RuntimeRecord } from "../RuntimeStorage";
import {
  makeProcessLifecycleRecord,
  recordToLifecycleEvent,
  type ProcessLifecycleChangedEvent,
  type ProcessLifecycleRecordInput,
  type ProcessLifecycleTag,
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

const LIFECYCLE_TYPE = "process.lifecycle.changed";

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

const memberLifecycleRecord = (
  groupId: string,
  input: ProcessGroupMemberLifecycleInput,
  occurredAtMs: number,
): Omit<RuntimeRecord, "runId" | "createdAt"> =>
  makeProcessLifecycleRecord(memberLifecycleInput(groupId, input), occurredAtMs);

const memberTagRecord = (
  groupId: string,
  processId: string,
  tag: ProcessLifecycleTag,
  occurredAtMs: number,
): Omit<RuntimeRecord, "runId" | "createdAt"> =>
  makeProcessLifecycleRecord({ processId, tag, groupId }, occurredAtMs);

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

/**
 * `ProcessGroup` storage facet (see module doc).
 *
 * @public
 */
export class ProcessGroupStore extends ProcessStore.Service<
  ProcessGroupStore
>()(
  "@nikscripts/effect-pm/store/processGroup/ProcessGroupStore",
  ProcessStore.read((s) => ({
    lifecycleByGroup: (groupId: string, opts?: QueryOpts) =>
      s
        .read(
          runtimeRecordQuery([Type.equals(LIFECYCLE_TYPE)], windowOpts(opts)),
        )
        .pipe(
          Effect.map((records) =>
            lifecycleEventsForGroup(records, groupId, opts),
          ),
        ),
  })),
  ProcessStore.withIdentifier((groupId, s) => ({
    lifecycle: (opts?: QueryOpts) =>
      s
        .read(
          runtimeRecordQuery([Type.equals(LIFECYCLE_TYPE)], windowOpts(opts)),
        )
        .pipe(
          Effect.map((records) =>
            lifecycleEventsForGroup(records, groupId, opts),
          ),
        ),
    recordMemberLifecycle: (input: ProcessGroupMemberLifecycleInput) =>
      Effect.gen(function* () {
        const occurredAtMs =
          input.occurredAt ?? (yield* Clock.currentTimeMillis);
        yield* s.create(memberLifecycleRecord(groupId, input, occurredAtMs));
      }),
    recordMemberStarted: (processId: string) =>
      Effect.gen(function* () {
        const occurredAtMs = yield* Clock.currentTimeMillis;
        yield* s.create(
          memberTagRecord(groupId, processId, "Started", occurredAtMs),
        );
      }),
    recordMemberStopped: (processId: string) =>
      Effect.gen(function* () {
        const occurredAtMs = yield* Clock.currentTimeMillis;
        yield* s.create(
          memberTagRecord(groupId, processId, "Stopped", occurredAtMs),
        );
      }),
    recordMemberRestarted: (processId: string) =>
      Effect.gen(function* () {
        const occurredAtMs = yield* Clock.currentTimeMillis;
        yield* s.create(
          memberTagRecord(groupId, processId, "Restarted", occurredAtMs),
        );
      }),
  })),
  ProcessStore.record({
    recordMemberLifecycle:
      (s) =>
      (groupId: string, input: ProcessGroupMemberLifecycleInput) =>
        Effect.gen(function* () {
          const occurredAtMs =
            input.occurredAt ?? (yield* Clock.currentTimeMillis);
          yield* s.create(memberLifecycleRecord(groupId, input, occurredAtMs));
        }),
    recordMemberStarted:
      (s) => (groupId: string, processId: string) =>
        Effect.gen(function* () {
          const occurredAtMs = yield* Clock.currentTimeMillis;
          yield* s.create(
            memberTagRecord(groupId, processId, "Started", occurredAtMs),
          );
        }),
    recordMemberStopped:
      (s) => (groupId: string, processId: string) =>
        Effect.gen(function* () {
          const occurredAtMs = yield* Clock.currentTimeMillis;
          yield* s.create(
            memberTagRecord(groupId, processId, "Stopped", occurredAtMs),
          );
        }),
    recordMemberRestarted:
      (s) => (groupId: string, processId: string) =>
        Effect.gen(function* () {
          const occurredAtMs = yield* Clock.currentTimeMillis;
          yield* s.create(
            memberTagRecord(groupId, processId, "Restarted", occurredAtMs),
          );
        }),
  }),
) {}

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
