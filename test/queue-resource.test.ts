import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Ref, Schema } from "effect";
import {
  QueueBatchValidationError,
  QueueHandle,
  QueueItemValidationError,
  QueueResource,
  makeQueueItemCodecDescriptor,
} from "../src/QueueResource";

const fastConfig = { concurrency: 2 };

const waitUntilCompleted = <T, E, EE = never, R = never>(
  queue: QueueHandle<T, E, EE, R>,
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

  it.live("treats a single string as one item, not an iterable batch", () =>
    Effect.gen(function* () {
      const results = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-single-string",
        effect: (value: string) =>
          Ref.update(results, (arr) => [...arr, value]),
        ...fastConfig,
      });
      yield* queue.add("hello");
      yield* waitUntilCompleted(queue, 1);
      const final = yield* Ref.get(results);
      expect(final).toEqual(["hello"]);
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
        effect: (_n: number) => Effect.void,
        handler: (item, exit, _ctx) =>
          Exit.match(exit, {
            onFailure: () => Effect.void,
            onSuccess: () =>
              Ref.update(handlerResults, (arr) => [...arr, `ok:${String(item * 2)}`]),
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
        effect: (n: number) => (n > 0 ? Effect.void : Effect.fail("negative" as const)),
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

  it.live("releases keys for pending items removed by clear", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-dedup-clear",
        paused: true,
        effect: (item: { readonly id: string }) =>
          Ref.update(processed, (arr) => [...arr, item.id]),
        key: (item) => item.id,
        concurrency: 1,
      });

      yield* queue.add({ id: "a" });
      const cleared = yield* queue.clear;
      expect(cleared).toBe(1);

      yield* queue.add({ id: "a" });
      yield* queue.resume;
      yield* waitUntilCompleted(queue, 1);

      const results = yield* Ref.get(processed);
      expect(results).toEqual(["a"]);
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

describe("QueueResource.layer + Tag", () => {
  it.live("Tag produces a valid Context.Service key", () =>
    Effect.gen(function* () {
      const tag = QueueResource.Tag<
        { readonly _tag: "TestQueue" },
        number,
        never,
        never
      >()("@test/TestQueue");
      expect(tag.key).toBe("@test/TestQueue");
    }).pipe(Effect.scoped),
  );

  it.live("layer produces a working queue via make", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-layer-make",
        effect: (_n: number) => Effect.void,
        ...fastConfig,
      });
      yield* queue.add([10]);
      yield* waitUntilCompleted(queue, 1);
      const c = yield* queue.completed;
      expect(c).toBe(1);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — hooks", () => {
  it.live("onEnqueue fires when items are added", () =>
    Effect.gen(function* () {
      const hookCalls = yield* Ref.make<Array<{ items: ReadonlyArray<number>; priority: string }>>([]);
      const queue = yield* QueueResource.make({
        name: "test-onEnqueue",
        effect: (_n: number) => Effect.void,
        onEnqueue: (items, priority) =>
          Ref.update(hookCalls, (arr) => [...arr, { items, priority }]),
        ...fastConfig,
      });
      yield* queue.add([1, 2]);
      yield* queue.prioritize([3]);
      yield* waitUntilCompleted(queue, 3);
      const calls = yield* Ref.get(hookCalls);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.priority).toBe("normal");
      expect(calls[0]?.items).toEqual([1, 2]);
      expect(calls[1]?.priority).toBe("high");
    }).pipe(Effect.scoped),
  );

  it.live("onComplete fires after each item is processed", () =>
    Effect.gen(function* () {
      const completions = yield* Ref.make<Array<{ item: number; success: boolean }>>([]);
      const queue = yield* QueueResource.make({
        name: "test-onComplete",
        effect: (n: number) => (n > 0 ? Effect.void : Effect.fail("negative" as const)),
        onComplete: (item, exit) =>
          Ref.update(completions, (arr) => [
            ...arr,
            { item, success: Exit.isSuccess(exit) },
          ]),
        ...fastConfig,
      });
      yield* queue.add([1, -1]);
      yield* waitUntilCompleted(queue, 2);
      yield* Effect.sleep(Duration.millis(30));
      const calls = yield* Ref.get(completions);
      expect(calls).toHaveLength(2);
      const successes = calls.filter((c) => c.success);
      const failures = calls.filter((c) => !c.success);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.live("persist is called on enqueue", () =>
    Effect.gen(function* () {
      const persisted = yield* Ref.make<Array<ReadonlyArray<number>>>([]);
      const queue = yield* QueueResource.make({
        name: "test-persist",
        effect: (_n: number) => Effect.void,
        persist: (items) =>
          Ref.update(persisted, (arr) => [...arr, items]),
        ...fastConfig,
      });
      yield* queue.add([1, 2, 3]);
      yield* waitUntilCompleted(queue, 3);
      const calls = yield* Ref.get(persisted);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([1, 2, 3]);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — onRetryExhausted", () => {
  it.live("calls onRetryExhausted when retries are exceeded", () =>
    Effect.gen(function* () {
      const exhaustedItems = yield* Ref.make<Array<number>>([]);
      const attempts = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-retry-exhausted",
        effect: (_n: number) =>
          Effect.gen(function* () {
            yield* Ref.update(attempts, (n) => n + 1);
            return yield* Effect.fail("always-fails" as const);
          }),
        handler: (_item, exit, ctx) =>
          Exit.match(exit, {
            onFailure: () => ctx.retry,
            onSuccess: () => Effect.void,
          }),
        retries: 2,
        onRetryExhausted: (item) =>
          Ref.update(exhaustedItems, (arr) => [...arr, item]),
        concurrency: 1,
      });
      yield* queue.add([42]);
      yield* Effect.sleep(Duration.millis(300));
      const exhausted = yield* Ref.get(exhaustedItems);
      expect(exhausted).toContain(42);
      const totalAttempts = yield* Ref.get(attempts);
      expect(totalAttempts).toBeGreaterThanOrEqual(3);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — self-enqueue guard", () => {
  it.live("warns and drops when effect tries to self-enqueue", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-self-enqueue",
        effect: (item: string, ctx) =>
          Effect.gen(function* () {
            yield* ctx.add([item]);
            yield* Ref.update(processed, (arr) => [...arr, item]);
          }),
        ...fastConfig,
      });
      yield* queue.add(["hello"]);
      yield* waitUntilCompleted(queue, 1);
      yield* Effect.sleep(Duration.millis(30));
      const result = yield* Ref.get(processed);
      expect(result).toEqual(["hello"]);
      const c = yield* queue.completed;
      expect(c).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("allows enqueue of different items from effect", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-derived-enqueue",
        effect: (item: string, ctx) =>
          Effect.gen(function* () {
            yield* Ref.update(processed, (arr) => [...arr, item]);
            if (item === "parent") {
              yield* ctx.add(["child-1", "child-2"]);
            }
          }),
        concurrency: 1,
      });
      yield* queue.add(["parent"]);
      yield* waitUntilCompleted(queue, 3);
      const result = yield* Ref.get(processed);
      expect(result).toContain("parent");
      expect(result).toContain("child-1");
      expect(result).toContain("child-2");
    }).pipe(Effect.scoped),
  );
});

const EmailItem = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
});

describe("QueueResource.make — itemSchema", () => {
  it.live("fails single-item enqueue before the queue mutates", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-schema-single",
        itemSchema: EmailItem,
        effect: () => Effect.void,
        ...fastConfig,
      });
      // Deliberately ill-typed payload: runtime `itemSchema` must reject numeric `id`.
      const error = yield* Effect.flip(
        queue.add({ id: 1, subject: "hello" }),
      );
      expect(error).toBeInstanceOf(QueueItemValidationError);
      expect(yield* queue.size).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.live("fails batch enqueue atomically when any item is invalid", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-schema-batch",
        itemSchema: EmailItem,
        effect: () => Effect.void,
        ...fastConfig,
      });
      const error = yield* Effect.flip(
        queue.add([
          { id: "a", subject: "ok" },
          { id: 2, subject: "bad" },
        ]),
      );
      expect(error).toBeInstanceOf(QueueBatchValidationError);
      expect(yield* queue.size).toBe(0);
    }).pipe(Effect.scoped),
  );

  it("itemSchema uses the queue id for codec metadata", () => {
    const descriptor = makeQueueItemCodecDescriptor("@test/EmailQueue", EmailItem);
    expect(descriptor.id).toBe("@test/EmailQueue/item@v1");
    expect(descriptor.version).toBe("1.0.0");
    expect(descriptor.encoding).toBe("json");
  });
});
