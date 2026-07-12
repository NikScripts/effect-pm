import { Duration, Effect, Layer, Schema, Stream } from "effect";
import { expect, it } from "vitest";
import { HistoryStore, QueueResource } from "../src";

const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}
class HQueue extends QueueResource.Tag<HQueue>()("history/Q", { payload: NumberItem }) {}

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
      yield* Stream.runDrain(
        Stream.takeUntil(
          queue.status.changes,
          (s) => s.completed >= 3,
        ),
      );
      // the capture fiber appends asynchronously — wait until history is populated
      yield* Effect.gen(function* () {
        while ((yield* queue.logs.query({})).length === 0) {
          yield* Effect.sleep(Duration.millis(10));
        }
      }).pipe(Effect.timeout(Duration.seconds(2)));

      const history = yield* queue.logs.query({ limit: 50 });
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
      expect(yield* queue.logs.query({})).toEqual([]);
      expect(yield* queue.metrics.query({})).toEqual([]);
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
