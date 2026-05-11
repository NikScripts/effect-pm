import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Fiber, Layer, Ref } from "effect";
import {
  QueueHandle,
  QueueResource,
  QueueShutdownError,
} from "../src/QueueResource";

const fastConfig = { concurrency: 2 };

const waitUntilCompleted = (
  queue: QueueHandle<unknown, unknown, unknown>,
  expected: number,
) =>
  Effect.gen(function* () {
    while (true) {
      const done = yield* queue.completed;
      if (done >= expected) return;
      yield* Effect.sleep(Duration.millis(5));
    }
  });

describe("QueueResource.make — basic processing", () => {
  it.live("processes items added via add", () =>
    Effect.gen(function* () {
      const results = yield* Ref.make<Array<number>>([]);
      const queue = yield* QueueResource.make({
        name: "test-basic",
        effect: (n: number) =>
          Ref.update(results, (arr) => [...arr, n]),
        ...fastConfig,
      });
      yield* queue.add([1, 2, 3]);
      yield* waitUntilCompleted(queue, 3);
      const final = yield* Ref.get(results);
      expect(final).toHaveLength(3);
      expect(final.sort()).toEqual([1, 2, 3]);
    }).pipe(Effect.scoped),
  );

  it.live("processes prioritized items before normal", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-priority",
        effect: (s: string) =>
          Ref.update(order, (arr) => [...arr, s]),
        concurrency: 1,
      });
      yield* queue.add(["normal-1", "normal-2"]);
      yield* queue.prioritize(["high-1"]);
      yield* waitUntilCompleted(queue, 3);
      const final = yield* Ref.get(order);
      const highIdx = final.indexOf("high-1");
      const norm2Idx = final.indexOf("normal-2");
      expect(highIdx).toBeLessThan(norm2Idx);
    }).pipe(Effect.scoped),
  );

  it.live("processes items in priority order (high > normal > low)", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-defer",
        paused: true,
        effect: (s: string) =>
          Ref.update(order, (arr) => [...arr, s]),
        concurrency: 1,
      });
      yield* queue.defer(["low-1"]);
      yield* queue.add(["normal-1"]);
      yield* queue.prioritize(["high-1"]);
      yield* queue.resume;
      yield* waitUntilCompleted(queue, 3);
      const final = yield* Ref.get(order);
      expect(final[0]).toBe("high-1");
      expect(final[1]).toBe("normal-1");
      expect(final[2]).toBe("low-1");
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — size and status", () => {
  it.live("size tracks pending items", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-size",
        effect: (_n: number) => Effect.sleep(Duration.millis(50)),
        concurrency: 1,
      });
      yield* queue.add([1, 2, 3, 4, 5]);
      yield* Effect.sleep(Duration.millis(10));
      const s = yield* queue.size;
      expect(s).toBeGreaterThan(0);
    }).pipe(Effect.scoped),
  );

  it.live("completed counts processed items", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-completed",
        effect: (_n: number) => Effect.void,
        ...fastConfig,
      });
      yield* queue.add([1, 2, 3]);
      yield* waitUntilCompleted(queue, 3);
      const c = yield* queue.completed;
      expect(c).toBe(3);
    }).pipe(Effect.scoped),
  );

  it.live("clear empties queues and resets counter", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-clear",
        effect: (_n: number) => Effect.sleep(Duration.seconds(10)),
        concurrency: 1,
      });
      yield* queue.add([1, 2, 3, 4, 5]);
      yield* Effect.sleep(Duration.millis(20));
      const cleared = yield* queue.clear;
      expect(cleared).toBeGreaterThan(0);
      const c = yield* queue.completed;
      expect(c).toBe(0);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — pause/resume", () => {
  it.live("pause stops processing, resume continues", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-pause",
        paused: true,
        effect: (_n: number) => Ref.update(count, (n) => n + 1),
        concurrency: 1,
      });
      yield* queue.add([1, 2]);
      yield* Effect.sleep(Duration.millis(30));
      const whilePaused = yield* Ref.get(count);
      yield* queue.resume;
      yield* waitUntilCompleted(queue, 2);
      yield* queue.pause;
      yield* queue.add([3, 4]);
      yield* Effect.sleep(Duration.millis(50));
      const afterPause = yield* Ref.get(count);
      yield* queue.resume;
      yield* waitUntilCompleted(queue, 4);
      const afterResume = yield* Ref.get(count);
      expect(whilePaused).toBe(0);
      expect(afterPause).toBe(2);
      expect(afterResume).toBe(4);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — handler (forked, non-blocking)", () => {
  it.live("handler receives Exit on success", () =>
    Effect.gen(function* () {
      const handlerResults = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-handler-success",
        effect: (n: number) => Effect.succeed(n * 2),
        handler: (_item, exit, _ctx) =>
          Exit.match(exit, {
            onFailure: () => Effect.void,
            onSuccess: (val) =>
              Ref.update(handlerResults, (arr) => [...arr, `ok:${String(val)}`]),
          }),
        ...fastConfig,
      });
      yield* queue.add([5]);
      yield* waitUntilCompleted(queue, 1);
      yield* Effect.sleep(Duration.millis(20));
      const results = yield* Ref.get(handlerResults);
      expect(results).toContain("ok:10");
    }).pipe(Effect.scoped),
  );

  it.live("handler receives Exit on failure", () =>
    Effect.gen(function* () {
      const handlerResults = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-handler-failure",
        effect: (n: number) =>
          n > 0 ? Effect.succeed(n) : Effect.fail("negative" as const),
        handler: (_item, exit, _ctx) =>
          Exit.match(exit, {
            onFailure: () =>
              Ref.update(handlerResults, (arr) => [...arr, "failed"]),
            onSuccess: () =>
              Ref.update(handlerResults, (arr) => [...arr, "ok"]),
          }),
        ...fastConfig,
      });
      yield* queue.add([1, -1]);
      yield* waitUntilCompleted(queue, 2);
      yield* Effect.sleep(Duration.millis(20));
      const results = yield* Ref.get(handlerResults);
      expect(results).toContain("ok");
      expect(results).toContain("failed");
    }).pipe(Effect.scoped),
  );

  it.live("handler does not block the worker", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-handler-nonblocking",
        effect: (_n: number) => Ref.update(processed, (n) => n + 1),
        handler: () => Effect.sleep(Duration.seconds(1)),
        concurrency: 1,
      });
      yield* queue.add([1, 2, 3]);
      yield* waitUntilCompleted(queue, 3);
      const count = yield* Ref.get(processed);
      expect(count).toBe(3);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — dedup (key)", () => {
  it.live("drops duplicate items by key", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-dedup",
        effect: (item: { readonly id: string }) =>
          Ref.update(processed, (arr) => [...arr, item.id]),
        key: (item) => item.id,
        ...fastConfig,
      });
      yield* queue.add([{ id: "a" }, { id: "b" }, { id: "a" }]);
      yield* waitUntilCompleted(queue, 2);
      yield* Effect.sleep(Duration.millis(20));
      const results = yield* Ref.get(processed);
      expect(results).toHaveLength(2);
      expect(results.sort()).toEqual(["a", "b"]);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — retry via handler", () => {
  it.live("ctx.retry re-enqueues the item", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-retry",
        effect: (_n: number) =>
          Effect.gen(function* () {
            yield* Ref.update(attempts, (n) => n + 1);
            const count = yield* Ref.get(attempts);
            if (count < 3) return yield* Effect.fail("not yet" as const);
            return count;
          }),
        handler: (_item, exit, ctx) =>
          Exit.match(exit, {
            onFailure: () => ctx.retry,
            onSuccess: () => Effect.void,
          }),
        retries: 5,
        concurrency: 1,
      });
      yield* queue.add([1]);
      yield* Effect.sleep(Duration.millis(300));
      const finalAttempts = yield* Ref.get(attempts);
      expect(finalAttempts).toBeGreaterThanOrEqual(3);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.layer", () => {
  it.live("creates a usable layer from tag + config", () =>
    Effect.gen(function* () {
      const tag = QueueResource.Tag<
        { readonly _tag: "TestQueue" },
        number,
        number,
        never
      >()("@test/TestQueue");

      const layer = QueueResource.layer(tag, {
        name: "test-layer",
        effect: (n: number) => Effect.succeed(n + 1),
        ...fastConfig,
      });

      yield* Effect.gen(function* () {
        const queue = yield* tag;
        yield* queue.add([10]);
        yield* waitUntilCompleted(queue, 1);
        const c = yield* queue.completed;
        expect(c).toBe(1);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped),
  );
});
