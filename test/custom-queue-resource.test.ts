import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Ref, Stream } from "effect";
import * as CustomQueueResource from "../src/CustomQueueResource";

const waitUntilCompleted = (
  queue: { readonly completed: Effect.Effect<number> },
  expected: number,
) =>
  Effect.gen(function* () {
    let steps = 0;
    while ((yield* queue.completed) < expected && steps++ < 200) {
      yield* Effect.sleep(Duration.millis(5));
    }
  });

describe("CustomQueueResource.make", () => {
  it.live("strict-descending takes highest level first", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<number[]>([]);
      const queue = yield* CustomQueueResource.make({
        name: "custom-levels",
        levelCount: 5,
        takeAlgorithm: "strict-descending",
        effect: (n: number) => Ref.update(seen, (arr) => [...arr, n]),
        concurrency: 1,
        autoStart: false,
      });
      yield* queue.add(1, 0);
      yield* queue.add(2, 4);
      yield* queue.add(3, 2);
      yield* queue.start;
      yield* waitUntilCompleted(queue, 3);
      expect(yield* Ref.get(seen)).toEqual([2, 3, 1]);
    }).pipe(Effect.scoped),
  );

  it.live("resolves named levels and reports Record sizes", () =>
    Effect.gen(function* () {
      const queue = yield* CustomQueueResource.make({
        name: "custom-named",
        levelCount: 4,
        namedLevels: { urgent: 0, batch: 3 },
        defaultLevel: 1,
        effect: (_item: string) => Effect.void,
        autoStart: false,
      });
      yield* queue.add("a", "urgent");
      yield* queue.add("b");
      yield* queue.add("c", "batch");
      const sizes = yield* queue.sizes;
      expect(sizes).toEqual({ urgent: 1, "1": 1, batch: 1 });
      const status = yield* queue.status.get;
      expect(status.sizes).toEqual(sizes);
      expect(status.phase).toBe("running");
    }).pipe(Effect.scoped),
  );

  it.live("weighted take algorithm favors higher level indices", () =>
    Effect.gen(function* () {
      const samples = yield* Ref.make({ g1: 0, g3: 0, n: 0 });
      const queue = yield* CustomQueueResource.make({
        name: "custom-weighted",
        levelCount: 4,
        takeAlgorithm: "weighted",
        effect: (n: number) =>
          Effect.gen(function* () {
            const s = yield* Ref.get(samples);
            if (s.n >= 80) return;
            yield* Ref.update(samples, (cur) => ({
              g1: cur.g1 + (n === 1 ? 1 : 0),
              g3: cur.g3 + (n === 3 ? 1 : 0),
              n: cur.n + 1,
            }));
          }),
        concurrency: 1,
        autoStart: false,
      });
      for (let i = 0; i < 100; i++) {
        yield* queue.add(1, 1);
        yield* queue.add(3, 3);
      }
      yield* queue.start;
      yield* waitUntilCompleted(queue, 80);
      const { g1, g3 } = yield* Ref.get(samples);
      expect(g1).toBeGreaterThan(0);
      expect(g3).toBeGreaterThan(g1 * 2);
    }).pipe(Effect.scoped),
  );

  it.live("status stream emits CustomQueueStatus snapshots", () =>
    Effect.gen(function* () {
      const queue = yield* CustomQueueResource.make({
        name: "custom-status",
        levelCount: 3,
        effect: (_n: number) => Effect.void,
        autoStart: false,
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(queue.status.changes, 2)),
      );
      yield* Effect.sleep(Duration.millis(10));
      yield* queue.add(1, 2);
      const snapshots = yield* Fiber.join(collected);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[1]?.sizes["2"]).toBe(1);
    }).pipe(Effect.scoped),
  );
});
