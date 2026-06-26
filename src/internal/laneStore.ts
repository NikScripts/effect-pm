/**
 * @module internal/laneStore
 *
 * The `LaneStore` seam: the **only** lane-specific part of the queue engine. The shared engine core
 * (worker pool, retries, metrics, persistence, lifecycle, …) is parameterized over this interface
 * and imports it **type-only** — so a bundle that uses the default FIFO queue never pulls the
 * weighted/STM scheduler, and vice versa. Two implementations:
 *
 * - {@link "internal/fifoLaneStore"} — the classic strict 3-level queue (high/normal/low),
 * - {@link "internal/weightedLaneStore"} — strict high/low + weighted numeric middle groups.
 *
 * It is **poll-based, not blocking**: the engine owns the worker-wake/shutdown/drain machinery
 * (which is entangled with lifecycle), so a `LaneStore` only needs to offer, non-blocking poll in
 * priority order, report occupancy, and drain/extract for clear/release/dead-letter.
 *
 * @internal
 */
import type { Effect, Option } from "effect";

/**
 * Where an offered item goes. The middle is keyed by a `group` number — for the FIFO store that
 * number is ignored (one middle lane); for the weighted store it is the group **and its weight**.
 *
 * @internal
 */
export type Lane = "high" | "low" | { readonly group: number };

/**
 * Per-lane occupancy. `middle` is keyed by group number (the FIFO store reports its single middle
 * lane under one key). The engine maps this onto each resource's public `sizes` shape.
 *
 * @internal
 */
export interface LaneSizes {
  readonly high: number;
  readonly low: number;
  readonly middle: Record<number, number>;
}

/**
 * The lane data structure behind a queue. Implementations differ only in the middle tier's storage
 * and selection; high/low are always strict (high first, low last).
 *
 * @internal
 */
export interface LaneStore<A> {
  /** Enqueue `item` into a lane (FIFO within the lane/group). May backpressure when bounded. */
  readonly offer: (item: A, lane: Lane) => Effect.Effect<void>;
  /** Non-blocking take of the next item by tier + middle schedule; `none` when empty. */
  readonly poll: Effect.Effect<Option.Option<A>>;
  /** Whether every lane is empty (cheap; for drain detection). */
  readonly isEmpty: Effect.Effect<boolean>;
  /** Current per-lane occupancy. */
  readonly sizes: Effect.Effect<LaneSizes>;
  /** Remove and return every queued item (high, then middle by group ascending, then low). */
  readonly drain: Effect.Effect<ReadonlyArray<A>>;
  /**
   * Remove and return every item matching `predicate`, leaving non-matching items in place
   * (order preserved). For clear-by-selector / release / dead-letter.
   */
  readonly extractMatching: (
    predicate: (item: A) => boolean,
  ) => Effect.Effect<ReadonlyArray<A>>;
}
