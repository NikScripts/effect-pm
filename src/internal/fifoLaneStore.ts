/**
 * @module internal/fifoLaneStore
 *
 * The classic strict 3-level {@link LaneStore} — high / normal / low, each a bounded Effect
 * {@link Queue} (so `offer` backpressures when full). `poll` takes high first, then normal, then
 * low (strict priority). This is the default queue's lane structure, extracted behind the
 * {@link LaneStore} seam so the shared engine core carries neither this nor the weighted/STM impl.
 *
 * The middle tier is a single lane: `offer(item, { group })` ignores the number and routes to
 * `normal`; `sizes.middle` reports it under key `0`.
 *
 * @internal
 */
import { Effect, Option, Queue } from "effect";
import type { Lane, LaneSizes, LaneStore } from "./laneStore";

/** The FIFO middle is one lane; report/route it under this group key. */
const NORMAL_GROUP = 0;

/**
 * Build a strict 3-level FIFO {@link LaneStore}. `capacity` bounds each lane (backpressure on
 * `offer`), matching the engine's historical `Queue.bounded(capacity)` lanes.
 *
 * @internal
 */
export const makeFifoLaneStore = <A>(options: {
  readonly capacity: number;
}): Effect.Effect<LaneStore<A>> =>
  Effect.gen(function* () {
    const high = yield* Queue.bounded<A>(options.capacity);
    const normal = yield* Queue.bounded<A>(options.capacity);
    const low = yield* Queue.bounded<A>(options.capacity);

    const laneFor = (lane: Lane): Queue.Queue<A> =>
      lane === "high" ? high : lane === "low" ? low : normal;

    const sizeOf = (q: Queue.Queue<A>): Effect.Effect<number> =>
      Effect.map(Queue.size(q), (n) => Math.max(0, n));

    const offer = (item: A, lane: Lane): Effect.Effect<void> =>
      Queue.offer(laneFor(lane), item);

    const poll: Effect.Effect<Option.Option<A>> = Effect.gen(function* () {
      const hi = yield* Queue.poll(high);
      if (Option.isSome(hi)) return hi;
      const no = yield* Queue.poll(normal);
      if (Option.isSome(no)) return no;
      return yield* Queue.poll(low);
    });

    const isEmpty: Effect.Effect<boolean> = Effect.gen(function* () {
      const h = yield* sizeOf(high);
      const n = yield* sizeOf(normal);
      const l = yield* sizeOf(low);
      return h + n + l === 0;
    });

    const sizes: Effect.Effect<LaneSizes> = Effect.gen(function* () {
      const h = yield* sizeOf(high);
      const n = yield* sizeOf(normal);
      const l = yield* sizeOf(low);
      const middle: Record<number, number> = {};
      if (n > 0) middle[NORMAL_GROUP] = n;
      return { high: h, low: l, middle };
    });

    /** Drain a single lane into `out`, optionally keeping (re-offering) items that fail `take`. */
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
      yield* drainLane(high, (i) => (out.push(i), true));
      yield* drainLane(normal, (i) => (out.push(i), true));
      yield* drainLane(low, (i) => (out.push(i), true));
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
            return true; // consumed (not re-offered)
          }
          return false; // kept
        };
        yield* drainLane(high, take);
        yield* drainLane(normal, take);
        yield* drainLane(low, take);
        return matched;
      });

    return { offer, poll, isEmpty, sizes, drain, extractMatching };
  });
