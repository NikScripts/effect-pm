import { describe, it, assert } from "@effect/vitest";
import { Effect, Option } from "effect";
import { makeLevelLaneStoreScheduled } from "../src/internal/levelLaneStoreScheduled";
import type { LaneStore } from "../src/internal/laneStore";

const next = <A>(store: LaneStore<A>): Effect.Effect<A> =>
  Effect.flatMap(
    store.poll,
    Option.match({
      onNone: () => Effect.die("expected an item but the lane store was empty"),
      onSome: (a) => Effect.succeed(a),
    }),
  );

describe("levelLaneStoreScheduled", () => {
  it.effect("weighted: service ∝ weight, and no level starves", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStoreScheduled<number>({
        levelCount: 4,
        capacity: 256,
        takeAlgorithm: "weighted",
      });
      for (let i = 0; i < 100; i++) {
        yield* store.offer(1, 1);
        yield* store.offer(3, 3);
      }
      let g1 = 0;
      let g3 = 0;
      for (let i = 0; i < 80; i++) {
        const v = yield* next(store);
        if (v === 1) g1++;
        else g3++;
      }
      assert.isAbove(g1, 0, "weight-1 level must not starve");
      assert.isAbove(g3, g1 * 2, "weight-3 level should get ~3× the service");
    }));

  it.effect("strict-descending: highest level index first (can starve lower)", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStoreScheduled<number>({
        levelCount: 10,
        capacity: 64,
        takeAlgorithm: "strict-descending",
      });
      yield* store.offer(2, 2);
      yield* store.offer(9, 9);
      yield* store.offer(5, 5);
      assert.strictEqual(yield* next(store), 9);
      assert.strictEqual(yield* next(store), 5);
      assert.strictEqual(yield* next(store), 2);
    }));

  it.effect("poll returns none when empty; isEmpty tracks occupancy", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStoreScheduled<number>({
        levelCount: 4,
        capacity: 64,
        takeAlgorithm: "weighted",
      });
      assert.isTrue(yield* store.isEmpty);
      assert.isTrue(Option.isNone(yield* store.poll));
      yield* store.offer(42, 1);
      assert.isFalse(yield* store.isEmpty);
      assert.deepStrictEqual(yield* store.poll, Option.some(42));
      assert.isTrue(yield* store.isEmpty);
    }));

  it.effect("sizes reports per-level occupancy", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStoreScheduled<string>({
        levelCount: 8,
        capacity: 64,
        takeAlgorithm: "weighted",
      });
      yield* store.offer("a", 2);
      yield* store.offer("b", 2);
      yield* store.offer("c", 7);
      const sizes = yield* store.sizes;
      assert.strictEqual(sizes[2], 2);
      assert.strictEqual(sizes[7], 1);
    }));

  it.effect("custom take algorithm", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStoreScheduled<number>({
        levelCount: 3,
        capacity: 64,
        takeAlgorithm: ({ nonEmpty }) => {
          const level = nonEmpty[nonEmpty.length - 1]?.level;
          return level === undefined ? undefined : { level, nextState: undefined };
        },
      });
      yield* store.offer(1, 0);
      yield* store.offer(2, 2);
      assert.strictEqual(yield* next(store), 2);
      assert.strictEqual(yield* next(store), 1);
    }));

  it.effect("drain returns everything (level ascending) and empties", () =>
    Effect.gen(function* () {
      const store = yield* makeLevelLaneStoreScheduled<string>({
        levelCount: 8,
        capacity: 64,
        takeAlgorithm: "weighted",
      });
      yield* store.offer("h", 0);
      yield* store.offer("g7", 7);
      yield* store.offer("g2", 2);
      yield* store.offer("l", 5);
      const all = yield* store.drain;
      assert.deepStrictEqual([...all], ["h", "g2", "l", "g7"]);
      assert.isTrue(yield* store.isEmpty);
    }));
});
