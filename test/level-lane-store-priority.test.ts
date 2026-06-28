import { describe, it, assert } from "@effect/vitest";
import { Effect, Option } from "effect";
import { makeLevelLaneStorePriority } from "../src/internal/levelLaneStorePriority";
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

describe("levelLaneStorePriority", () => {
  it.effect("strict order: level 0, then 1, then 2; FIFO within a level", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStorePriority<string>({
        levelCount: 3,
        capacity: 64,
      });
      yield* store.offer("low", 2);
      yield* store.offer("n1", 1);
      yield* store.offer("n2", 1);
      yield* store.offer("high", 0);
      assert.deepStrictEqual(yield* drainAll(store), ["high", "n1", "n2", "low"]);
    }));

  it.effect("poll/isEmpty/sizes", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStorePriority<number>({ levelCount: 3, capacity: 64 });
      assert.isTrue(yield* store.isEmpty);
      assert.isTrue(Option.isNone(yield* store.poll));
      yield* store.offer(1, 0);
      yield* store.offer(2, 1);
      yield* store.offer(3, 1);
      const sizes = yield* store.sizes;
      assert.deepStrictEqual([...sizes], [1, 2, 0]);
      assert.isFalse(yield* store.isEmpty);
      assert.strictEqual(yield* next(store), 1);
    }));

  it.effect("extractMatching removes matches across levels, keeps the rest in order", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStorePriority<number>({ levelCount: 3, capacity: 64 });
      yield* store.offer(10, 0);
      yield* store.offer(11, 1);
      yield* store.offer(20, 1);
      yield* store.offer(12, 1);
      yield* store.offer(30, 2);
      const extracted = yield* store.extractMatching((n) => n >= 20);
      assert.deepStrictEqual([...extracted].sort((a, b) => a - b), [20, 30]);
      assert.deepStrictEqual(yield* drainAll(store), [10, 11, 12]);
    }));

  it.effect("drain returns everything (level order) and empties", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStorePriority<string>({ levelCount: 3, capacity: 64 });
      yield* store.offer("h", 0);
      yield* store.offer("n", 1);
      yield* store.offer("l", 2);
      assert.deepStrictEqual(yield* store.drain, ["h", "n", "l"]);
      assert.isTrue(yield* store.isEmpty);
    }));
});
