import { Duration, Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import { HistoryStore, QueueResource } from "../src";

const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}
class HQueue extends QueueResource.Tag<HQueue>()("history/Q", NumberItem) {}

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

it("queue logHistory reads back captured logs (HistoryStore provided to the layer)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* HQueue;
      yield* queue.add([{ n: 1 }, { n: 2 }, { n: 3 }]);
      while ((yield* queue.completed) < 3) yield* Effect.sleep(Duration.millis(10));
      // the capture fiber appends asynchronously — wait until history is populated
      yield* Effect.gen(function* () {
        while ((yield* queue.logHistory({})).length === 0) {
          yield* Effect.sleep(Duration.millis(10));
        }
      }).pipe(Effect.timeout(Duration.seconds(2)));

      const history = yield* queue.logHistory({ limit: 50 });
      expect(history.length).toBeGreaterThan(0);
      // entries decode back to the wire log schema (level/message preserved)
      expect(typeof history[0]?.level).toBe("string");
    }).pipe(
      Effect.provide(
        QueueResource.layer(HQueue, {
          effect: (item) => Effect.logInfo(`processed ${item.n}`),
          captureLogs: true,
        }).pipe(Layer.provide(HistoryStore.layerMemory())),
      ),
      Effect.scoped,
    ),
  ));

it("logHistory is empty when no HistoryStore is provided (graceful, opt-in)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* HQueue;
      yield* queue.add({ n: 1 });
      expect(yield* queue.logHistory({})).toEqual([]);
      expect(yield* queue.metricsHistory({})).toEqual([]);
    }).pipe(
      Effect.provide(
        QueueResource.layer(HQueue, {
          effect: (_item) => Effect.void,
          captureLogs: true,
        }),
      ),
      Effect.scoped,
    ),
  ));
