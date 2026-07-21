/**
 * **DurableQueueStore** — the *durability plane* of a `QueueResource`: a priority-native store of
 * pending + in-flight work, so no enqueued item is lost across a restart (**at-least-once** +
 * dedup key). This is the abstract port; backends live behind it (SQLite today —
 * `@nikscripts/effect-pm/storage/sqlite`). Inspired by Effect's `PersistedQueue` (we lift its
 * lease / `attempts` / expiry-recovery blueprint) but priority-native, not FIFO — see
 * `docs/handoffs/queue-persistence-design.md`.
 *
 * Deliberately separate from the *observability plane* ({@link HistoryStore} — metrics/logs
 * history): durability is the hot-path source of truth (tiny, fast, scan-pending boot),
 * observability is fat append-only history off the hot path. You can run either alone.
 *
 * Semantics — **at-least-once + dedup key**: on crash, in-flight (lease-expired) entries are
 * redelivered; supply a `dedupKey` (or write an idempotent effect) to avoid double work.
 *
 * @module DurableQueueStore
 */
import { Context, Data, type Effect, type Option } from "effect";

/**
 * Queue priority lane (strict: high before normal before low).
 *
 * @category models
 * @public
 */
export type DurablePriority = "high" | "normal" | "low";

/**
 * Numeric rank for ordering (lower = sooner).
 *
 * @category utils
 * @public
 */
export const durablePriorityRank: Record<DurablePriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

/**
 * An item offered to the store. `payload` is opaque encoded JSON (the caller owns the schema).
 *
 * @category models
 * @public
 */
export interface DurableEntryInput {
  /** Opaque per-entry handle (not the dedup key). */
  readonly id: string;
  /** Which queue registration key this belongs to (one backend can hold many). */
  readonly key: string;
  /** Dedup key — unique among *live* (pending/in-flight) entries; absent = never deduped. */
  readonly dedupKey?: string;
  readonly priority: DurablePriority;
  /** Already-encoded JSON payload. */
  readonly payload: unknown;
  /** Schema version stamped on the row, for decode/upcast on take. */
  readonly schemaVersion?: number;
}

/**
 * A leased entry returned by {@link DurableQueueStoreShape.take}.
 *
 * @category models
 * @public
 */
export interface DurableEntry {
  readonly id: string;
  readonly key: string;
  readonly dedupKey: string | null;
  readonly priority: DurablePriority;
  readonly sequence: number;
  readonly attempts: number;
  readonly payload: unknown;
  readonly schemaVersion: number;
  readonly enqueuedAtMillis: number;
}

/**
 * Outcome of {@link DurableQueueStoreShape.offer}.
 *
 * @category models
 * @public
 */
export type OfferResult = "inserted" | "escalated" | "deduplicated";

/**
 * Outcome of {@link DurableQueueStoreShape.fail}.
 *
 * @category models
 * @public
 */
export type FailResult = "requeued" | "deadLettered";

/**
 * Per-priority pending counts.
 *
 * @category models
 * @public
 */
export interface DurableSizes {
  readonly high: number;
  readonly normal: number;
  readonly low: number;
}

/**
 * A backend failure (wraps the underlying driver error).
 *
 * @category errors
 * @public
 */
export class DurableQueueError extends Data.TaggedError(
  "@nikscripts/effect-pm/DurableQueueError",
)<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

/**
 * The durable store port. All operations are backend-agnostic; a backend (SQLite, …) provides the
 * concrete implementation.
 *
 * @category models
 * @public
 */
export interface DurableQueueStoreShape {
  /**
   * Persist a pending entry. Dedups on `dedupKey` among live entries (`inserted` vs
   * `deduplicated`); if a live entry with that key exists at a *lower* priority, raises it
   * (`escalated`).
   */
  readonly offer: (
    entry: DurableEntryInput,
  ) => Effect.Effect<OfferResult, DurableQueueError>;
  /**
   * Atomically lease the top-priority available entry (FIFO within a priority), bumping
   * `attempts` and setting a lease (`leaseMillis`). `None` if nothing is available.
   */
  readonly take: (options: {
    readonly key: string;
    readonly leaseMillis: number;
  }) => Effect.Effect<Option.Option<DurableEntry>, DurableQueueError>;
  /** Acknowledge success — remove the entry. */
  readonly complete: (id: string) => Effect.Effect<void, DurableQueueError>;
  /**
   * Negative-ack — requeue (clear the lease) for retry, or dead-letter once `attempts` reaches
   * `maxAttempts`.
   */
  readonly fail: (
    id: string,
    options: { readonly maxAttempts: number },
  ) => Effect.Effect<FailResult, DurableQueueError>;
  /** Pending counts per priority (in-flight included). */
  readonly sizes: (
    key: string,
  ) => Effect.Effect<DurableSizes, DurableQueueError>;
  /**
   * Reclaim work whose lease has expired (`locked_until < now`) — the at-least-once recovery used
   * on boot/restart. Returns the count reclaimed.
   */
  readonly recover: (key: string) => Effect.Effect<number, DurableQueueError>;
  /** Delete all pending (incl. in-flight) entries for a queue. Returns the count removed. */
  readonly clear: (key: string) => Effect.Effect<number, DurableQueueError>;
  /**
   * Remove and return **available** (not in-flight) backlog entries matching `id` or `key` (all if
   * neither given). Powers the durable `release` / `deadLetter` / `drop` control verbs. In-flight
   * (leased) work is left untouched — it can't be selector-targeted while a worker holds it.
   */
  readonly drain: (
    key: string,
    match: { readonly id?: string; readonly key?: string },
  ) => Effect.Effect<ReadonlyArray<DurableEntry>, DurableQueueError>;
}

/**
 * Durable queue store — the priority-native durability plane. `yield* DurableQueueStore` for the
 * service; provide a backend (e.g. `SQLiteDurableQueueStore.layer` from
 * `@nikscripts/effect-pm/storage/sqlite`).
 *
 * @category context
 * @public
 */
export class DurableQueueStore extends Context.Service<
  DurableQueueStore,
  DurableQueueStoreShape
>()("@nikscripts/effect-pm/DurableQueueStore") {}
