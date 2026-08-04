import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { HistoryStore, WorkPool } from "../src";

const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}
class HQueue extends WorkPool.Service<HQueue>()("history/Q", { payload: NumberItem }) {}

it("HistoryStore.layerMemory: append + read (newest-first limit, per stream)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* HistoryStore;
      yield* store.append("s", { a: 1 });
      yield* store.append("s", { a: 2 });
      yield* store.append("s", { a: 3 });
      expect(yield* store.read("s")).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
      expect(yield* store.read("s", { limit: 2 })).toEqual([{ a: 2 }, { a: 3 }]);
      expect(yield* store.read("other")).toEqual([]); // unknown stream → empty
    }).pipe(Effect.provide(HistoryStore.layerMemory())),
  ));

it("metricsHistory is empty when no HistoryStore is provided (graceful, opt-in)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* HQueue;
      yield* queue.add({ n: 1 });
      expect(yield* queue.metrics.query({})).toEqual([]);
    }).pipe(
      Effect.provide(
        WorkPool.layerMemory(HQueue, {
          effect: (_item) => Effect.void,
        }),
      ),
      Effect.scoped,
    ),
  ));
