/**
 * @module internal/laneStore
 *
 * Minimal {@link LaneStore} protocol behind the queue engine. Numeric levels only; take order is
 * owned entirely by each implementation's `poll`. The engine imports this **type-only** so the
 * default bundle never pulls scheduled/weighted code unless config selects it.
 *
 * @internal
 */
import type { Effect, Option } from "effect";

/** Per-level occupancy; index `i` is level `i`. @internal */
export type LevelSizes = ReadonlyArray<number>;

/**
 * N bounded FIFO lanes + opaque `poll`. The engine calls `offer(item, level)` and reads `sizes`.
 *
 * @internal
 */
export interface LaneStore<A> {
  /** Enqueue into `level` (0 … levelCount − 1). May backpressure when bounded. */
  readonly offer: (item: A, level: number) => Effect.Effect<void>;
  /** Non-blocking take; `none` when every level is empty. */
  readonly poll: Effect.Effect<Option.Option<A>>;
  readonly isEmpty: Effect.Effect<boolean>;
  readonly sizes: Effect.Effect<LevelSizes>;
  /** Remove all items (level 0, then 1, …). */
  readonly drain: Effect.Effect<ReadonlyArray<A>>;
  readonly extractMatching: (
    predicate: (item: A) => boolean,
  ) => Effect.Effect<ReadonlyArray<A>>;
}
