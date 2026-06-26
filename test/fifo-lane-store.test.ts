import { describe, it, assert } from "@effect/vitest";
import { Effect, Option } from "effect";
import { makeFifoLaneStore } from "../src/internal/fifoLaneStore";
import type { LaneStore } from "../src/internal/laneStore";

const next = <A>(store: LaneStore<A>): Effect.Effect<A> =>
  Effect.flatMap(
    store.poll,
    Option.match({
      onNone: () => Effect.die("expected an item but the lane store was empty"),
      onSome: (a) => Effect.succeed(a),
    }),
  );

const drainAll = <A>(store: LaneStore<A>): Effect.Effect<ReadonlyArray<A>> =>
  Effect.gen(function* () {
    const out: A[] = [];
    let v = yield* store.poll;
    while (Option.isSome(v)) {
      out.push(v.value);
      v = yield* store.poll;
    }
    return out;
  });

describe("fifoLaneStore", () => {
  it.effect("strict order: high, then normal (any group), then low; FIFO within a lane", () =>
    Effect.gen(function* () {
      const store = yield* makeFifoLaneStore<string>({ capacity: 64 });
      yield* store.offer("low", "low");
      yield* store.offer("n1", { group: 5 }); // group number ignored → normal
      yield* store.offer("n2", { group: 99 });
      yield* store.offer("high", "high");
      assert.deepStrictEqual(yield* drainAll(store), ["high", "n1", "n2", "low"]);
    }));

  it.effect("poll/isEmpty/sizes", () =>
    Effect.gen(function* () {
      const store = yield* makeFifoLaneStore<number>({ capacity: 64 });
      assert.isTrue(yield* store.isEmpty);
      assert.isTrue(Option.isNone(yield* store.poll));
      yield* store.offer(1, "high");
      yield* store.offer(2, { group: 0 });
      yield* store.offer(3, { group: 0 });
      const sizes = yield* store.sizes;
      assert.strictEqual(sizes.high, 1);
      assert.strictEqual(sizes.low, 0);
      assert.deepStrictEqual(sizes.middle, { 0: 2 }); // single middle lane under key 0
      assert.isFalse(yield* store.isEmpty);
      assert.strictEqual(yield* next(store), 1);
    }));

  it.effect("extractMatching removes matches across lanes, keeps the rest in order", () =>
    Effect.gen(function* () {
      const store = yield* makeFifoLaneStore<number>({ capacity: 64 });
      yield* store.offer(10, "high");
      yield* store.offer(11, { group: 0 });
      yield* store.offer(20, { group: 0 });
      yield* store.offer(12, { group: 0 });
      yield* store.offer(30, "low");
      const extracted = yield* store.extractMatching((n) => n >= 20);
      assert.deepStrictEqual([...extracted].sort((a, b) => a - b), [20, 30]);
      // kept items retain FIFO order within their lane
      assert.deepStrictEqual(yield* drainAll(store), [10, 11, 12]);
    }));

  it.effect("drain returns everything (high, normal, low) and empties", () =>
    Effect.gen(function* () {
      const store = yield* makeFifoLaneStore<string>({ capacity: 64 });
      yield* store.offer("h", "high");
      yield* store.offer("n", { group: 0 });
      yield* store.offer("l", "low");
      assert.deepStrictEqual(yield* store.drain, ["h", "n", "l"]);
      assert.isTrue(yield* store.isEmpty);
    }));
});
