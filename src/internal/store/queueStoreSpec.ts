/**
 * Built-in {@link QueueResource} store contract.
 *
 * The store persists the **same** `QueueEvent<T>` union the engine already publishes on the live
 * `.events` stream (one event model for wire + persistence — `queue-persistence-design.md`), using
 * the shared `queueEvent(itemSchema, { success, error })` schema (the tag's `success` / `error` wire
 * slots fed in) as the codec. So the handle is just `record` (append a built event) + `events` (read
 * them back) — no event model of its own, no object-literal construction against a schema-decoded
 * generic (which is what forced casts / collapsed hovers).
 *
 * @module internal/store/queueStoreSpec
 * @internal
 */

import { DateTime, Duration, Effect, Option, pipe, Schema, Stream } from "effect";
import type { ResourceTag, Spec, SpecOf } from "../../Resource";
import { specSym } from "../../Resource";
import { buildQueueEvent, queueEntry, queueSpec } from "../../QueueResource";
import type { QueueEventSchema, QueueSuccessSchemaOf } from "../../QueueResource";
import { successOf, errorOf } from "../queueTagSchemas";
import type { Priority, QueueEvent } from "../queueResource";
import * as Store from "../../Store";
import type {
  CatchWriteError,
  Storage,
  StoreEffectsOf,
  StoreProvidedContext,
} from "../../Store";
import type {
  SchemaDecoded,
  StoreContractValue,
  StoreShapeDef,
} from "./contractDef";
import type { StoreJournalDecodeError, StoreWriteError } from "./errors";
import { withImplicitLogShape } from "./logShapes";
import type { StoreScopeTag } from "./registration";

/** Queue tag shape for store registration — `specSym` carries the flat wire spec. @internal */
export interface QueueStoreTag extends StoreScopeTag {
  readonly [specSym]: Record<string, unknown>;
}

/** Spec of a queue instance whose item is `Schema.Struct<F>` (its `success`/`error` wire slots are
 *  irrelevant to item extraction, so they stay defaulted here). @internal */
type QueueInstanceSpec<
  F extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
> = ReturnType<typeof queueSpec<F, Success, Error>>;

/** Nested spec recovered from a queue tag class. @internal */
type QueueSpecFromTag<Tag extends QueueStoreTag> = SpecOf<Tag & ResourceTag<unknown, Spec>>;

/** Struct fields of the queue item from a tag — matched independently of the tag's `success`/`error`
 *  wire slots (a threaded `QueueInstanceSpec<F, Success, Error>` still yields `F`). @internal */
type QueueItemFields<Tag extends QueueStoreTag> =
  QueueSpecFromTag<Tag> extends QueueInstanceSpec<
    infer F extends Schema.Struct.Fields,
    infer _Success extends Schema.Top,
    infer _Error extends Schema.Top
  >
    ? F
    : never;

/**
 * The worker `success` **schema** carried on a queue tag — recovered from the phantom
 * {@link QueueSuccessCarrier} intersected onto the tag (the SSOT for the typed success value `A`).
 * @internal
 */
export type QueueSuccessSchemaFromTag<Tag extends QueueStoreTag> = QueueSuccessSchemaOf<Tag>;

/** Item row schema carried on a {@link QueueResource} tag (from `QueueInstanceSpec<F>`). @internal */
export type QueueItemSchemaFromTag<Tag extends QueueStoreTag> = Schema.Struct<QueueItemFields<Tag>>;

/** Item value type carried on a queue tag. @internal */
export type QueueItemOf<Tag extends QueueStoreTag> = Schema.Struct<QueueItemFields<Tag>>["Type"];

/** The worker `success` value type (`A`) carried on a queue tag (default `void`). @internal */
export type QueueSuccessOf<Tag extends QueueStoreTag> = QueueSuccessSchemaFromTag<Tag>["Type"];

/**
 * The persisted queue event **schema** for a tag — the shared `queueEvent` union built with the
 * **erased** (`Schema.Top`) success/error slots. The success schema is kept concrete-erased here
 * (not the tag's generic success schema) because Effect's `.Type` reduction does not collapse a
 * `Schema.Union` that carries a *generic* field, which would break every `SchemaDecoded`/`event.append`
 * downstream. The typed success value `A` is layered back on at the **decoded** level via
 * {@link QueueStoreCompleted} (a type-level override; the runtime value genuinely is `A`). @internal
 */
export type QueueEventSchemaOf<Tag extends QueueStoreTag> = QueueEventSchema<
  QueueItemSchemaFromTag<Tag>,
  Schema.Top,
  Schema.Top
>;

/**
 * The persisted queue event for a tag — the same union the live `.events` stream carries. The
 * base `record` / `events` surface stays **erased** (`success: unknown`); the typed success value
 * `A` is layered on only the analytics read {@link QueueStoreCompleted}. @internal
 */
export type QueueEventOf<Tag extends QueueStoreTag> = QueueEvent<
  QueueItemOf<Tag>,
  unknown,
  unknown
>;

/**
 * The `success` / `error` wire schemas for the store event schema — kept **erased** to `Schema.Top`
 * at the schema level (typed success rides `QueueStoreCompleted` at the decoded level, see
 * {@link QueueEventSchemaOf}). @internal
 */
type QueueWireSchemas = {
  readonly success?: Schema.Top;
  readonly error?: Schema.Top;
};

/** Read the `success` / `error` wire slots off a queue tag for the store event schema. @internal */
const queueWireFromTag = (tag: QueueStoreTag): QueueWireSchemas => ({
  success: successOf(tag),
  error: errorOf(tag),
});

/** Built-in queue store contract for a tag — one `event` shape over the shared event schema. @internal */
export type BuiltInQueueContract<Tag extends QueueStoreTag> = StoreContractValue<
  {
    readonly event: StoreShapeDef<QueueEventSchemaOf<Tag>>;
  },
  {
    readonly record: (event: QueueEventOf<Tag>) => Effect.Effect<void, StoreWriteError>;
    readonly events: (
      payload?: Store.StoreReadPayload<QueueEventOf<Tag>>,
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
      readonly elements?: ReadonlyArray<{
        readonly members: ReadonlyArray<Schema.Schema<unknown>>;
      }>;
    };
  };
  const itemSchema =
    addMethod.payload?.members?.[0] ??
    addMethod.payload?.elements?.[0]?.members?.[0];
  if (itemSchema === undefined) {
    throw new Error(
      `Queue store: tag ${tag.key} has no item schema on spec.add (expected union or pair payload)`,
    );
  }
  return itemSchema as QueueItemSchemaFromTag<Tag>;
};

/**
 * Build the queue store contract from an item schema directly (no tag) — used by the engine, which
 * has the item schema but not always a tag (`QueueResource.make`). @internal
 */
export const makeQueueStoreContract = <Item extends Schema.Top>(
  itemSchema: Item,
  wire?: QueueWireSchemas,
) =>
  Store.contract(
    {
      event: Store.shape(
        buildQueueEvent(
          itemSchema,
          wire?.success ?? Schema.Void,
          wire?.error ?? Schema.Unknown,
        ),
      ),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
    }),
  );

/**
 * Built-in queue store contract for a tag. Delegates to {@link makeQueueStoreContract} with the
 * tag's item schema and its `success` / `error` wire slots (the tag SSOT). @internal
 */
export const builtInQueueStoreContract = <const Tag extends QueueStoreTag>(
  tag: Tag,
): BuiltInQueueContract<Tag> =>
  makeQueueStoreContract(queueItemSchemaFromTag(tag), queueWireFromTag(tag));

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
  QueueEventSchemaOf<Tag>
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

/**
 * The persisted `Completed` variant for a tag, with `success` typed as the tag's worker success
 * value `A` (recovered from the tag's spec). The persisted **schema** is erased (see
 * {@link QueueEventSchemaOf}), so `success` is re-typed here at the decoded level; the runtime value
 * genuinely is `A` (the engine records `exit.value`), so the `isCompleted` guard narrows the erased
 * `unknown` success to this `A` subtype without a cast. @internal
 */
export type QueueStoreCompleted<Tag extends QueueStoreTag> = Omit<
  Extract<QueueStoreEvent<Tag>, { readonly _tag: "Completed" }>,
  "success"
> & { readonly success: QueueSuccessOf<Tag> };

/**
 * Build the engine **write-extension** contract from an item schema (no tag) — the lean base
 * (`event` shape → `record` + `events`) {@link Store.extend}ed with narrow, semantic writes, each
 * taking only its own fields and funnelling to the shared `event.append`. Because `extend` is fed
 * the `base` alongside its methods builder, the concrete write-method types survive onto the
 * materialized effects object (see the concrete-preservation guarantee on {@link Store.extend}).
 * @internal
 */
export const makeEngineQueueStoreContract = <Item extends Schema.Top>(
  itemSchema: Item,
  wire?: QueueWireSchemas,
) => {
  const eventSchema = buildQueueEvent(
    itemSchema,
    wire?.success ?? Schema.Void,
    wire?.error ?? Schema.Unknown,
  );
  // The decoded entry exactly as `event.append` expects it — the SAME `queueEntry(itemSchema)` the
  // event schema is built from (so no interface/schema drift under a generic item).
  type Entry = ReturnType<typeof queueEntry<Item>>["Type"];
  // The worker success / failure-cause types read straight off the built (erased) event schema. The
  // engine passes the concrete typed value through `QueueStoreWriter<T, E, A>` at the call site, which
  // is assignable to this `unknown` success (the typed `A` is layered on the decoded read side).
  type SuccessValue = Extract<
    typeof eventSchema.Type,
    { readonly _tag: "Completed" }
  >["success"];
  type FailCause = Extract<
    typeof eventSchema.Type,
    { readonly _tag: "Failed" }
  >["cause"];
  const base = Store.contract(
    {
      event: Store.shape(eventSchema),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
    }),
  );
  return Store.extend(
    ({ event }) => ({
      enqueued: (entries: ReadonlyArray<Entry>, priority: Priority, batchId?: string) =>
        event.append({
          _tag: "Enqueued",
          entries,
          priority,
          ...(batchId !== undefined ? { batchId } : {}),
        }),
      started: (entry: Entry) => event.append({ _tag: "Started", entry }),
      completed: (entry: Entry, success: SuccessValue, elapsed: Duration.Duration) =>
        event.append({ _tag: "Completed", entry, success, elapsed }),
      failed: (entry: Entry, cause: FailCause, elapsed: Duration.Duration) =>
        event.append({ _tag: "Failed", entry, cause, elapsed }),
      retryScheduled: (entry: Entry, cause: FailCause, nextAttempt: number) =>
        event.append({ _tag: "RetryScheduled", entry, cause, nextAttempt }),
      retryExhausted: (entry: Entry, cause: FailCause) =>
        event.append({ _tag: "RetryExhausted", entry, cause }),
    }),
    base,
  );
};

/**
 * The engine write-extension contract for a tag. The queue engine records through these narrow
 * writes (via {@link Store.effects} + {@link Store.catchWriteErrors}) instead of building a
 * `QueueEvent` object + generic `record`; queue-level facts without a narrow write (Start /
 * Drained / …) still ride the base `record` (a guarded append alias). @internal
 */
export const engineQueueStoreContract = <const Tag extends QueueStoreTag>(tag: Tag) =>
  makeEngineQueueStoreContract(queueItemSchemaFromTag(tag), queueWireFromTag(tag));

/** The engine write-extension contract type for a tag. @internal */
export type EngineQueueStoreContract<Tag extends QueueStoreTag> = ReturnType<
  typeof engineQueueStoreContract<Tag>
>;

/**
 * Storage-free engine store handle — SSOT derived from {@link makeEngineQueueStoreContract} after
 * {@link Store.catchWriteErrors} + {@link Store.provideContext}. Shared by {@link QueueResource} and
 * {@link CustomQueueResource} engines. @internal
 */
export type MaterializedEngineQueueStore<Item extends Schema.Top> = StoreProvidedContext<
  CatchWriteError<StoreEffectsOf<ReturnType<typeof makeEngineQueueStoreContract<Item>>>>,
  Storage
>;

/**
 * Materialize engine queue store effects for a scope + item schema (multi-engine path — no tag).
 * @internal
 */
export const materializeEngineQueueStoreForItem = <Item extends Schema.Top>(
  scopeKey: string,
  itemSchema: Item,
  wire?: QueueWireSchemas,
): Effect.Effect<MaterializedEngineQueueStore<Item>, never, Storage> =>
  Effect.gen(function* () {
    const contract = makeEngineQueueStoreContract(itemSchema, wire);
    // Fail-loud Soft: incomplete AppStore dies at layer build (Queue + CustomQueue).
    yield* Store.resolveOrDie(scopeKey, contract);
    const storageContext = yield* Effect.context<Storage>();
    const storeEffects = pipe(
      Store.effects(scopeKey, contract),
      Store.catchWriteErrors,
    );
    return Store.provideContext(storeEffects, storageContext);
  });

/**
 * Materialize engine queue store effects for a toolkit tag (wire slots from tag SSOT).
 * @internal
 */
export const materializeEngineQueueStoreForTag = <const Tag extends QueueStoreTag>(
  tag: Tag,
): Effect.Effect<
  MaterializedEngineQueueStore<QueueItemSchemaFromTag<Tag>>,
  never,
  Storage
> =>
  materializeEngineQueueStoreForItem(
    tag.key,
    queueItemSchemaFromTag(tag),
    queueWireFromTag(tag),
  );

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

/** Latency distribution (from `elapsed` on `Completed`). @internal */
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
  /** `Started` entries with no later terminal (`Completed`/`Failed`) event. */
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
  /** Latency distribution over `Completed` `elapsed`. */
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
 * `record` + `events`) {@link Store.extend}ed with the advanced analytics reads
 * ({@link QueueStoreReads}). Because `extend` is fed the `base` alongside its methods builder, the
 * concrete read-method types survive onto the resolved handle (see the concrete-preservation
 * guarantee on {@link Store.extend}). Pure derivations close over the `event` shape's `read`;
 * `changes()` resolves the live journal stream via {@link Store.changes} on the base contract
 * (whose `event` shape it selects). @internal
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
    event._tag === "Completed" || event._tag === "Failed";

  return withImplicitLogShape(
    Store.extend(
    ({ event }) => ({
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
            if (e._tag === "Completed") {
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
    base,
    ),
  );
};

/** The read-extended analytics contract type for a tag. @internal */
export type QueueStoreAnalyticsContract<Tag extends QueueStoreTag> = ReturnType<
  typeof makeQueueStoreAnalyticsContract<Tag>
>;
