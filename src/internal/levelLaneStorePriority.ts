/**
 * N-level {@link LaneStore} with **priority** take (lowest level index first). Effect `Queue` only —
 * the default-queue code path; no scheduler state.
 *
 * @internal
 */
import { Effect, Option, Queue } from "effect";
import type { LaneStore, LaneSizes } from "./laneStore";

const clampLevel = (level: number, laneCount: number): number =>
  Math.min(laneCount - 1, Math.max(0, Math.floor(level)));

/**
 * Build an N-level lane store with strict index priority (`poll` tries 0, then 1, …).
 *
 * @internal
 */
export const makeLevelLaneStorePriority = <A>(options: {
  readonly laneCount: number;
  readonly capacity: number;
}): Effect.Effect<LaneStore<A>> =>
  Effect.gen(function* () {
    const laneCount = Math.max(1, Math.floor(options.laneCount));
    const queues: Array<Queue.Queue<A>> = [];
    for (let i = 0; i < laneCount; i++) {
      queues.push(yield* Queue.bounded<A>(options.capacity));
    }

    const sizeOf = (q: Queue.Queue<A>): Effect.Effect<number> =>
      Effect.map(Queue.size(q), (n) => Math.max(0, n));

    const offer = (item: A, level: number): Effect.Effect<void> =>
      Queue.offer(queues[clampLevel(level, laneCount)]!, item);

    const poll: Effect.Effect<Option.Option<A>> = Effect.gen(function* () {
      for (let i = 0; i < laneCount; i++) {
        const item = yield* Queue.poll(queues[i]!);
        if (Option.isSome(item)) return item;
      }
      return Option.none();
    });

    const isEmpty: Effect.Effect<boolean> = Effect.gen(function* () {
      for (let i = 0; i < laneCount; i++) {
        if ((yield* sizeOf(queues[i]!)) > 0) return false;
      }
      return true;
    });

    const sizes: Effect.Effect<LaneSizes> = Effect.gen(function* () {
      const out: number[] = [];
      for (let i = 0; i < laneCount; i++) {
        out.push(yield* sizeOf(queues[i]!));
      }
      return out;
    });

    const drainLane = (
      q: Queue.Queue<A>,
      onItem: (item: A) => boolean,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const kept: A[] = [];
        let polled = yield* Queue.poll(q);
        while (Option.isSome(polled)) {
          if (!onItem(polled.value)) kept.push(polled.value);
          polled = yield* Queue.poll(q);
        }
        if (kept.length > 0) yield* Queue.offerAll(q, kept);
      });

    const drain: Effect.Effect<ReadonlyArray<A>> = Effect.gen(function* () {
      const out: A[] = [];
      for (let i = 0; i < laneCount; i++) {
        yield* drainLane(queues[i]!, (item) => (out.push(item), true));
      }
      return out;
    });

    const extractMatching = (
      predicate: (item: A) => boolean,
    ): Effect.Effect<ReadonlyArray<A>> =>
      Effect.gen(function* () {
        const matched: A[] = [];
        const take = (item: A): boolean => {
          if (predicate(item)) {
            matched.push(item);
            return true;
          }
          return false;
        };
        for (let i = 0; i < laneCount; i++) {
          yield* drainLane(queues[i]!, take);
        }
        return matched;
      });

    return { offer, poll, isEmpty, sizes, drain, extractMatching };
  });
