/**
 * Built-in {@link QueueResource} store contract.
 *
 * The store persists the **same** `QueueEvent<T>` union the engine already publishes on the live
 * `.events` stream (one event model for wire + persistence — `queue-persistence-design.md`), using
 * the existing `queueEvent(itemSchema)` schema as the codec. So the handle is just `record` (append
 * a built event) + `events` (read them back) — no event model of its own, no object-literal
 * construction against a schema-decoded generic (which is what forced casts / collapsed hovers).
 *
 * @module internal/store/queueStoreSpec
 * @internal
 */

import { DateTime, Duration, Effect, Option, Schema, Stream } from "effect";
import type { Cause, Exit } from "effect";
import type { ResourceTag, Spec, SpecOf } from "../../Resource";
import { specSym } from "../../Resource";
import { queueEntry, queueEvent, queueSpec } from "../../QueueResource";
import type { Priority, QueueEvent } from "../queueResource";
import * as Store from "../../Store";
import type {
  SchemaDecoded,
  StoreContractValue,
  StoreShapeDef,
} from "./contractDef";
import type { StoreJournalDecodeError, StoreWriteError } from "./errors";
import type { StoreScopeTag } from "./registration";

/** Queue tag shape for store registration — `specSym` carries the flat wire spec. @internal */
export interface QueueStoreTag extends StoreScopeTag {
  readonly [specSym]: Record<string, unknown>;
}

/** Spec of a queue instance whose item is `Schema.Struct<F>`. @internal */
type QueueInstanceSpec<F extends Schema.Struct.Fields> = ReturnType<typeof queueSpec<F>>;

/** Nested spec recovered from a queue tag class. @internal */
type QueueSpecFromTag<Tag extends QueueStoreTag> = SpecOf<Tag & ResourceTag<unknown, Spec>>;

/** Struct fields of the queue item from a tag. @internal */
type QueueItemFields<Tag extends QueueStoreTag> =
  QueueSpecFromTag<Tag> extends QueueInstanceSpec<infer F extends Schema.Struct.Fields> ? F : never;

/** Item row schema carried on a {@link QueueResource} tag (from `QueueInstanceSpec<F>`). @internal */
export type QueueItemSchemaFromTag<Tag extends QueueStoreTag> = Schema.Struct<QueueItemFields<Tag>>;

/** Item value type carried on a queue tag. @internal */
export type QueueItemOf<Tag extends QueueStoreTag> = Schema.Struct<QueueItemFields<Tag>>["Type"];

/** The persisted queue event for a tag — the same union the live `.events` stream carries. @internal */
export type QueueEventOf<Tag extends QueueStoreTag> = QueueEvent<QueueItemOf<Tag>>;

/** Read payload for the built-in `events` query. @internal */
export const queueEventReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

/** Built-in queue store contract for a tag — one `event` shape over the shared event schema. @internal */
export type BuiltInQueueContract<Tag extends QueueStoreTag> = StoreContractValue<
  {
    readonly event: StoreShapeDef<
      ReturnType<typeof queueEvent<QueueItemSchemaFromTag<Tag>>>,
      typeof queueEventReadPayload
    >;
  },
  {
    readonly record: (event: QueueEventOf<Tag>) => Effect.Effect<void, StoreWriteError>;
    readonly events: (
      payload?: { readonly limit?: number },
    ) => Effect.Effect<ReadonlyArray<QueueEventOf<Tag>>>;
  }
>;

/** @internal */
export const queueItemSchemaFromTag = <Tag extends QueueStoreTag>(
  tag: Tag,
): QueueItemSchemaFromTag<Tag> => {
  const addMethod = tag[specSym].add as {
    readonly payload?: {
      readonly members?: ReadonlyArray<Schema.Schema<unknown>>;
    };
  };
  const itemSchema = addMethod.payload?.members?.[0];
  if (itemSchema === undefined) {
    throw new Error(`QueueResource.store: tag ${tag.key} has no item schema on spec.add`);
  }
  return itemSchema as QueueItemSchemaFromTag<Tag>;
};

/**
 * Build the queue store contract from an item schema directly (no tag) — used by the engine, which
 * has the item schema but not always a tag (`QueueResource.make`). @internal
 */
export const makeQueueStoreContract = <Item extends Schema.Top>(itemSchema: Item) =>
  Store.contract(
    {
      event: Store.shape(queueEvent(itemSchema), queueEventReadPayload),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
    }),
  );

/**
 * Built-in queue store contract for a tag. Delegates to {@link makeQueueStoreContract} with the
 * tag's item schema. @internal
 */
export const builtInQueueStoreContract = <const Tag extends QueueStoreTag>(
  tag: Tag,
): BuiltInQueueContract<Tag> => makeQueueStoreContract(queueItemSchemaFromTag(tag));

/** @deprecated Internal flat spec — use {@link builtInQueueStoreContract}. @internal */
export const builtInQueueStoreSpec = (tag: QueueStoreTag) => builtInQueueStoreContract(tag).spec;

// ============================================================================
// Tier 2 — engine write-extension (semantic writes, all funnel to `event.append`)
// ============================================================================

/**
 * The decoded lifecycle-event union persisted for a tag — exactly what `event.read` /
 * `Store.changes` hand back (the same shape the live `.events` stream carries). @internal
 */
export type QueueStoreEvent<Tag extends QueueStoreTag> = SchemaDecoded<
  ReturnType<typeof queueEvent<QueueItemSchemaFromTag<Tag>>>
>;

/** A decoded queue entry as persisted on the event union (row of `Started`/`Completed`/…). @internal */
export type QueueStoreEntry<Tag extends QueueStoreTag> = Extract<
  QueueStoreEvent<Tag>,
  { readonly _tag: "Started" }
>["entry"];

/** The persisted `Failed` variant for a tag. @internal */
export type QueueStoreFailed<Tag extends QueueStoreTag> = Extract<
  QueueStoreEvent<Tag>,
  { readonly _tag: "Failed" }
>;

/** The persisted `Completed` variant for a tag. @internal */
export type QueueStoreCompleted<Tag extends QueueStoreTag> = Extract<
  QueueStoreEvent<Tag>,
  { readonly _tag: "Completed" }
>;

/**
 * Build the engine **write-extension** contract from an item schema (no tag) — the lean base
 * (`event` shape → `record` + `events`) plus narrow, semantic writes, each taking only its own
 * fields and funnelling to the shared `event.append`. Built with {@link Store.contract} (not
 * `Store.extend`) so the concrete write-method types survive onto the materialized effects object.
 * @internal
 */
export const makeEngineQueueStoreContract = <Item extends Schema.Top>(itemSchema: Item) => {
  // The decoded entry exactly as `event.append` expects it — the SAME `queueEntry(itemSchema)` the
  // event schema is built from (so no interface/schema drift under a generic item).
  type Entry = ReturnType<typeof queueEntry<Item>>["Type"];
  return Store.contract(
    {
      event: Store.shape(queueEvent(itemSchema), queueEventReadPayload),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
      enqueued: (entries: ReadonlyArray<Entry>, priority: Priority, batchId?: string) =>
        event.append({
          _tag: "Enqueued",
          entries,
          priority,
          ...(batchId !== undefined ? { batchId } : {}),
        }),
      started: (entry: Entry) => event.append({ _tag: "Started", entry }),
      completed: (entry: Entry, elapsed: Duration.Duration) =>
        event.append({ _tag: "Completed", entry, elapsed }),
      failed: (entry: Entry, cause: Cause.Cause<unknown>, elapsed: Duration.Duration) =>
        event.append({ _tag: "Failed", entry, cause, elapsed }),
      exited: (entry: Entry, exit: Exit.Exit<void, unknown>, elapsed: Duration.Duration) =>
        event.append({ _tag: "Exit", entry, exit, elapsed }),
      retryScheduled: (entry: Entry, cause: Cause.Cause<unknown>, nextAttempt: number) =>
        event.append({ _tag: "RetryScheduled", entry, cause, nextAttempt }),
      retryExhausted: (entry: Entry, cause: Cause.Cause<unknown>) =>
        event.append({ _tag: "RetryExhausted", entry, cause }),
    }),
  );
};

/**
 * The engine write-extension contract for a tag. The queue engine records through these narrow
 * writes (via {@link Store.effects} + {@link Store.catchWriteErrors}) instead of building a
 * `QueueEvent` object + generic `record`; queue-level facts without a narrow write (Start /
 * Drained / …) still ride the base `record` (a guarded append alias). @internal
 */
export const engineQueueStoreContract = <const Tag extends QueueStoreTag>(tag: Tag) =>
  makeEngineQueueStoreContract(queueItemSchemaFromTag(tag));

/** The engine write-extension contract type for a tag. @internal */
export type EngineQueueStoreContract<Tag extends QueueStoreTag> = ReturnType<
  typeof engineQueueStoreContract<Tag>
>;

// ============================================================================
// Tier 3 — advanced analytics read-extension (pure derivations over `event.read`)
// ============================================================================

/** Windowed lifetime counts derived from the event log. @internal */
export interface QueueStoreStats {
  readonly enqueued: number;
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly retried: number;
  readonly deadLettered: number;
}

/** Latency distribution (from `elapsed` on `Completed`/`Exit`). @internal */
export interface QueueStoreLatency {
  readonly mean: Duration.Duration;
  readonly p50: Duration.Duration;
  readonly p95: Duration.Duration;
  readonly p99: Duration.Duration;
  readonly max: Duration.Duration;
}

/**
 * The advanced analytics **read-extension** surfaced on `QueueResource.store(queue)` — all pure
 * derivations over the persisted event log (`event.read`), with the live `changes()` stream over
 * {@link Store.changes}. @internal
 */
export type QueueStoreReads<Tag extends QueueStoreTag> = {
  /** Every persisted `Failed` event, in order. */
  readonly failures: () => Effect.Effect<ReadonlyArray<QueueStoreFailed<Tag>>>;
  /** Entries dead-lettered (from `RetryExhausted`). */
  readonly deadLettered: () => Effect.Effect<ReadonlyArray<QueueStoreEntry<Tag>>>;
  /** `Started` entries with no later terminal (`Completed`/`Failed`/`Exit`) event. */
  readonly inFlight: () => Effect.Effect<ReadonlyArray<QueueStoreEntry<Tag>>>;
  /** All events referencing `entryId`, in order. */
  readonly history: (entryId: string) => Effect.Effect<ReadonlyArray<QueueStoreEvent<Tag>>>;
  /** The most recent `Failed` event, if any. */
  readonly lastFailure: () => Effect.Effect<Option.Option<QueueStoreFailed<Tag>>>;
  /** The `n` slowest `Completed` events by `elapsed` (descending). */
  readonly slowest: (n: number) => Effect.Effect<ReadonlyArray<QueueStoreCompleted<Tag>>>;
  /** The last `n` events. */
  readonly recent: (n: number) => Effect.Effect<ReadonlyArray<QueueStoreEvent<Tag>>>;
  /** Events whose entry was enqueued at/after `when`. */
  readonly since: (
    when: DateTime.DateTime,
  ) => Effect.Effect<ReadonlyArray<QueueStoreEvent<Tag>>>;
  /** Lifetime counts. */
  readonly stats: () => Effect.Effect<QueueStoreStats>;
  /** `failed / (completed + failed)`; `0` when the denominator is `0`. */
  readonly failureRate: () => Effect.Effect<number>;
  /** Latency distribution over `Completed`/`Exit` `elapsed`. */
  readonly latency: () => Effect.Effect<QueueStoreLatency>;
  /** Live decoded event stream (via {@link Store.changes}). */
  readonly changes: () => Stream.Stream<
    QueueStoreEvent<Tag>,
    StoreJournalDecodeError,
    Store.Storage
  >;
};

const eventEntryId = <Tag extends QueueStoreTag>(
  event: QueueStoreEvent<Tag>,
): string | undefined => ("entry" in event ? event.entry.entryId : undefined);

const eventTouchesEntry = <Tag extends QueueStoreTag>(
  event: QueueStoreEvent<Tag>,
  entryId: string,
): boolean => {
  if ("entry" in event) {
    return event.entry.entryId === entryId;
  }
  if ("entries" in event) {
    return event.entries.some((entry) => entry.entryId === entryId);
  }
  return false;
};

const eventEnqueuedAtMillis = <Tag extends QueueStoreTag>(
  event: QueueStoreEvent<Tag>,
): number | undefined => {
  if ("entry" in event) {
    return DateTime.toEpochMillis(event.entry.timestamps.enqueuedAt);
  }
  if ("entries" in event && event.entries.length > 0) {
    return Math.min(
      ...event.entries.map((entry) => DateTime.toEpochMillis(entry.timestamps.enqueuedAt)),
    );
  }
  return undefined;
};

const percentile = (sortedMs: ReadonlyArray<number>, p: number): number =>
  sortedMs[Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length))] ?? 0;

/**
 * Build the **read-extended** analytics contract for a queue tag — the lean base (`event` shape →
 * `record` + `events`) plus the advanced analytics reads ({@link QueueStoreReads}). Built with
 * {@link Store.contract} (not `Store.extend`) so the concrete read-method types survive onto the
 * resolved handle. Pure derivations close over the `event` shape's `read`; `changes()` resolves the
 * live journal stream via {@link Store.changes} on the base contract (whose `event` shape it
 * selects). @internal
 */
export const makeQueueStoreAnalyticsContract = <const Tag extends QueueStoreTag>(tag: Tag) => {
  const base = builtInQueueStoreContract(tag);
  const storeClass = { scopeKey: tag.key, contract: base };
  const isFailed = (event: QueueStoreEvent<Tag>): event is QueueStoreFailed<Tag> =>
    event._tag === "Failed";
  const isCompleted = (event: QueueStoreEvent<Tag>): event is QueueStoreCompleted<Tag> =>
    event._tag === "Completed";
  const isRetryExhausted = (
    event: QueueStoreEvent<Tag>,
  ): event is Extract<QueueStoreEvent<Tag>, { readonly _tag: "RetryExhausted" }> =>
    event._tag === "RetryExhausted";
  const isTerminal = (event: QueueStoreEvent<Tag>): boolean =>
    event._tag === "Completed" || event._tag === "Failed" || event._tag === "Exit";

  return Store.contract(
    {
      event: Store.shape(queueEvent(queueItemSchemaFromTag(tag)), queueEventReadPayload),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
      failures: (): Effect.Effect<ReadonlyArray<QueueStoreFailed<Tag>>> =>
        Effect.map(event.read(), (events) => events.filter(isFailed)),
      deadLettered: (): Effect.Effect<ReadonlyArray<QueueStoreEntry<Tag>>> =>
        Effect.map(event.read(), (events) =>
          events.filter(isRetryExhausted).map((e) => e.entry),
        ),
      inFlight: (): Effect.Effect<ReadonlyArray<QueueStoreEntry<Tag>>> =>
        Effect.map(event.read(), (events) => {
          const terminated = new Set<string>();
          for (const e of events) {
            if (isTerminal(e)) {
              const id = eventEntryId(e);
              if (id !== undefined) terminated.add(id);
            }
          }
          const out: Array<QueueStoreEntry<Tag>> = [];
          const seen = new Set<string>();
          for (const e of events) {
            if (
              e._tag === "Started" &&
              !terminated.has(e.entry.entryId) &&
              !seen.has(e.entry.entryId)
            ) {
              seen.add(e.entry.entryId);
              out.push(e.entry);
            }
          }
          return out;
        }),
      history: (entryId: string): Effect.Effect<ReadonlyArray<QueueStoreEvent<Tag>>> =>
        Effect.map(event.read(), (events) =>
          events.filter((e) => eventTouchesEntry(e, entryId)),
        ),
      lastFailure: (): Effect.Effect<Option.Option<QueueStoreFailed<Tag>>> =>
        Effect.map(event.read(), (events) => {
          const failures = events.filter(isFailed);
          return failures.length === 0
            ? Option.none()
            : Option.some(failures[failures.length - 1]!);
        }),
      slowest: (n: number): Effect.Effect<ReadonlyArray<QueueStoreCompleted<Tag>>> =>
        Effect.map(event.read(), (events) =>
          [...events.filter(isCompleted)]
            .sort((a, b) => Duration.toMillis(b.elapsed) - Duration.toMillis(a.elapsed))
            .slice(0, Math.max(0, n)),
        ),
      recent: (n: number): Effect.Effect<ReadonlyArray<QueueStoreEvent<Tag>>> =>
        Effect.map(event.read(), (events) =>
          n <= 0 ? [] : events.slice(Math.max(0, events.length - n)),
        ),
      since: (
        when: DateTime.DateTime,
      ): Effect.Effect<ReadonlyArray<QueueStoreEvent<Tag>>> =>
        Effect.map(event.read(), (events) => {
          const cutoff = DateTime.toEpochMillis(when);
          return events.filter((e) => {
            const at = eventEnqueuedAtMillis(e);
            return at !== undefined && at >= cutoff;
          });
        }),
      stats: (): Effect.Effect<QueueStoreStats> =>
        Effect.map(event.read(), (events) => {
          let enqueued = 0;
          let started = 0;
          let completed = 0;
          let failed = 0;
          let retried = 0;
          let deadLettered = 0;
          for (const e of events) {
            switch (e._tag) {
              case "Enqueued":
                enqueued += e.entries.length;
                break;
              case "Started":
                started += 1;
                break;
              case "Completed":
                completed += 1;
                break;
              case "Failed":
                failed += 1;
                break;
              case "RetryScheduled":
                retried += 1;
                break;
              case "RetryExhausted":
                deadLettered += 1;
                break;
              default:
                break;
            }
          }
          return { enqueued, started, completed, failed, retried, deadLettered };
        }),
      failureRate: (): Effect.Effect<number> =>
        Effect.map(event.read(), (events) => {
          let completed = 0;
          let failed = 0;
          for (const e of events) {
            if (e._tag === "Completed") completed += 1;
            else if (e._tag === "Failed") failed += 1;
          }
          const total = completed + failed;
          return total === 0 ? 0 : failed / total;
        }),
      latency: (): Effect.Effect<QueueStoreLatency> =>
        Effect.map(event.read(), (events) => {
          const durationsMs: Array<number> = [];
          for (const e of events) {
            if (e._tag === "Completed" || e._tag === "Exit") {
              durationsMs.push(Duration.toMillis(e.elapsed));
            }
          }
          if (durationsMs.length === 0) {
            return {
              mean: Duration.zero,
              p50: Duration.zero,
              p95: Duration.zero,
              p99: Duration.zero,
              max: Duration.zero,
            };
          }
          const sorted = [...durationsMs].sort((a, b) => a - b);
          const mean = durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length;
          return {
            mean: Duration.millis(mean),
            p50: Duration.millis(percentile(sorted, 50)),
            p95: Duration.millis(percentile(sorted, 95)),
            p99: Duration.millis(percentile(sorted, 99)),
            max: Duration.millis(sorted[sorted.length - 1]!),
          };
        }),
      changes: (): Stream.Stream<
        QueueStoreEvent<Tag>,
        StoreJournalDecodeError,
        Store.Storage
      > => Stream.unwrap(Store.changes(storeClass, (shapes) => shapes.event)),
    }),
  );
};

/** The read-extended analytics contract type for a tag. @internal */
export type QueueStoreAnalyticsContract<Tag extends QueueStoreTag> = ReturnType<
  typeof makeQueueStoreAnalyticsContract<Tag>
>;
