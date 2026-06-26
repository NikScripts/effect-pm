import { describe, it, assert } from "@effect/vitest";
import { Effect, Option } from "effect";
import { makeWeightedLaneStore } from "../src/internal/weightedLaneStore";
import type { LaneStore } from "../src/internal/laneStore";

/** Poll the next item, asserting the store wasn't empty. */
const next = <A>(store: LaneStore<A>): Effect.Effect<A> =>
  Effect.flatMap(
    store.poll,
    Option.match({
      onNone: () => Effect.die("expected an item but the lane store was empty"),
      onSome: (a) => Effect.succeed(a),
    }),
  );

describe("weightedLaneStore", () => {
  it.effect("strict tiers: high before middle before low", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<string>({ kind: "weighted" });
      yield* store.offer("low", "low");
      yield* store.offer("mid", { group: 5 });
      yield* store.offer("high", "high");
      assert.strictEqual(yield* next(store), "high");
      assert.strictEqual(yield* next(store), "mid");
      assert.strictEqual(yield* next(store), "low");
    }));

  it.effect("weighted: service ∝ weight, and no group starves", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<number>({ kind: "weighted" });
      for (let i = 0; i < 100; i++) {
        yield* store.offer(1, { group: 1 });
        yield* store.offer(3, { group: 3 });
      }
      let g1 = 0;
      let g3 = 0;
      for (let i = 0; i < 80; i++) {
        const v = yield* next(store);
        if (v === 1) g1++;
        else g3++;
      }
      assert.isAbove(g1, 0, "weight-1 group must not starve");
      assert.isAbove(g3, g1 * 2, "weight-3 group should get ~3× the service");
    }));

  it.effect("strict scheduler: highest group number first (can starve lower)", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<number>({ kind: "strict" });
      yield* store.offer(2, { group: 2 });
      yield* store.offer(9, { group: 9 });
      yield* store.offer(5, { group: 5 });
      assert.strictEqual(yield* next(store), 9);
      assert.strictEqual(yield* next(store), 5);
      assert.strictEqual(yield* next(store), 2);
    }));

  it.effect("poll returns none when empty; isEmpty tracks occupancy", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<number>({ kind: "weighted" });
      assert.isTrue(yield* store.isEmpty);
      assert.isTrue(Option.isNone(yield* store.poll));
      yield* store.offer(42, { group: 1 });
      assert.isFalse(yield* store.isEmpty);
      assert.deepStrictEqual(yield* store.poll, Option.some(42));
      assert.isTrue(yield* store.isEmpty);
    }));

  it.effect("sizes reports high/low + per-group middle", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<string>({ kind: "weighted" });
      yield* store.offer("h", "high");
      yield* store.offer("a", { group: 2 });
      yield* store.offer("b", { group: 2 });
      yield* store.offer("c", { group: 7 });
      const sizes = yield* store.sizes;
      assert.strictEqual(sizes.high, 1);
      assert.strictEqual(sizes.low, 0);
      assert.deepStrictEqual(sizes.middle, { 2: 2, 7: 1 });
    }));

  it.effect("extractMatching removes + returns matches, keeps the rest", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<number>({ kind: "weighted" });
      yield* store.offer(10, "high");
      yield* store.offer(11, { group: 2 });
      yield* store.offer(20, { group: 2 });
      yield* store.offer(21, { group: 5 });
      yield* store.offer(30, "low");
      const extracted = yield* store.extractMatching((n) => n >= 20);
      assert.deepStrictEqual([...extracted].sort((a, b) => a - b), [20, 21, 30]);
      // remaining items still poll out, matched ones are gone
      const rest: number[] = [];
      let v = yield* store.poll;
      while (Option.isSome(v)) {
        rest.push(v.value);
        v = yield* store.poll;
      }
      assert.deepStrictEqual(rest.sort((a, b) => a - b), [10, 11]);
    }));

  it.effect("drain returns everything (high, middle ascending, low) and empties", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<string>({ kind: "weighted" });
      yield* store.offer("h", "high");
      yield* store.offer("g7", { group: 7 });
      yield* store.offer("g2", { group: 2 });
      yield* store.offer("l", "low");
      const all = yield* store.drain;
      assert.deepStrictEqual([...all], ["h", "g2", "g7", "l"]);
      assert.isTrue(yield* store.isEmpty);
    }));
});
