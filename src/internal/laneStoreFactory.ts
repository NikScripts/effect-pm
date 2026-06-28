/**
 * @module internal/laneStoreFactory
 *
 * Resolves a {@link LaneStore} factory from queue config. The priority path is static; scheduled
 * algorithms load via dynamic import so the default bundle stays lean.
 *
 * @internal
 */
import { Effect } from "effect";
import type { LaneStore } from "./laneStore";
import { makeLevelLaneStorePriority } from "./levelLaneStorePriority";
import type { TakeAlgorithm } from "./takeAlgorithm";

/** Lane-store inputs derived from queue config. @internal */
export interface LaneStoreConfig {
  readonly levelCount?: number;
  readonly takeAlgorithm?: TakeAlgorithm;
}

/**
 * Build `(capacity) => LaneStore` for the given config.
 *
 * - `"priority"` (default) → {@link levelLaneStorePriority} only (tree-shakeable).
 * - `"weighted"` / `"strict-descending"` / custom pick → dynamic import of
 *   {@link levelLaneStoreScheduled}.
 *
 * @internal
 */
export const laneStoreFactoryFromConfig = <A>(
  config: LaneStoreConfig,
): ((capacity: number) => Effect.Effect<LaneStore<A>>) => {
  const levelCount = config.levelCount ?? 3;
  const takeAlgorithm = config.takeAlgorithm ?? "priority";

  if (takeAlgorithm === "priority") {
    return (capacity) => makeLevelLaneStorePriority({ levelCount, capacity });
  }

  return (capacity: number): Effect.Effect<LaneStore<A>> =>
    Effect.gen(function* () {
      const mod = yield* Effect.promise(() => import("./levelLaneStoreScheduled.js"));
      return yield* mod.makeLevelLaneStoreScheduled<A>({
        levelCount,
        capacity,
        takeAlgorithm,
      });
    });
};
