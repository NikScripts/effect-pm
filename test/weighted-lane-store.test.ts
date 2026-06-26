import { describe, it } from "@effect/vitest";
import { assert } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";
import { makeWeightedLaneStore } from "../src/internal/weightedLaneStore";

describe("weightedLaneStore", () => {
  it.effect("strict tiers: high before middle before low", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<string>({ kind: "weighted" });
      yield* store.offer("low", "low");
      yield* store.offer("mid", { group: 5 });
      yield* store.offer("high", "high");
      assert.strictEqual(yield* store.take, "high");
      assert.strictEqual(yield* store.take, "mid");
      assert.strictEqual(yield* store.take, "low");
    }));

  it.effect("weighted: service ∝ weight, and no group starves", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<number>({ kind: "weighted" });
      // group 1 (weight 1) vs group 3 (weight 3), each well-stocked.
      for (let i = 0; i < 100; i++) {
        yield* store.offer(1, { group: 1 });
        yield* store.offer(3, { group: 3 });
      }
      let g1 = 0;
      let g3 = 0;
      for (let i = 0; i < 80; i++) {
        const v = yield* store.take;
        if (v === 1) g1++;
        else g3++;
      }
      // weight 3 served ~3× as often as weight 1, but weight 1 is NOT starved.
      assert.isAbove(g1, 0, "weight-1 group must not starve");
      assert.isAbove(g3, g1 * 2, "weight-3 group should get ~3× the service");
    }));

  it.effect("strict scheduler: highest group number first (can starve lower)", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<number>({ kind: "strict" });
      yield* store.offer(2, { group: 2 });
      yield* store.offer(9, { group: 9 });
      yield* store.offer(5, { group: 5 });
      assert.strictEqual(yield* store.take, 9);
      assert.strictEqual(yield* store.take, 5);
      assert.strictEqual(yield* store.take, 2);
    }));

  it.effect("poll returns none when empty (non-blocking)", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<number>({ kind: "weighted" });
      assert.isTrue(Option.isNone(yield* store.poll));
      yield* store.offer(42, { group: 1 });
      assert.deepStrictEqual(yield* store.poll, Option.some(42));
    }));

  // it.live (real clock) — the delayed offer relies on wall-clock time.
  it.live("take blocks on an empty store until an offer wakes it", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<string>({ kind: "weighted" });
      // take starts on an empty store (blocks on the doorbell); a delayed offer must wake it.
      const [taken] = yield* Effect.all(
        [
          store.take,
          store.offer("woke", { group: 1 }).pipe(Effect.delay(Duration.millis(20))),
        ],
        { concurrency: "unbounded" },
      );
      assert.strictEqual(taken, "woke");
    }));

  it.effect("drain returns everything (high, middle ascending, low) and empties", () =>
    Effect.gen(function* () {
      const store = yield* makeWeightedLaneStore<string>({ kind: "weighted" });
      yield* store.offer("h", "high");
      yield* store.offer("g7", { group: 7 });
      yield* store.offer("g2", { group: 2 });
      yield* store.offer("l", "low");
      const all = yield* store.drain;
      assert.deepStrictEqual([...all].sort(), ["g2", "g7", "h", "l"]);
      assert.isTrue(Option.isNone(yield* store.poll));
    }));
});
