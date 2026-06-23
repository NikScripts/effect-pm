import { ProcessStorage } from "../src/ProcessStorage";
import { describe, expect, it } from "@effect/vitest";
import {
  Clock,
  Data,
  Duration,
  Effect,
  Fiber,
  Ref,
  Schema,
  Stream,
} from "effect";
import {
  QueueBatchValidationError,
  QueueEntry,
  QueueHandle,
  QueueMissingItemSchemaError,
  QueueItemValidationError,
  QueueResource,
  makeQueueItemCodecDescriptor,
} from "../src/QueueResource";
import { Resource } from "../src/Resource";
import { QueueResourceStore } from "../src/store/queueResource";

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

  it.live("emits lifecycle events on the `events` stream", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
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
      // one successful item → Started, then Exit + Completed
      expect(tags).toContain("Started");
      expect(tags).toContain("Exit");
      expect(tags).toContain("Completed");
    }).pipe(Effect.scoped),
  );

  it.live("emits a Failed event when an item fails", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
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
      // a failure with no retry hook is terminal → Started, Exit, Failed
      expect(tags).toContain("Started");
      expect(tags).toContain("Exit");
      expect(tags).toContain("Failed");
    }).pipe(Effect.scoped),
  );

  it.live("emits queue-level events (Enqueued, Drained)", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
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
      const queue = yield* QueueResource.make({
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
      const queue = yield* QueueResource.make({
        name: "test-status",
        paused: true,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(queue.status, (s) => s.sizes.normal === 2),
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
      const queue = yield* QueueResource.make({
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
    }).pipe(Effect.scoped),
  );

  it.live("re-enqueues an entry taken straight off the events stream", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<number>>([]);
      const queue = yield* QueueResource.make({
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
      const queue = yield* QueueResource.make({
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

  it.live("Exit events carry the typed worker error (catchTag on the exit)", () =>
    Effect.gen(function* () {
      class Boom extends Data.TaggedError("Boom")<{ readonly n: number }> {}
      const caught = yield* Ref.make<Array<number>>([]);
      const queue = yield* QueueResource.make({
        name: "test-typed-exit",
        effect: (n: number) => Effect.fail(new Boom({ n })),
        concurrency: 1,
      });
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(
          Stream.take(
            Stream.filter(
              queue.events,
              (e): e is Extract<typeof e, { readonly _tag: "Exit" }> =>
                e._tag === "Exit",
            ),
            1,
          ),
          // e.exit is Exit<void, Boom> — catchTag on it, fully typed
          (e) =>
            e.exit.pipe(
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

      const queueResource = yield* QueueResourceStore;
      const entries = yield* queueResource.entries({
        queueId: "test-store-records",
      });
      const byKey = yield* queueResource.entriesByKey("job-1");
      const completed = entries.find((row) => row.type === "queue.entry.completed");

      expect(entries.map((row) => row.type).sort()).toEqual([
        "queue.entry.completed",
        "queue.entry.enqueued",
        "queue.entry.started",
      ]);
      expect(completed?.queueId).toBe("test-store-records");
      expect(completed?.entryId).toBe("test-store-records-entry-1");
      expect(completed?.key).toBe("job-1");
      expect(byKey).toHaveLength(3);
    }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live("writes lifecycle Started + Cleared rows", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-store-lifecycle-cleared",
        paused: true,
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });

      yield* queue.add([1, 2, 3]);
      const cleared = yield* queue.clear;
      expect(cleared).toBe(3);
      yield* queue.resume;
      yield* Effect.sleep(Duration.millis(20));

      const queueResource = yield* QueueResourceStore;
      const lifecycle = yield* queueResource.lifecycle({
        queueId: "test-store-lifecycle-cleared",
      });
      const types = lifecycle.map((row) => row.type);

      expect(types).toContain("queue.lifecycle.started");
      expect(types).toContain("queue.lifecycle.cleared");

      const clearedRow = lifecycle.find(
        (row) => row.type === "queue.lifecycle.cleared",
      );
      expect(clearedRow?.type === "queue.lifecycle.cleared"
        ? clearedRow.itemsCleared
        : 0).toBe(3);
    }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live("writes lifecycle Drained when queue empties after work", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-store-lifecycle-drained",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });

      yield* queue.add([1]);
      yield* waitUntilCompleted(queue, 1);
      yield* Effect.sleep(Duration.millis(30));

      const queueResource = yield* QueueResourceStore;
      const lifecycle = yield* queueResource.lifecycle({
        queueId: "test-store-lifecycle-drained",
      });
      const types = lifecycle.map((row) => row.type);
      expect(types).toContain("queue.lifecycle.drained");
    }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live("writes lifecycle Paused / Resumed", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-store-lifecycle-pauseresume",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });

      yield* queue.pause;
      yield* queue.resume;
      yield* Effect.sleep(Duration.millis(20));

      const queueResource = yield* QueueResourceStore;
      const lifecycle = yield* queueResource.lifecycle({
        queueId: "test-store-lifecycle-pauseresume",
      });
      const types = lifecycle.map((row) => row.type);
      expect(types).toContain("queue.lifecycle.paused");
      expect(types).toContain("queue.lifecycle.resumed");
    }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live("writes queue.entry.dropped with top-level reason", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-store-drop",
        paused: true,
        key: (item: { readonly id: string }) => item.id,
        effect: (_item) => Effect.void,
        concurrency: 1,
      });

      yield* queue.add([{ id: "drop-me" }]);
      yield* queue.drop({ key: "drop-me" }, { reason: "cancelled" });
      yield* Effect.sleep(Duration.millis(20));

      const queueResource = yield* QueueResourceStore;
      const entries = yield* queueResource.entries({
        queueId: "test-store-drop",
        types: ["queue.entry.dropped"],
      });
      expect(entries).toHaveLength(1);
      const droppedRow = entries[0];
      expect(droppedRow?.type).toBe("queue.entry.dropped");
      expect(droppedRow?.type === "queue.entry.dropped"
        ? droppedRow.reason
        : undefined).toBe("cancelled");
      expect(droppedRow?.key).toBe("drop-me");
    }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live("writes queue.entry.dead-lettered with top-level reason", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-store-deadletter",
        paused: true,
        key: (item: { readonly id: string }) => item.id,
        effect: (_item) => Effect.void,
        concurrency: 1,
      });

      yield* queue.add([{ id: "poison" }]);
      yield* queue.deadLetter({ key: "poison" }, { reason: "bad-payload" });
      yield* Effect.sleep(Duration.millis(20));

      const queueResource = yield* QueueResourceStore;
      const entries = yield* queueResource.entries({
        queueId: "test-store-deadletter",
        types: ["queue.entry.dead-lettered"],
      });
      expect(entries).toHaveLength(1);
      const row = entries[0];
      expect(row?.type === "queue.entry.dead-lettered"
        ? row.reason
        : undefined).toBe("bad-payload");
      expect(row?.key).toBe("poison");
    }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live("writes queue.entry.exhausted when retries are exceeded", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
        name: "test-store-exhausted",
        effect: (_n: number) =>
          Effect.gen(function* () {
            yield* Ref.update(attempts, (n) => n + 1);
            return yield* Effect.fail("always-fails" as const);
          }),
        // auto re-enqueue: 2 attempts (1 initial + 1 retry), then exhausted
        attempts: 2,
        concurrency: 1,
      });
      yield* queue.add([1]);
      yield* Effect.sleep(Duration.millis(200));

      const queueResource = yield* QueueResourceStore;
      const exhausted = yield* queueResource.entries({
        queueId: "test-store-exhausted",
        types: ["queue.entry.exhausted"],
      });
      expect(exhausted).toHaveLength(1);
      const retried = yield* queueResource.entries({
        queueId: "test-store-exhausted",
        types: ["queue.entry.retried"],
      });
      expect(retried.length).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live(
    "writes queue.dedupe-key.added on enqueue and released on completion",
    () =>
      Effect.gen(function* () {
        const queue = yield* QueueResource.make({
          name: "test-store-dedupe",
          key: (item: { readonly id: string }) => item.id,
          effect: (_item) => Effect.sleep(Duration.millis(5)),
          concurrency: 1,
        });

        yield* queue.add([{ id: "k-only" }]);
        yield* waitUntilCompleted(queue, 1);
        yield* Effect.sleep(Duration.millis(20));

        const queueResource = yield* QueueResourceStore;
        const allChanges = yield* queueResource.dedupeKeys({
          queueId: "test-store-dedupe",
        });
        expect(allChanges.map((row) => row.type).sort()).toEqual([
          "queue.dedupe-key.added",
          "queue.dedupe-key.released",
        ]);
        expect(allChanges.every((row) => row.key === "k-only")).toBe(true);

        const onlyForKey = yield* queueResource.dedupeKeys({
          queueId: "test-store-dedupe",
          key: "k-only",
        });
        expect(onlyForKey).toHaveLength(2);
      }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live(
    "writes queue.dedupe-key.released for keys evicted by clear",
    () =>
      Effect.gen(function* () {
        const queue = yield* QueueResource.make({
          name: "test-store-dedupe-clear",
          paused: true,
          key: (item: { readonly id: string }) => item.id,
          effect: (_item) => Effect.void,
          concurrency: 1,
        });

        yield* queue.add([{ id: "ck1" }, { id: "ck2" }]);
        const cleared = yield* queue.clear;
        expect(cleared).toBe(2);
        yield* Effect.sleep(Duration.millis(20));

        const queueResource = yield* QueueResourceStore;
        const released = yield* queueResource.dedupeKeys({
          queueId: "test-store-dedupe-clear",
          types: ["queue.dedupe-key.released"],
        });
        expect(released.map((row) => row.key).sort()).toEqual(["ck1", "ck2"]);
      }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live(
    "writes queue.dedupe-key.released for keys evicted by drop / deadLetter",
    () =>
      Effect.gen(function* () {
        const queue = yield* QueueResource.make({
          name: "test-store-dedupe-route",
          paused: true,
          key: (item: { readonly id: string }) => item.id,
          effect: (_item) => Effect.void,
          concurrency: 1,
        });

        yield* queue.add([{ id: "dr-1" }, { id: "dl-1" }]);
        yield* queue.drop({ key: "dr-1" }, { reason: "skip" });
        yield* queue.deadLetter({ key: "dl-1" }, { reason: "poison" });
        yield* Effect.sleep(Duration.millis(20));

        const queueResource = yield* QueueResourceStore;
        const released = yield* queueResource.dedupeKeys({
          queueId: "test-store-dedupe-route",
          types: ["queue.dedupe-key.released"],
        });
        expect(released.map((row) => row.key).sort()).toEqual([
          "dl-1",
          "dr-1",
        ]);
      }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live(
    "writes paired queue.dedupe-key.released + added across a retry cycle",
    () =>
      Effect.gen(function* () {
        class TransientFailure extends Data.TaggedError(
          "TransientFailure",
        )<{ readonly attempt: number }> {}
        const attempts = yield* Ref.make(0);
        const queue = yield* QueueResource.make({
          name: "test-store-dedupe-retry",
          key: (item: { readonly id: string }) => item.id,
          // auto re-enqueue drives the retry (2 attempts); first attempt fails, second succeeds
          attempts: 2,
          effect: (_item) =>
            Effect.gen(function* () {
              const n = yield* Ref.updateAndGet(attempts, (i) => i + 1);
              if (n === 1) {
                return yield* new TransientFailure({ attempt: n });
              }
            }),
          concurrency: 1,
        });

        yield* queue.add({ id: "rk-1" });
        yield* waitUntilCompleted(queue, 1);
        yield* Effect.sleep(Duration.millis(50));

        const queueResource = yield* QueueResourceStore;
        const allChanges = yield* queueResource.dedupeKeys({
          queueId: "test-store-dedupe-retry",
          key: "rk-1",
        });

        // The retry cycle for "rk-1" must produce exactly:
        //   enqueue            → added    (initial)
        //   failed processItem → released (worker)
        //   retry re-enqueue   → added    (retryInternal → enqueueInternal)
        //   success processItem → released (worker)
        // Strict chronological ordering is unreliable because multiple ops
        // can land in the same wall-clock millisecond; instead assert the
        // multiset and that each id encodes its kind, plus the per-cycle
        // invariant that retry's added has a strictly larger seq than the
        // failure's released (encoded in the id suffix).
        const counts = allChanges.reduce<Record<string, number>>(
          (acc, row) => {
            acc[row.type] = (acc[row.type] ?? 0) + 1;
            return acc;
          },
          {},
        );
        expect(counts).toEqual({
          "queue.dedupe-key.added": 2,
          "queue.dedupe-key.released": 2,
        });
        expect(allChanges.every((row) => row.key === "rk-1")).toBe(true);

        const seqOf = (id: string): number => {
          const tail = id.split("/").pop();
          return tail === undefined ? -1 : Number.parseInt(tail, 10);
        };
        const sortedSeqsForType = (
          type: "queue.dedupe-key.added" | "queue.dedupe-key.released",
        ): readonly [number, number] => {
          const seqs = allChanges
            .filter((row) => row.type === type)
            .map((row) => seqOf(row.id))
            .sort((a, b) => a - b);
          if (seqs.length !== 2) {
            throw new Error(
              `expected 2 dedupe-key ${type} changes, got ${String(
                seqs.length,
              )}`,
            );
          }
          const [first, second] = seqs;
          if (first === undefined || second === undefined) {
            throw new Error("unreachable: seqs.length === 2");
          }
          return [first, second];
        };
        const [firstAdded, secondAdded] = sortedSeqsForType(
          "queue.dedupe-key.added",
        );
        const [firstReleased, secondReleased] = sortedSeqsForType(
          "queue.dedupe-key.released",
        );
        // Initial added (seq=1) precedes failure released (seq=2) precedes
        // retry added (seq=3) precedes success released (seq=4). The seq
        // counter is monotonic regardless of clock granularity, so this
        // captures the post-fix ordering without sub-ms timing assumptions.
        expect(firstAdded).toBeLessThan(firstReleased);
        expect(firstReleased).toBeLessThan(secondAdded);
        expect(secondAdded).toBeLessThan(secondReleased);
        expect(yield* Ref.get(attempts)).toBe(2);
      }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live(
    "writes queue.dedupe-key.released for keys evicted by release()",
    () =>
      Effect.gen(function* () {
        const queue = yield* QueueResource.make({
          name: "test-store-dedupe-release",
          paused: true,
          key: (item: { readonly id: string }) => item.id,
          effect: (_item) => Effect.void,
          concurrency: 1,
        });

        yield* queue.add([{ id: "rl-1" }, { id: "rl-2" }]);
        yield* queue.release({ releaseId: "release-x" });
        yield* Effect.sleep(Duration.millis(20));

        const queueResource = yield* QueueResourceStore;
        const released = yield* queueResource.dedupeKeys({
          queueId: "test-store-dedupe-release",
          types: ["queue.dedupe-key.released"],
        });
        expect(released.map((row) => row.key).sort()).toEqual(["rl-1", "rl-2"]);
      }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live(
    "drop(QueueEntry) emits a top-level reason on the entry fact",
    () =>
      Effect.gen(function* () {
        const captured = yield* Ref.make<ReadonlyArray<QueueEntry<{ readonly id: string }>>>([]);
        const queue = yield* QueueResource.make({
          name: "test-store-route-entry-path",
          paused: true,
          key: (item: { readonly id: string }) => item.id,
          effect: (_item) => Effect.void,
          concurrency: 1,
        });
        // capture the enqueued entry off the events stream (replaces onEnqueued)
        yield* Effect.forkChild(
          Stream.runForEach(queue.events, (e) =>
            e._tag === "Enqueued"
              ? Ref.update(captured, (xs) => [...xs, ...e.entries])
              : Effect.void,
          ),
        );
        yield* Effect.sleep(Duration.millis(10));

        yield* queue.add({ id: "e-1" });
        yield* Effect.sleep(Duration.millis(20));
        const [entry] = yield* Ref.get(captured);
        if (entry === undefined) {
          throw new Error("expected captured entry from onEnqueued");
        }
        yield* queue.drop(entry, { reason: "manual-drop-by-handle" });
        yield* Effect.sleep(Duration.millis(20));

        const queueResource = yield* QueueResourceStore;
        const dropped = yield* queueResource.entries({
          queueId: "test-store-route-entry-path",
          types: ["queue.entry.dropped"],
        });
        expect(dropped).toHaveLength(1);
        const fact = dropped[0];
        if (fact?.type !== "queue.entry.dropped") {
          throw new Error("expected queue.entry.dropped fact");
        }
        expect(fact.reason).toBe("manual-drop-by-handle");
      }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
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
      const processed = yield* Ref.make<ReadonlyArray<string>>([]);
      const queue = yield* QueueResource.make({
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
      expect(yield* queue.size).toBe(0);

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
      const queue = yield* QueueResource.make({
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

  it.live("positional make matches config object form", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make((_n: number) => Effect.void, {
        name: "test-positional-make",
        ...fastConfig,
      });
      yield* queue.add([7]);
      yield* waitUntilCompleted(queue, 1);
      expect(yield* queue.completed).toBe(1);
    }).pipe(Effect.scoped),
  );
});

describe("QueueResource.make — events", () => {
  it.live("Enqueued events carry the batch envelope (items, priority, attempts)", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<
        Array<{
          items: ReadonlyArray<number>;
          priority: string;
          attempts: ReadonlyArray<number>;
        }>
      >([]);
      const queue = yield* QueueResource.make({
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
      const queue = yield* QueueResource.make({
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

  it.live("Drained event fires only after queues drain empty (manual start)", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
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
      const queue = yield* QueueResource.make({
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
      const queue = yield* QueueResource.make({
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

      class DrainedQueue extends QueueResource.Service<DrainedQueue, number, never>()(
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

      class DrainedQueue extends QueueResource.Service<DrainedQueue, number, never>()(
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
      const queue = yield* QueueResource.make({
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

  it.live("rateLimit enforces minimum gap between item effect starts", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
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

  it.live("rateLimit records exceeded events and emits RateLimitExceeded", () =>
    Effect.gen(function* () {
      const hits = yield* Ref.make(0);
      const queue = yield* QueueResource.make({
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

      const store = yield* QueueResourceStore;
      const exceeded = yield* store.rateLimits({
        queueId: "test-rate-limit-hook",
      });
      expect(yield* Ref.get(hits)).toBe(1);
      expect(exceeded).toHaveLength(1);
      expect(exceeded[0]?.type).toBe("queue.ratelimit.exceeded");
      expect(exceeded[0]?.outcome).toBe("delayed");
      expect(exceeded[0]?.limit).toBe(1);
      expect(exceeded[0]?.delayMs).toBeGreaterThan(0);
    }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

  it.live("rateLimit record off skips ProcessStore exceeded rows", () =>
    Effect.gen(function* () {
      const queue = yield* QueueResource.make({
        name: "test-rate-limit-record-off",
        concurrency: 1,
        rateLimit: { limit: 1, window: Duration.millis(40), record: "off" },
        effect: () => Effect.void,
      });
      yield* queue.add([1, 2]);
      yield* waitUntilCompleted(queue, 2);
      yield* Effect.sleep(Duration.millis(15));

      const store = yield* QueueResourceStore;
      const exceeded = yield* store.rateLimits({
        queueId: "test-rate-limit-record-off",
      });
      expect(exceeded).toHaveLength(0);
    }).pipe(Effect.provide(ProcessStorage.layer), Effect.scoped),
  );

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

describe("QueueResource.make — Resource.runForEachTag over .events", () => {
  it.live("dispatches lifecycle tags from a live queue's events stream", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<string>>([]);
      const queue = yield* QueueResource.make({
        name: "test-runforeachtag",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
      });
      // the documented consumption pattern: pipeable handler map over .events
      const fiber = yield* Effect.forkChild(
        queue.events.pipe(
          Stream.takeUntil((e) => e._tag === "Drained"),
          Resource.runForEachTag({
            Enqueued: (e) =>
              Ref.update(seen, (a) => [...a, `+${String(e.entries.length)}`]),
            Completed: () => Ref.update(seen, (a) => [...a, "done"]),
            // Drained, Start, Started, Exit deliberately unhandled → ignored
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

  it.live("catches the typed worker error nested under an Exit handler", () =>
    Effect.gen(function* () {
      class Boom extends Data.TaggedError("Boom")<{ readonly n: number }> {}
      const caught = yield* Ref.make<Array<number>>([]);
      const queue = yield* QueueResource.make({
        name: "test-runforeachtag-catch",
        effect: (n: number) => Effect.fail(new Boom({ n })),
        concurrency: 1,
      });
      const fiber = yield* Effect.forkChild(
        queue.events.pipe(
          Stream.take(3),
          Resource.runForEachTag({
            Exit: (e) =>
              e.exit.pipe(
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

describe("QueueResource.make — enqueue (entry re-injection)", () => {
  it.live("re-injects a batch of entries off .events preserving priority", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<number>>([]);
      const queue = yield* QueueResource.make({
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
