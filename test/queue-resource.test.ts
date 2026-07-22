import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Metric,
  Option,
  Ref,
  Schema,
  Stream,
} from "effect";
import {
  QueueBatchValidationError,
  QueueHandle,
  QueueMissingItemSchemaError,
  QueueItemValidationError,
  makeQueueItemCodecDescriptor,
  schemaVersionOf,
  withSchemaVersion,
  makeQueueEffect,
  Tag as engineQueueTag,
  queueHyperlinkLayer,
  Service as engineQueueService,
} from "../src/internal/queueHyperlink";
// This suite exercises the queue **engine** primitives directly (name-only `Tag`, positional
// `make`, `layer(tag, config)`) — distinct from the public `WorkPool` namespace whose `Tag`
// takes an `itemSchema`. Reconstruct the flat engine exports into the historical object shape so
// the call-sites read `WorkPool.make` / `.Tag` / `.layer` / `.Service`.
const WorkPool = {
  make: makeQueueEffect,
  Tag: engineQueueTag,
  layer: queueHyperlinkLayer,
  Service: engineQueueService,
};
import * as Hyperlink from "../src/Hyperlink";
import { testLogsEnv } from "./fixtures/logsEnv";

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

// Counts `Drained` events off the queue's events stream — the replacement for the old
// `onDrained` hook probe used by the autoStart cold-start tests.
const forkDrainCounter = <T, E, EE, R>(
  queue: QueueHandle<T, E, EE, R>,
  ref: Ref.Ref<number>,
) =>
  Effect.forkChild(
    Stream.runForEach(queue.events, (e) =>
      e._tag === "Drained" ? Ref.update(ref, (n) => n + 1) : Effect.void,
    ),
  );

describe("QueueHandle — status ref shape", () => {
  it.live("make() handle: status is Subscribable (get + changes), no statusNow", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "probe-status-ref",
        paused: true,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      expect("get" in queue.status).toBe(true);
      expect("changes" in queue.status).toBe(true);
      expect("statusNow" in queue).toBe(false);
      const snap = yield* queue.status.get;
      expect(snap.phase).toBe("running");
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.status.changes, (s) => s.sizes.normal === 1),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add([1]);
      const snapshots = Array.from(yield* Fiber.join(collected));
      const last = snapshots[snapshots.length - 1];
      expect(last?.sizes.normal).toBe(1);
    }).pipe(Effect.scoped),
  );
});

describe("WorkPool.make — basic processing", () => {
  it.live("processes items added via add", () =>
    Effect.gen(function* () {
      const results = yield* Ref.make<Array<number>>([]);
      const queue = yield* WorkPool.make({
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

  it.live("emits lifecycle events on the `events` stream", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-events",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      // subscribe before adding (the events hub is sliding — only observed once subscribed)
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(queue.events, 3)),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(1);
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      // one successful item → Started, then Completed (the worker outcome, recorded once)
      expect(tags).toContain("Started");
      expect(tags).toContain("Completed");
    }).pipe(Effect.scoped),
  );

  it.live("emits a Failed event when an item fails", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-events-failed",
        effect: (_n: number) => Effect.fail("boom" as const),
        concurrency: 1,
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(queue.events, 3)),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(1);
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      // a failure with no retry hook is terminal → Started, then Failed (the worker outcome, once)
      expect(tags).toContain("Started");
      expect(tags).toContain("Failed");
    }).pipe(Effect.scoped),
  );

  it.live("emits queue-level events (Enqueued, Drained)", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-events-lifecycle",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.events, (e) => e._tag === "Drained"),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add([1, 2]);
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      expect(tags).toContain("Enqueued");
      expect(tags).toContain("Drained");
    }).pipe(Effect.scoped),
  );

  it.live("emits a Cleared event when the queue is cleared", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-events-cleared",
        paused: true,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.events, (e) => e._tag === "Cleared"),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add([1, 2, 3]);
      yield* queue.clear;
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      expect(tags).toContain("Enqueued");
      expect(tags).toContain("Cleared");
    }).pipe(Effect.scoped),
  );

  it.live("reflects pending sizes + paused on the status stream", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-status",
        paused: true,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.status.changes, (s) => s.sizes.normal === 2),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add([1, 2]);
      const snapshots = Array.from(yield* Fiber.join(collected));
      const last = snapshots[snapshots.length - 1];
      expect(last?.sizes.normal).toBe(2);
      expect(last?.paused).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.live("emits windowed metrics on the metrics stream", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-metrics",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      // the window flushes early on Drained, so we don't wait the full max window
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(queue.metrics, (m) => m.completed > 0),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add([1, 2, 3]);
      const m = Array.from(yield* Fiber.join(collected))[0];
      expect(m?.enqueued).toBe(3);
      expect(m?.completed).toBe(3);
      expect(m?.windowMillis).toBeGreaterThan(0);
      // latency: wait is reported per priority (these were normal); execution + total overall.
      expect(m?.avgWaitMillis.normal).toBeGreaterThanOrEqual(0);
      expect(m?.avgWaitMillis.high).toBeUndefined();
      expect(m?.avgExecutionMillis).toBeGreaterThanOrEqual(0);
      expect(m?.avgTotalMillis).toBeGreaterThanOrEqual(0);
    }).pipe(Effect.scoped),
  );

  it.live("re-enqueues an entry taken straight off the events stream", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<number>>([]);
      const queue = yield* WorkPool.make({
        name: "test-enqueue-roundtrip",
        effect: (n: number) => Ref.update(seen, (a) => [...a, n]),
        concurrency: 1,
      });
      // capture the first Completed event (carries the QueueEntry)
      const completedFiber = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(
              queue.events,
              (
                e,
              ): e is Extract<typeof e, { readonly _tag: "Completed" }> =>
                e._tag === "Completed",
            ),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(7);
      const event = Array.from(yield* Fiber.join(completedFiber))[0];
      // the event's entry goes straight back into enqueue — no transformation
      if (event !== undefined) yield* queue.enqueue(event.entry);
      yield* waitUntilCompleted(queue, 2);
      const final = yield* Ref.get(seen);
      expect(final).toEqual([7, 7]);
      expect(event?.entry.item).toBe(7);
    }).pipe(Effect.scoped),
  );

  it.live("auto re-enqueues a failing item up to `attempts` (no hook)", () =>
    Effect.gen(function* () {
      const tries = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
        name: "test-auto-retry",
        effect: (_n: number) =>
          Ref.update(tries, (n) => n + 1).pipe(
            Effect.andThen(Effect.fail("boom" as const)),
          ),
        concurrency: 1,
        attempts: 3,
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.events, (e) => e._tag === "RetryExhausted"),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(1);
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      // 3 attempts → 3 Failed, 2 RetryScheduled, then RetryExhausted
      expect(tags.filter((t) => t === "Failed").length).toBe(3);
      expect(tags.filter((t) => t === "RetryScheduled").length).toBe(2);
      expect(tags).toContain("RetryExhausted");
      expect(yield* Ref.get(tries)).toBe(3);
    }).pipe(Effect.scoped),
  );

  it.live("Failed events carry the typed worker error (catchTag on the cause)", () =>
    Effect.gen(function* () {
      class Boom extends Data.TaggedError("Boom")<{ readonly n: number }> {}
      const caught = yield* Ref.make<Array<number>>([]);
      const queue = yield* WorkPool.make({
        name: "test-typed-failed",
        effect: (n: number) => Effect.fail(new Boom({ n })),
        concurrency: 1,
      });
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          Stream.take(
            Stream.filter(
              queue.events,
              (e): e is Extract<typeof e, { readonly _tag: "Failed" }> =>
                e._tag === "Failed",
            ),
            1,
          ),
          // e.cause is Cause<Boom> — reconstruct the failed effect and catchTag on it, fully typed
          (e) =>
            Effect.failCause(e.cause).pipe(
              Effect.catchTag("Boom", (err) =>
                Ref.update(caught, (a) => [...a, err.n]),
              ),
            ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(42);
      yield* Fiber.join(fiber);
      expect(yield* Ref.get(caught)).toEqual([42]);
    }).pipe(Effect.scoped),
  );

  it.live("treats a single string as one item, not an iterable batch", () =>
    Effect.gen(function* () {
      const results = yield* Ref.make<Array<string>>([]);
      const queue = yield* WorkPool.make({
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
      const queue = yield* WorkPool.make({
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
      const queue = yield* WorkPool.make({
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

describe("WorkPool.make — size and status", () => {
  it.live("size tracks pending items", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-size",
        effect: (_n: number) => Effect.sleep(Duration.millis(50)),
        concurrency: 1,
      });
      yield* queue.add([1, 2, 3, 4, 5]);
      yield* Effect.sleep(Duration.millis(10));
      const s = yield* queue.size.get;
      expect(s).toBeGreaterThan(0);
    }).pipe(Effect.scoped),
  );

  it.live("completed counts processed items", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
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
      const queue = yield* WorkPool.make({
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
      const processed = yield* Ref.make<ReadonlyArray<string>>([]);
      const queue = yield* WorkPool.make({
        name: "test-release-pending",
        paused: true,
        key: (item: { readonly id: string }) => item.id,
        effect: (item) => Ref.update(processed, (items) => [...items, item.id]),
        concurrency: 1,
      });

      yield* queue.add([{ id: "a" }, { id: "b" }]);
      const released = yield* queue.release({ releaseId: "release-1" });

      // release returns the entries directly (was also observed via onReleased)
      expect(released.map((entry) => entry.item.id)).toEqual(["a", "b"]);
      expect(released.map((entry) => entry.releaseId)).toEqual(["release-1", "release-1"]);
      expect(released.map((entry) => entry.key)).toEqual(["a", "b"]);
      expect(yield* queue.size.get).toBe(0);

      yield* queue.add({ id: "a" });
      yield* queue.resume;
      yield* waitUntilCompleted(queue, 1);
      expect(yield* Ref.get(processed)).toEqual(["a"]);
    }).pipe(Effect.scoped),
  );

  it.live("releaseEncoded requires itemSchema", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-release-encoded-missing-schema",
        paused: true,
        effect: (_item: { readonly id: string }) => Effect.void,
        concurrency: 1,
      });

      yield* queue.add({ id: "a" });
      const error = yield* Effect.flip(queue.releaseEncoded());

      expect(error).toBeInstanceOf(QueueMissingItemSchemaError);
      expect(yield* queue.size.get).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("drop and deadLetter remove matching pending entries", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-drop-dead-letter",
        paused: true,
        key: (item: { readonly id: string }) => item.id,
        effect: (_item) => Effect.void,
        concurrency: 1,
      });

      yield* queue.add([{ id: "drop-me" }, { id: "dead-letter-me" }, { id: "keep-me" }]);
      // drop / deadLetter return the routed entries directly (was also observed via hooks)
      const droppedEntries = yield* queue.drop({ key: "drop-me" }, { reason: "cancelled" });
      const deadLetteredEntries = yield* queue.deadLetter({ key: "dead-letter-me" }, { reason: "poison" });

      expect(droppedEntries.map((entry) => entry.key)).toEqual(["drop-me"]);
      expect(deadLetteredEntries.map((entry) => entry.key)).toEqual(["dead-letter-me"]);
      expect(yield* queue.size.get).toBe(1);
    }).pipe(Effect.scoped),
  );
});

describe("WorkPool.make — pause/resume", () => {
  it.live("pause stops processing, resume continues", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
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

describe("WorkPool.make — dedup (key)", () => {
  it.live("drops duplicate items by key", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make<Array<string>>([]);
      const queue = yield* WorkPool.make({
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
      const queue = yield* WorkPool.make({
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

describe("WorkPool.layer + Tag", () => {
  it.live("Tag produces a valid Context.Service key", () =>
    Effect.gen(function* () {
      const tag = WorkPool.Tag<
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
      const queue = yield* WorkPool.make({
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

  it.live("positional make matches config object form", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make((_n: number) => Effect.void, {
        name: "test-positional-make",
        ...fastConfig,
      });
      yield* queue.add([7]);
      yield* waitUntilCompleted(queue, 1);
      expect(yield* queue.completed).toBe(1);
    }).pipe(Effect.scoped),
  );
});

describe("WorkPool.make — events", () => {
  it.live("Enqueued events carry the batch envelope (items, priority, attempts)", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<
        Array<{
          items: ReadonlyArray<number>;
          priority: string;
          attempts: ReadonlyArray<number>;
        }>
      >([]);
      const queue = yield* WorkPool.make({
        name: "test-enqueued-events",
        effect: (_n: number) => Effect.void,
        ...fastConfig,
      });
      yield* Effect.forkChild(
        Stream.runForEach(queue.events, (e) =>
          e._tag === "Enqueued"
            ? Ref.update(seen, (arr) => [
                ...arr,
                {
                  items: e.entries.map((entry) => entry.item),
                  priority: e.priority,
                  attempts: e.entries.map((entry) => entry.attempts),
                },
              ])
            : Effect.void,
        ),
      );
      yield* Effect.sleep(Duration.millis(10));
      yield* queue.add([1, 2]);
      yield* queue.prioritize([3]);
      yield* waitUntilCompleted(queue, 3);
      yield* Effect.sleep(Duration.millis(20));
      const calls = yield* Ref.get(seen);
      const normal = calls.find((c) => c.priority === "normal");
      const high = calls.find((c) => c.priority === "high");
      expect(normal?.items).toEqual([1, 2]);
      expect(normal?.attempts).toEqual([1, 1]);
      expect(high?.items).toEqual([3]);
    }).pipe(Effect.scoped),
  );

  it.live("start is idempotent (manual autoStart)", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make<ReadonlyArray<number>>([]);
      const queue = yield* WorkPool.make({
        name: "test-start-idempotent",
        autoStart: false,
        effect: (n: number) => Ref.update(handled, (values) => [...values, n]),
        concurrency: 1,
      });
      yield* queue.add([1, 2]);
      yield* queue.start;
      yield* queue.start;
      yield* waitUntilCompleted(queue, 2);
      yield* Effect.sleep(Duration.millis(20));
      expect([...(yield* Ref.get(handled))].sort()).toEqual([1, 2]);
    }).pipe(Effect.scoped),
  );
});

describe("WorkPool.make — self-enqueue guard", () => {
  it.live("warns and drops when effect tries to self-enqueue", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make<Array<string>>([]);
      const queue = yield* WorkPool.make({
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
      const queue = yield* WorkPool.make({
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

describe("WorkPool.make — autoStart", () => {
  it.live("does not process until start when autoStart is false", () =>
    Effect.gen(function* () {
      const results = yield* Ref.make<Array<number>>([]);
      const queue = yield* WorkPool.make({
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
      const queue = yield* WorkPool.make({
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
      const queue = yield* WorkPool.make({
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

  it.live("shutdown (drain, default) processes queued items, then phase → off", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make<Array<number>>([]);
      const events = yield* Ref.make<Array<string>>([]);
      const queue = yield* WorkPool.make({
        name: "test-shutdown-drain",
        effect: (n: number) => Ref.update(processed, (a) => [...a, n]),
        concurrency: 1,
      });
      yield* Effect.forkScoped(
        Stream.runForEach(queue.events, (e) =>
          Ref.update(events, (a) => [...a, e._tag]),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add([1, 2, 3, 4]);
      yield* queue.shutdown;
      // drain finalizes in the background — wait until it reaches the terminal phase
      while ((yield* queue.status.get).phase !== "off") {
        yield* Effect.sleep(Duration.millis(5));
      }
      // drain mode processed every queued item before going off
      expect([...(yield* Ref.get(processed))].sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4,
      ]);
      const ev = yield* Ref.get(events);
      expect(ev).toContain("ShutdownRequested");
      expect(ev).toContain("ShutdownComplete");
      // adds after shutdown are rejected (queue is off)
      yield* queue.add([5]);
      expect(yield* queue.size.get).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.live("shutdown (finishActive) discards queued items, then phase → off", () =>
    Effect.gen(function* () {
      const processed = yield* Ref.make<Array<number>>([]);
      const dropped = yield* Ref.make<Array<number>>([]);
      const queue = yield* WorkPool.make({
        name: "test-shutdown-finish-active",
        // paused so the items sit queued (nothing in-flight) — finishActive must discard them
        paused: true,
        effect: (n: number) => Ref.update(processed, (a) => [...a, n]),
        concurrency: 1,
        shutdownMode: "finishActive",
      });
      yield* Effect.forkScoped(
        Stream.runForEach(queue.events, (e) =>
          e._tag === "Dropped"
            ? Ref.update(dropped, (a) => [...a, ...e.entries.map((x) => x.item)])
            : Effect.void,
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add([1, 2, 3]);
      expect(yield* queue.size.get).toBe(3);
      yield* queue.shutdown;
      while ((yield* queue.status.get).phase !== "off") {
        yield* Effect.sleep(Duration.millis(5));
      }
      // finishActive discarded the queued items (none processed) and emitted a Dropped event
      expect(yield* Ref.get(processed)).toEqual([]);
      expect([...(yield* Ref.get(dropped))].sort((a, b) => a - b)).toEqual([
        1, 2, 3,
      ]);
    }).pipe(Effect.scoped),
  );

  it.live("shutdown is idempotent and reports the draining phase", () =>
    Effect.gen(function* () {
      // worker blocks on a gate so the item stays in-flight → queue stays "draining"
      const gate = yield* Deferred.make<void>();
      const queue = yield* WorkPool.make({
        name: "test-shutdown-idempotent",
        effect: (_n: number) => Deferred.await(gate),
        concurrency: 1,
      });
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add([1]);
      yield* Effect.sleep(Duration.millis(20)); // let the worker pick it up (in-flight)
      yield* queue.shutdown;
      expect((yield* queue.status.get).phase).toBe("draining"); // in-flight not done yet
      yield* queue.shutdown; // second call is a no-op (no throw, phase unchanged)
      expect((yield* queue.status.get).phase).toBe("draining");
      yield* Deferred.succeed(gate, undefined); // release → item finishes → off
      while ((yield* queue.status.get).phase !== "off") {
        yield* Effect.sleep(Duration.millis(5));
      }
    }).pipe(Effect.scoped),
  );

  it.live("Drained event fires only after queues drain empty (manual start)", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
        name: "test-autostart-drained",
        autoStart: false,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      yield* forkDrainCounter(queue, drains);
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

  it.live("no Drained event with default autoStart and no work", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
        name: "test-drained-no-auto-layer-only",
        effect: (_n: number) => Effect.void,
        concurrency: 4,
      });
      yield* forkDrainCounter(queue, drains);
      yield* Effect.sleep(Duration.millis(120));
      expect(yield* Ref.get(drains)).toBe(0);
      void queue;
    }).pipe(Effect.scoped),
  );

  it.live("Drained event fires only after processed work drains empty (default autoStart)", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const handled = yield* Ref.make<ReadonlyArray<number>>([]);
      const queue = yield* WorkPool.make({
        name: "test-drained-default-autostart-drain",
        effect: (n: number) => Ref.update(handled, (values) => [...values, n]),
        concurrency: 1,
      });
      yield* forkDrainCounter(queue, drains);

      yield* Effect.sleep(Duration.millis(80));
      expect(yield* Ref.get(drains)).toBe(0);

      yield* queue.add(1);
      yield* waitUntilCompleted(queue, 1);
      yield* waitUntilCount(drains, 1);

      expect(yield* Ref.get(handled)).toEqual([1]);
      expect(yield* Ref.get(drains)).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.scoped),
  );

  // (The old "does not invoke onDrained before the queue is yielded" test is dropped: with
  // callbacks gone, Drained is only observable by subscribing to a yielded queue's `events`,
  // and it structurally can't fire before start — there's no pre-yield hook to mis-fire.)

  it.live("no Drained event when a service-layer queue is yielded with no work", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);

      class DrainedQueue extends WorkPool.Service<DrainedQueue, number, never>()(
        "@test/DrainedLayerYieldQueue",
        {
          effect: (_n: number) => Effect.void,
          concurrency: 1,
        },
      ) {}

      yield* Effect.gen(function* () {
        const queue = yield* DrainedQueue;
        yield* forkDrainCounter(queue, drains);
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

      class DrainedQueue extends WorkPool.Service<DrainedQueue, number, never>()(
        "@test/DrainedLayerManualStartQueue",
        {
          autoStart: false,
          effect: (n: number) => Ref.update(handled, (values) => [...values, n]),
          concurrency: 1,
        },
      ) {}

      yield* Effect.gen(function* () {
        const queue = yield* DrainedQueue;
        yield* forkDrainCounter(queue, drains);
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

  it.live("WorkPool.layer with Tag does not cold-start onDrained", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const DrainedQueue = WorkPool.Tag<
        { readonly _tag: "DrainedTagQueue" },
        number,
        never,
        never
      >()("@test/DrainedTagQueue");
      const DrainedQueueLive = WorkPool.layer(DrainedQueue, {
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });

      yield* Effect.gen(function* () {
        const queue = yield* DrainedQueue;
        yield* forkDrainCounter(queue, drains);
        yield* Effect.sleep(Duration.millis(120));
        expect(yield* Ref.get(drains)).toBe(0);
        void queue;
      }).pipe(Effect.provide(DrainedQueueLive));
    }),
  );

  it.live("clear triggers a Drained event only after workers have been started", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
        name: "test-clear-drained-after-start",
        autoStart: false,
        paused: true,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      yield* forkDrainCounter(queue, drains);

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

describe("WorkPool.make — itemSchema", () => {
  it.live("fails single-item enqueue before the queue mutates", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
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
      expect(yield* queue.size.get).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.live("fails batch enqueue atomically when any item is invalid", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
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
      expect(yield* queue.size.get).toBe(0);
    }).pipe(Effect.scoped),
  );

  it("itemSchema uses the queue id for codec metadata (defaults to v1)", () => {
    const descriptor = makeQueueItemCodecDescriptor("@test/EmailQueue", EmailItem);
    expect(descriptor.id).toBe("@test/EmailQueue/item@v1");
    expect(descriptor.version).toBe("1");
    expect(descriptor.encoding).toBe("json");
  });

  it("the schema's withSchemaVersion stamp drives the descriptor id + version", () => {
    const v3 = withSchemaVersion(EmailItem, 3);
    expect(schemaVersionOf(v3)).toBe(3);
    expect(schemaVersionOf(EmailItem)).toBe(1); // unannotated → default 1
    const descriptor = makeQueueItemCodecDescriptor("@test/EmailQueue", v3);
    expect(descriptor.id).toBe("@test/EmailQueue/item@v3");
    expect(descriptor.version).toBe("3");
  });

  it.live("rateLimit enforces minimum gap between item effect starts", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
        name: "test-rate-limit",
        concurrency: 1,
        rateLimit: { limit: 1, window: Duration.millis(80) },
        effect: () => Ref.update(starts, (n) => n + 1),
      });
      const t0 = yield* Clock.currentTimeMillis;
      yield* queue.add([1, 2, 3]);
      yield* waitUntilCompleted(queue, 3);
      const elapsed = (yield* Clock.currentTimeMillis) - t0;
      expect(yield* Ref.get(starts)).toBe(3);
      expect(elapsed).toBeGreaterThanOrEqual(140);
    }).pipe(Effect.scoped),
  );

  it.live("emits RateLimitExceeded events", () =>
    Effect.gen(function* () {
      const hits = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
        name: "test-rate-limit-hook",
        concurrency: 1,
        rateLimit: { limit: 1, window: Duration.millis(60) },
        effect: () => Effect.void,
      });
      yield* Effect.forkChild(
        Stream.runForEach(queue.events, (e) =>
          e._tag === "RateLimitExceeded"
            ? Ref.update(hits, (n) => n + 1)
            : Effect.void,
        ),
      );
      yield* Effect.sleep(Duration.millis(10));
      yield* queue.add([1, 2]);
      yield* waitUntilCompleted(queue, 2);
      yield* Effect.sleep(Duration.millis(20));

      expect(yield* Ref.get(hits)).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("releaseEncoded exports JSON payloads for schema-backed queues", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
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
      expect(yield* queue.size.get).toBe(0);
    }).pipe(Effect.scoped),
  );
});

describe("WorkPool.make — Hyperlink.runForEachTag over .events", () => {
  it.live("dispatches lifecycle tags from a live queue's events stream", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<string>>([]);
      const queue = yield* WorkPool.make({
        name: "test-runforeachtag",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      // the documented consumption pattern: pipeable handler map over .events
      const fiber = yield* Effect.forkChild(
        queue.events.pipe(
          Stream.takeUntil((e) => e._tag === "Drained"),
          Hyperlink.runForEachTag({
            Enqueued: (e) =>
              Ref.update(seen, (a) => [...a, `+${String(e.entries.length)}`]),
            Completed: () => Ref.update(seen, (a) => [...a, "done"]),
            // Drained, Start, Started deliberately unhandled → ignored
          }),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add([1, 2]);
      yield* Fiber.join(fiber);
      const final = yield* Ref.get(seen);
      // order of Enqueued vs Completed is not guaranteed (Enqueued is published after
      // items are offered, so a fast worker can race ahead) — assert the multiset.
      expect(final.filter((s) => s === "+2")).toHaveLength(1);
      expect(final.filter((s) => s === "done")).toHaveLength(2);
    }).pipe(Effect.scoped),
  );

  it.live("catches the typed worker error nested under a Failed handler", () =>
    Effect.gen(function* () {
      class Boom extends Data.TaggedError("Boom")<{ readonly n: number }> {}
      const caught = yield* Ref.make<Array<number>>([]);
      const queue = yield* WorkPool.make({
        name: "test-runforeachtag-catch",
        effect: (n: number) => Effect.fail(new Boom({ n })),
        concurrency: 1,
      });
      const fiber = yield* Effect.forkChild(
        queue.events.pipe(
          Stream.take(3),
          Hyperlink.runForEachTag({
            Failed: (e) =>
              Effect.failCause(e.cause).pipe(
                Effect.catchTag("Boom", (err) =>
                  Ref.update(caught, (a) => [...a, err.n]),
                ),
                Effect.ignore,
              ),
          }),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(99);
      yield* Fiber.join(fiber);
      expect(yield* Ref.get(caught)).toEqual([99]);
    }).pipe(Effect.scoped),
  );
});

describe("WorkPool.make — enqueue (entry re-injection)", () => {
  it.live("re-injects a batch of entries off .events preserving priority", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<number>>([]);
      const queue = yield* WorkPool.make({
        name: "test-enqueue-batch-roundtrip",
        paused: true,
        effect: (n: number) => Ref.update(seen, (a) => [...a, n]),
        concurrency: 1,
      });
      // collect Enqueued entries while paused (no workers consume them)
      const enqueuedFiber = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(
              queue.events,
              (e): e is Extract<typeof e, { readonly _tag: "Enqueued" }> =>
                e._tag === "Enqueued",
            ),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.prioritize([10, 20]);
      const ev = Array.from(yield* Fiber.join(enqueuedFiber))[0];
      const entries = ev?.entries ?? [];
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.priority === "high")).toBe(true);
      // clear the originals, re-inject the captured entries as an array
      yield* queue.clear;
      yield* queue.enqueue(entries);
      yield* queue.resume;
      yield* waitUntilCompleted(queue, 2);
      expect([...(yield* Ref.get(seen))].sort((a, b) => a - b)).toEqual([10, 20]);
    }).pipe(Effect.scoped),
  );
});

describe("WorkPool.make — onFailure disposition", () => {
  it.live("'drop' drops the failed item without re-enqueue (overriding attempts)", () =>
    Effect.gen(function* () {
      const tries = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
        name: "test-onfailure-drop",
        effect: (_n: number) =>
          Ref.update(tries, (n) => n + 1).pipe(
            Effect.andThen(Effect.fail("boom" as const)),
          ),
        onFailure: () => Effect.succeed("drop" as const),
        concurrency: 1,
        attempts: 5, // default policy would retry — onFailure overrides
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.events, (e) => e._tag === "Dropped"),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(1);
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      expect(tags).toContain("Dropped");
      expect(tags).not.toContain("RetryScheduled");
      expect(yield* Ref.get(tries)).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("'deadLetter' emits DeadLettered and receives the typed cause", () =>
    Effect.gen(function* () {
      class Boom extends Data.TaggedError("Boom")<{ readonly n: number }> {}
      const seenCause = yield* Ref.make<Array<number>>([]);
      const queue = yield* WorkPool.make({
        name: "test-onfailure-deadletter",
        effect: (n: number) => Effect.fail(new Boom({ n })),
        // cause is Cause<Boom> — read the typed failure off it
        onFailure: (_entry, cause) =>
          Effect.gen(function* () {
            const failure = Cause.findErrorOption(cause);
            if (Option.isSome(failure)) {
              yield* Ref.update(seenCause, (a) => [...a, failure.value.n]);
            }
            return "deadLetter" as const;
          }),
        concurrency: 1,
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.events, (e) => e._tag === "DeadLettered"),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(42);
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      expect(tags).toContain("DeadLettered");
      expect(yield* Ref.get(seenCause)).toEqual([42]);
    }).pipe(Effect.scoped),
  );

  it.live("'retry' re-enqueues even when attempts is unset", () =>
    Effect.gen(function* () {
      const tries = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
        name: "test-onfailure-retry",
        effect: (_n: number) =>
          Effect.gen(function* () {
            const t = yield* Ref.updateAndGet(tries, (n) => n + 1);
            if (t === 1) return yield* Effect.fail("boom" as const);
          }),
        onFailure: () => Effect.succeed("retry" as const),
        concurrency: 1,
        // no attempts → default policy would NOT re-enqueue; onFailure forces it
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.events, (e) => e._tag === "Completed"),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(1);
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      expect(tags).toContain("RetryScheduled");
      expect(tags).toContain("Completed");
      expect(yield* Ref.get(tries)).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.live("'default' falls back to the queue's auto re-enqueue policy", () =>
    Effect.gen(function* () {
      const tries = yield* Ref.make(0);
      const queue = yield* WorkPool.make({
        name: "test-onfailure-default",
        effect: (_n: number) =>
          Ref.update(tries, (n) => n + 1).pipe(
            Effect.andThen(Effect.fail("boom" as const)),
          ),
        onFailure: () => Effect.succeed("default" as const),
        concurrency: 1,
        attempts: 2, // default policy: retry once then exhaust
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.events, (e) => e._tag === "RetryExhausted"),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(1);
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      expect(tags.filter((t) => t === "RetryScheduled").length).toBe(1);
      expect(tags).toContain("RetryExhausted");
      expect(yield* Ref.get(tries)).toBe(2);
    }).pipe(Effect.scoped),
  );
});

describe("WorkPool.make — OTEL metrics", () => {
  it.live("records per-queue counters via Effect Metric", () =>
    Effect.gen(function* () {
      const queue = yield* WorkPool.make({
        name: "test-otel-metrics",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      yield* queue.add([1, 2, 3]);
      yield* waitUntilCompleted(queue, 3);
      // give the Completed events (which carry the metric updates) a beat to drain
      yield* Effect.sleep(Duration.millis(20));
      // read the registry snapshot (Metric key includes description, so match by id+attrs)
      const snapshot = yield* Metric.snapshot;
      const find = (id: string) =>
        snapshot.find(
          (m) => m.id === id && m.attributes?.queue === "test-otel-metrics",
        );
      expect(find("queue_enqueued_total")?.state).toMatchObject({ count: 3 });
      expect(find("queue_completed_total")?.state).toMatchObject({ count: 3 });
      // latency histograms: execution + total (overall) and wait (tagged by priority).
      expect(find("queue_processing_duration_ms")?.state).toMatchObject({
        count: 3,
      });
      expect(find("queue_total_duration_ms")?.state).toMatchObject({ count: 3 });
      const wait = snapshot.find(
        (m) =>
          m.id === "queue_wait_duration_ms" &&
          m.attributes?.queue === "test-otel-metrics" &&
          m.attributes?.priority === "normal",
      );
      expect(wait?.state).toMatchObject({ count: 3 });
    }).pipe(Effect.scoped),
  );
});

describe("WorkPool.make — Hyperlink.logs", () => {
  const scopeTag = (name: string) => ({ key: name });

  it.live("scopes worker-effect logs readable via Hyperlink.logs", () =>
    Effect.gen(function* () {
      const name = "test-logs-worker";
      const queue = yield* WorkPool.make({
        name,
        effect: (n: number) => Effect.logInfo(`processing ${String(n)}`),
        concurrency: 1,
      });
      const { stream } = yield* Hyperlink.logs(scopeTag(name));
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(stream, (e) => e.message.includes("processing")),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.add(7);
      const entry = Array.from(yield* Fiber.join(collected))[0];
      expect(entry?.message).toContain("processing 7");
      expect(entry?.level).toBe("Info");
    }).pipe(Effect.provide(testLogsEnv()), Effect.scoped),
  );

  it.live("scopes engine shutdown logs readable via Hyperlink.logs", () =>
    Effect.gen(function* () {
      const name = "test-logs-engine";
      const queue = yield* WorkPool.make({
        name,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      const { stream } = yield* Hyperlink.logs(scopeTag(name));
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(stream, (e) => e.message.includes("shutting down")),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* queue.shutdown;
      const entry = Array.from(yield* Fiber.join(collected))[0];
      expect(entry?.message).toContain("shutting down");
      expect(entry?.level).toBe("Info");
    }).pipe(Effect.provide(testLogsEnv()), Effect.scoped),
  );
});
