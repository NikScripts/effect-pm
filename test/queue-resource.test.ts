import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Ref, Schema } from "effect";
import {
  QueueBatchValidationError,
  QueueHandle,
  QueueMissingItemSchemaError,
  QueueItemValidationError,
  QueueResource,
  makeQueueItemCodecDescriptor,
} from "../src/QueueResource";
import { ProcessStore } from "../src/ProcessStore";

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

const waitUntilCount = (
  ref: Ref.Ref<number>,
  expected: number,
) =>
  Effect.gen(function* () {
    let steps = 0;
    while ((yield* Ref.get(ref)) < expected && steps++ < 200) {
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

describe("QueueResource.make — ProcessStore records", () => {
  it.live("writes semantic queue entry and lifecycle records when ProcessStore is provided", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-store-records",
        key: (n: number) => `job-${String(n)}`,
        effect: (_n: number) => Effect.sleep(Duration.millis(5)),
        concurrency: 1,
      });

      yield* queue.add([1]);
      yield* waitUntilCompleted(queue, 1);
      yield* Effect.sleep(Duration.millis(20));

      const entries = yield* ProcessStore.QueueResource.entries("test-store-records");
      const byKey = yield* ProcessStore.QueueResource.entriesByKey("job-1");
      const completed = entries.find((row) => row.type === "queue.entry.completed");

      expect(entries.map((row) => row.type).sort()).toEqual([
        "queue.entry.completed",
        "queue.entry.enqueued",
        "queue.entry.started",
      ]);
      expect(completed?.processType).toBe("queue-resource");
      expect(completed?.processId).toBe("test-store-records");
      expect(completed?.subjectType).toBe("queue-entry");
      expect(completed?.subjectId).toBe("test-store-records-entry-1");
      expect(completed?.key).toBe("job-1");
      expect(byKey).toHaveLength(3);
    }).pipe(Effect.provide(ProcessStore.layer), Effect.scoped),
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

  it.live("release exports pending entries and releases dedupe keys", () =>
    Effect.gen(function* () {
      const releasedBatches = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
      const processed = yield* Ref.make<ReadonlyArray<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-release-pending",
        paused: true,
        key: (item: { readonly id: string }) => item.id,
        effect: (item) => Ref.update(processed, (items) => [...items, item.id]),
        onReleased: ({ entries }) =>
          Ref.update(releasedBatches, (items) => [
            ...items,
            entries.map((entry) => entry.key ?? ""),
          ]),
        concurrency: 1,
      });

      yield* queue.add([{ id: "a" }, { id: "b" }]);
      const released = yield* queue.release({ releaseId: "release-1" });

      expect(released.map((entry) => entry.item.id)).toEqual(["a", "b"]);
      expect(released.map((entry) => entry.releaseId)).toEqual(["release-1", "release-1"]);
      expect(yield* queue.size).toBe(0);
      expect(yield* Ref.get(releasedBatches)).toEqual([["a", "b"]]);

      yield* queue.add({ id: "a" });
      yield* queue.resume;
      yield* waitUntilCompleted(queue, 1);
      expect(yield* Ref.get(processed)).toEqual(["a"]);
    }).pipe(Effect.scoped),
  );

  it.live("releaseEncoded requires itemSchema", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-release-encoded-missing-schema",
        paused: true,
        effect: (_item: { readonly id: string }) => Effect.void,
        concurrency: 1,
      });

      yield* queue.add({ id: "a" });
      const error = yield* Effect.flip(queue.releaseEncoded());

      expect(error).toBeInstanceOf(QueueMissingItemSchemaError);
      expect(yield* queue.size).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("drop and deadLetter remove matching pending entries", () =>
    Effect.gen(function* () {
      const dropped = yield* Ref.make<ReadonlyArray<string>>([]);
      const deadLetters = yield* Ref.make<ReadonlyArray<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-drop-dead-letter",
        paused: true,
        key: (item: { readonly id: string }) => item.id,
        effect: (_item) => Effect.void,
        onDropped: ({ entries }) =>
          Ref.update(dropped, (items) => [...items, ...entries.map((entry) => entry.key ?? "")]),
        onDeadLettered: ({ entries }) =>
          Ref.update(deadLetters, (items) => [...items, ...entries.map((entry) => entry.key ?? "")]),
        concurrency: 1,
      });

      yield* queue.add([{ id: "drop-me" }, { id: "dead-letter-me" }, { id: "keep-me" }]);
      const droppedEntries = yield* queue.drop({ key: "drop-me" }, { reason: "cancelled" });
      const deadLetteredEntries = yield* queue.deadLetter({ key: "dead-letter-me" }, { reason: "poison" });

      expect(droppedEntries.map((entry) => entry.key)).toEqual(["drop-me"]);
      expect(deadLetteredEntries.map((entry) => entry.key)).toEqual(["dead-letter-me"]);
      expect(yield* Ref.get(dropped)).toEqual(["drop-me"]);
      expect(yield* Ref.get(deadLetters)).toEqual(["dead-letter-me"]);
      expect(yield* queue.size).toBe(1);
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

describe("QueueResource.make — onExit (forked, non-blocking)", () => {
  it.live("onExit receives Exit on success", () =>
    Effect.gen(function* () {
      const exitResults = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-handler-success",
        effect: (_n: number) => Effect.void,
        onExit: ({ entry, exit }) =>
          Exit.match(exit, {
            onFailure: () => Effect.void,
            onSuccess: () =>
              Ref.update(exitResults, (arr) => [...arr, `ok:${String(entry.item * 2)}`]),
          }),
        ...fastConfig,
      });
      yield* queue.add([5]);
      yield* waitUntilCompleted(queue, 1);
      yield* Effect.sleep(Duration.millis(20));
      const results = yield* Ref.get(exitResults);
      expect(results).toContain("ok:10");
    }).pipe(Effect.scoped),
  );

  it.live("onExit receives Exit on failure", () =>
    Effect.gen(function* () {
      const exitResults = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-handler-failure",
        effect: (n: number) => (n > 0 ? Effect.void : Effect.fail("negative" as const)),
        onExit: ({ exit }) =>
          Exit.match(exit, {
            onFailure: () =>
              Ref.update(exitResults, (arr) => [...arr, "failed"]),
            onSuccess: () =>
              Ref.update(exitResults, (arr) => [...arr, "ok"]),
          }),
        ...fastConfig,
      });
      yield* queue.add([1, -1]);
      yield* waitUntilCompleted(queue, 2);
      yield* Effect.sleep(Duration.millis(20));
      const results = yield* Ref.get(exitResults);
      expect(results).toContain("ok");
      expect(results).toContain("failed");
    }).pipe(Effect.scoped),
  );

  it.live("onExit does not block the worker", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-handler-nonblocking",
        effect: (_n: number) => Ref.update(processed, (n) => n + 1),
        onExit: () => Effect.sleep(Duration.seconds(1)),
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

describe("QueueResource.make — retry via onExit", () => {
  it.live("event.retry re-enqueues the item", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-retry",
        key: (_n: number) => "retry-key",
        effect: (_n: number) =>
          Effect.gen(function* () {
            yield* Ref.update(attempts, (n) => n + 1);
            const count = yield* Ref.get(attempts);
            if (count < 3) return yield* Effect.fail("not yet" as const);
          }),
        onExit: ({ exit, retry }) =>
          Exit.match(exit, {
            onFailure: () => retry,
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
  it.live("onEnqueued fires with batch envelope when items are added", () =>
    Effect.gen(function* () {
      const hookCalls = yield* Ref.make<Array<{ items: ReadonlyArray<number>; priority: string; attempts: ReadonlyArray<number> }>>([]);
      const queue = yield* QueueResource.make({
        name: "test-onEnqueued",
        effect: (_n: number) => Effect.void,
        onEnqueued: (batch) =>
          Ref.update(hookCalls, (arr) => [
            ...arr,
            {
              items: batch.entries.map((entry) => entry.item),
              priority: batch.priority,
              attempts: batch.entries.map((entry) => entry.attempts),
            },
          ]),
        ...fastConfig,
      });
      yield* queue.add([1, 2]);
      yield* queue.prioritize([3]);
      yield* waitUntilCompleted(queue, 3);
      const calls = yield* Ref.get(hookCalls);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.priority).toBe("normal");
      expect(calls[0]?.items).toEqual([1, 2]);
      expect(calls[0]?.attempts).toEqual([1, 1]);
      expect(calls[1]?.priority).toBe("high");
    }).pipe(Effect.scoped),
  );

  it.live("onExit and split hooks fire after each item is processed", () =>
    Effect.gen(function* () {
      const exits = yield* Ref.make<Array<{ item: number; success: boolean }>>([]);
      const completed = yield* Ref.make<Array<number>>([]);
      const failed = yield* Ref.make<Array<number>>([]);
      const queue = yield* QueueResource.make({
        name: "test-onExit",
        effect: (n: number) => (n > 0 ? Effect.void : Effect.fail("negative" as const)),
        onExit: ({ entry, exit }) =>
          Ref.update(exits, (arr) => [
            ...arr,
            { item: entry.item, success: Exit.isSuccess(exit) },
          ]),
        onCompleted: ({ entry }) => Ref.update(completed, (items) => [...items, entry.item]),
        onFailed: ({ entry }) => Ref.update(failed, (items) => [...items, entry.item]),
        ...fastConfig,
      });
      yield* queue.add([1, -1]);
      yield* waitUntilCompleted(queue, 2);
      yield* Effect.sleep(Duration.millis(30));
      const calls = yield* Ref.get(exits);
      expect(calls).toHaveLength(2);
      const successes = calls.filter((c) => c.success);
      const failures = calls.filter((c) => !c.success);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(yield* Ref.get(completed)).toEqual([1]);
      expect(yield* Ref.get(failed)).toEqual([-1]);
    }).pipe(Effect.scoped),
  );

  it.live("onStart runs once and receives queue-bound controls", () =>
    Effect.gen(function* () {
      const started = yield* Ref.make(0);
      const handled = yield* Ref.make<ReadonlyArray<number>>([]);
      const queue = yield* QueueResource.make({
        name: "test-onStart",
        autoStart: false,
        effect: (n: number) => Ref.update(handled, (values) => [...values, n]),
        onStart: (_event, q) =>
          Effect.gen(function* () {
            yield* Ref.update(started, (n) => n + 1);
            yield* q.add([1, 2]);
          }),
        concurrency: 1,
      });
      yield* queue.start;
      yield* queue.start;
      yield* waitUntilCompleted(queue, 2);
      expect(yield* Ref.get(started)).toBe(1);
      expect(yield* Ref.get(handled)).toEqual([1, 2]);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — onRetryExhausted", () => {
  it.live("calls onRetryExhausted when retries are exceeded", () =>
    Effect.gen(function* () {
      const exhaustedItems = yield* Ref.make<Array<number>>([]);
      const scheduledAttempts = yield* Ref.make<Array<number>>([]);
      const attempts = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-retry-exhausted",
        effect: (_n: number) =>
          Effect.gen(function* () {
            yield* Ref.update(attempts, (n) => n + 1);
            return yield* Effect.fail("always-fails" as const);
          }),
        onExit: ({ exit, retry }) =>
          Exit.match(exit, {
            onFailure: () => retry,
            onSuccess: () => Effect.void,
          }),
        retries: 2,
        onRetryScheduled: ({ nextAttempt }) =>
          Ref.update(scheduledAttempts, (arr) => [...arr, nextAttempt]),
        onRetryExhausted: ({ entry }) =>
          Ref.update(exhaustedItems, (arr) => [...arr, entry.item]),
        concurrency: 1,
      });
      yield* queue.add([42]);
      yield* Effect.sleep(Duration.millis(300));
      const exhausted = yield* Ref.get(exhaustedItems);
      expect(exhausted).toContain(42);
      expect(yield* Ref.get(scheduledAttempts)).toContain(2);
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

describe("QueueResource.make — autoStart", () => {
  it.live("does not process until start when autoStart is false", () =>
    Effect.gen(function* () {
      const results = yield* Ref.make<Array<number>>([]);
      const queue = yield* QueueResource.make({
        name: "test-autostart-deferred",
        autoStart: false,
        effect: (n: number) => Ref.update(results, (arr) => [...arr, n]),
        concurrency: 1,
      });
      yield* queue.add([1, 2]);
      yield* Effect.sleep(Duration.millis(40));
      const before = yield* Ref.get(results);
      expect(before).toHaveLength(0);

      yield* queue.start;
      yield* waitUntilCompleted(queue, 2);
      const after = yield* Ref.get(results);
      expect(after.sort()).toEqual([1, 2]);
    }).pipe(Effect.scoped),
  );

  it.live("start is idempotent", () =>
    Effect.gen(function* () {
      const results = yield* Ref.make<Array<number>>([]);
      const queue = yield* QueueResource.make({
        name: "test-autostart-idempotent",
        autoStart: false,
        effect: (n: number) => Ref.update(results, (arr) => [...arr, n]),
        concurrency: 2,
      });
      yield* queue.start;
      yield* queue.start;
      yield* queue.add([1]);
      yield* waitUntilCompleted(queue, 1);
      const final = yield* Ref.get(results);
      expect(final).toEqual([1]);
    }).pipe(Effect.scoped),
  );

  it.live("start after shutdown does not process queued items", () =>
    Effect.gen(function* () {
      const results = yield* Ref.make<Array<number>>([]);
      const queue = yield* QueueResource.make({
        name: "test-autostart-shutdown-first",
        autoStart: false,
        effect: (n: number) => Ref.update(results, (arr) => [...arr, n]),
        concurrency: 1,
      });
      yield* queue.shutdown;
      yield* queue.start;
      yield* queue.add([1]);
      yield* Effect.sleep(Duration.millis(30));
      const r = yield* Ref.get(results);
      expect(r).toHaveLength(0);
    }).pipe(Effect.scoped),
  );

  it.live("onDrained waits for wake then runs after queues drain empty", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-autostart-drained",
        autoStart: false,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
        onDrained: (_q) => Ref.update(drains, (n) => n + 1),
      });
      yield* Effect.sleep(Duration.millis(40));
      expect(yield* Ref.get(drains)).toBe(0);

      yield* queue.start;
      expect(yield* Ref.get(drains)).toBe(0);

      yield* queue.add([1]);
      yield* waitUntilCompleted(queue, 1);

      yield* waitUntilCount(drains, 1);
      expect(yield* Ref.get(drains)).toBeGreaterThanOrEqual(1);
      void queue;
    }).pipe(Effect.scoped),
  );

  it.live("onDrained stays idle until drain even with default autoStart", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-drained-no-auto-layer-only",
        effect: (_n: number) => Effect.void,
        concurrency: 4,
        onDrained: (_q) => Ref.update(drains, (n) => n + 1),
      });
      yield* Effect.sleep(Duration.millis(120));
      expect(yield* Ref.get(drains)).toBe(0);
      void queue;
    }).pipe(Effect.scoped),
  );

  it.live("default autoStart onDrained runs only after processed work drains empty", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const handled = yield* Ref.make<ReadonlyArray<number>>([]);
      const queue = yield* QueueResource.make({
        name: "test-drained-default-autostart-drain",
        effect: (n: number) => Ref.update(handled, (values) => [...values, n]),
        concurrency: 1,
        onDrained: (_q) => Ref.update(drains, (n) => n + 1),
      });

      yield* Effect.sleep(Duration.millis(80));
      expect(yield* Ref.get(drains)).toBe(0);

      yield* queue.add(1);
      yield* waitUntilCompleted(queue, 1);
      yield* waitUntilCount(drains, 1);

      expect(yield* Ref.get(handled)).toEqual([1]);
      expect(yield* Ref.get(drains)).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.scoped),
  );

  it.live("service layer provision does not invoke onDrained before the queue is yielded", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);

      class DrainedQueue extends QueueResource.Service<DrainedQueue, number, never>()(
        "@test/DrainedLayerProvisionQueue",
        {
          effect: (_n: number) => Effect.void,
          concurrency: 1,
          onDrained: (_q) => Ref.update(drains, (n) => n + 1),
        },
      ) {}

      yield* Effect.sleep(Duration.millis(120)).pipe(
        Effect.provide(DrainedQueue.layer),
      );

      expect(yield* Ref.get(drains)).toBe(0);
    }),
  );

  it.live("yielding a service-layer queue with default autoStart does not cold-start onDrained", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);

      class DrainedQueue extends QueueResource.Service<DrainedQueue, number, never>()(
        "@test/DrainedLayerYieldQueue",
        {
          effect: (_n: number) => Effect.void,
          concurrency: 1,
          onDrained: (_q) => Ref.update(drains, (n) => n + 1),
        },
      ) {}

      yield* Effect.gen(function* () {
        const queue = yield* DrainedQueue;
        yield* Effect.sleep(Duration.millis(120));
        expect(yield* Ref.get(drains)).toBe(0);
        void queue;
      }).pipe(Effect.provide(DrainedQueue.layer));
    }),
  );

  it.live("service-layer queue with autoStart false waits for start and still does not cold-start onDrained", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const handled = yield* Ref.make<ReadonlyArray<number>>([]);

      class DrainedQueue extends QueueResource.Service<DrainedQueue, number, never>()(
        "@test/DrainedLayerManualStartQueue",
        {
          autoStart: false,
          effect: (n: number) => Ref.update(handled, (values) => [...values, n]),
          concurrency: 1,
          onDrained: (_q) => Ref.update(drains, (n) => n + 1),
        },
      ) {}

      yield* Effect.gen(function* () {
        const queue = yield* DrainedQueue;
        yield* Effect.sleep(Duration.millis(80));
        expect(yield* Ref.get(drains)).toBe(0);

        yield* queue.start;
        yield* Effect.sleep(Duration.millis(80));
        expect(yield* Ref.get(drains)).toBe(0);

        yield* queue.add(1);
        yield* waitUntilCompleted(queue, 1);

        yield* waitUntilCount(drains, 1);
        expect(yield* Ref.get(handled)).toEqual([1]);
        expect(yield* Ref.get(drains)).toBeGreaterThanOrEqual(1);
      }).pipe(Effect.provide(DrainedQueue.layer));
    }),
  );

  it.live("QueueResource.layer with Tag does not cold-start onDrained", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const DrainedQueue = QueueResource.Tag<
        { readonly _tag: "DrainedTagQueue" },
        number,
        never,
        never
      >()("@test/DrainedTagQueue");
      const DrainedQueueLive = QueueResource.layer(DrainedQueue, {
        effect: (_n: number) => Effect.void,
        concurrency: 1,
        onDrained: (_q) => Ref.update(drains, (n) => n + 1),
      });

      yield* Effect.gen(function* () {
        const queue = yield* DrainedQueue;
        yield* Effect.sleep(Duration.millis(120));
        expect(yield* Ref.get(drains)).toBe(0);
        void queue;
      }).pipe(Effect.provide(DrainedQueueLive));
    }),
  );

  it.live("clear triggers onDrained only after workers have been started", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-clear-drained-after-start",
        autoStart: false,
        paused: true,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
        onDrained: (_q) => Ref.update(drains, (n) => n + 1),
      });

      yield* queue.add(1);
      expect(yield* queue.clear).toBe(1);
      yield* Effect.sleep(Duration.millis(80));
      expect(yield* Ref.get(drains)).toBe(0);

      yield* queue.add(2);
      yield* queue.start;
      expect(yield* queue.clear).toBe(1);
      yield* waitUntilCount(drains, 1);
      expect(yield* Ref.get(drains)).toBeGreaterThanOrEqual(1);
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

  it.live("releaseEncoded exports JSON payloads for schema-backed queues", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-release-encoded",
        paused: true,
        itemSchema: EmailItem,
        effect: (_item) => Effect.void,
        concurrency: 1,
      });

      yield* queue.add({ id: "email-1", subject: "hello" });
      const released = yield* queue.releaseEncoded({ releaseId: "encoded-release-1" });

      expect(released).toHaveLength(1);
      expect(released[0]?.payload).toEqual({ id: "email-1", subject: "hello" });
      expect(released[0]?.releaseId).toBe("encoded-release-1");
      expect(released[0]?.item.id).toBe("test-release-encoded/item@v1");
      expect(yield* queue.size).toBe(0);
    }).pipe(Effect.scoped),
  );
});
