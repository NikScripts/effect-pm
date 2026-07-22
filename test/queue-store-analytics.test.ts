import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  DateTime,
  Duration,
  Effect,
  Fiber,
  Option,
  Schema,
  Stream,
} from "effect";
import * as QueueHyperlink from "../src/QueueHyperlink";
import * as Store from "../src/Store";

// Tier 3 — the advanced analytics read-extension on `QueueHyperlink.store(queue)`. Seeds a
// deterministic event log through the base `record` (append) and asserts every derivation, plus the
// live `changes()` stream.

const jobSchema = Schema.Struct({ id: Schema.String });

class Jobs extends QueueHyperlink.Tag<Jobs>()("@test/AnalyticsJobs", { payload: jobSchema }) {}

const jobsRegistration = QueueHyperlink.store(Jobs);

class JobsStore extends Store.Service<JobsStore>("@test/AnalyticsStore")(
  jobsRegistration,
) {}

const t0 = 1_700_000_000_000;

const entry = (
  id: string,
  enqueuedAtMillis: number,
  extra?: {
    readonly startedAt?: number;
    readonly completedAt?: number;
  },
) => ({
  item: { id },
  entryId: id,
  priority: "normal" as const,
  attempts: 1,
  timestamps: {
    enqueuedAt: DateTime.makeUnsafe(enqueuedAtMillis),
    ...(extra?.startedAt !== undefined
      ? { startedAt: DateTime.makeUnsafe(extra.startedAt) }
      : {}),
    ...(extra?.completedAt !== undefined
      ? { completedAt: DateTime.makeUnsafe(extra.completedAt) }
      : {}),
  },
});

describe("QueueHyperlink.store — analytics read-extension", () => {
  it.effect("derivations compute over the seeded event log", () =>
    Effect.gen(function* () {
      const store = yield* JobsStore;
      // Seed a mixed event log:
      // - j1: Enqueued → Started → Completed (elapsed 100ms)
      // - j2: Enqueued → Started → Failed (30ms) → RetryScheduled → RetryExhausted (dead-lettered)
      // - j3: Enqueued → Started (still in-flight, no terminal)
      // - j4: Completed (elapsed 250ms)
      const e1 = entry("j1", t0 + 10, { startedAt: t0 + 20, completedAt: t0 + 120 });
      const e2 = entry("j2", t0 + 30);
      const e3 = entry("j3", t0 + 40);
      const e4 = entry("j4", t0 + 50);

      yield* store.record({ _tag: "Enqueued", entries: [e1], priority: "normal" });
      yield* store.record({ _tag: "Started", entry: e1 });
      yield* store.record({
        _tag: "Completed",
        entry: e1,
        success: undefined,
        elapsed: Duration.millis(100),
      });

      yield* store.record({ _tag: "Enqueued", entries: [e2], priority: "normal" });
      yield* store.record({ _tag: "Started", entry: e2 });
      yield* store.record({
        _tag: "Failed",
        entry: e2,
        cause: Cause.fail("boom"),
        elapsed: Duration.millis(30),
      });
      yield* store.record({
        _tag: "RetryScheduled",
        entry: e2,
        cause: Cause.fail("boom"),
        nextAttempt: 2,
      });
      yield* store.record({ _tag: "RetryExhausted", entry: e2, cause: Cause.fail("boom") });

      yield* store.record({ _tag: "Enqueued", entries: [e3], priority: "normal" });
      yield* store.record({ _tag: "Started", entry: e3 });

      yield* store.record({
        _tag: "Completed",
        entry: e4,
        success: undefined,
        elapsed: Duration.millis(250),
      });

      const failures = yield* store.failures();
      expect(failures.map((f) => f._tag)).toEqual(["Failed"]);
      expect(failures[0]?.entry.entryId).toBe("j2");

      const deadLettered = yield* store.deadLettered();
      expect(deadLettered.map((e) => e.entryId)).toEqual(["j2"]);

      const inFlight = yield* store.inFlight();
      expect(inFlight.map((e) => e.entryId)).toEqual(["j3"]);

      const history = yield* store.history("j2");
      expect(history.map((e) => e._tag)).toEqual([
        "Enqueued",
        "Started",
        "Failed",
        "RetryScheduled",
        "RetryExhausted",
      ]);

      const lastFailure = yield* store.lastFailure();
      expect(Option.isSome(lastFailure)).toBe(true);
      expect(Option.getOrThrow(lastFailure).entry.entryId).toBe("j2");

      const slowest = yield* store.slowest(2);
      // `Completed` events by descending elapsed: j4 (250ms) then j1 (100ms).
      expect(slowest.map((c) => c.entry.entryId)).toEqual(["j4", "j1"]);
      expect(slowest.every((c) => c._tag === "Completed")).toBe(true);

      const recent = yield* store.recent(2);
      expect(recent.map((e) => e._tag)).toEqual(["Started", "Completed"]);

      const since = yield* store.since(DateTime.makeUnsafe(t0 + 40));
      // Only events whose entry was enqueued at/after t0+40: j3 (Enqueued, Started) + j4 (Completed).
      expect(since.map((e) => e._tag).sort()).toEqual(["Completed", "Enqueued", "Started"]);

      const stats = yield* store.stats();
      expect(stats).toEqual({
        enqueued: 3,
        started: 3,
        completed: 2,
        failed: 1,
        retried: 1,
        deadLettered: 1,
      });

      const failureRate = yield* store.failureRate();
      // completed 2, failed 1 → 1/3
      expect(failureRate).toBe(1 / 3);

      const latency = yield* store.latency();
      // elapsed from Completed j1 (100ms) + j4 (250ms) → mean 175, max 250
      expect(Duration.toMillis(latency.max)).toBe(250);
      expect(Duration.toMillis(latency.mean)).toBe(175);
    }).pipe(Effect.provide(JobsStore.layerMemory), Effect.scoped),
  );

  it.effect("failureRate is 0 when there are no completions or failures", () =>
    Effect.gen(function* () {
      const store = yield* JobsStore;
      const rate = yield* store.failureRate();
      expect(rate).toBe(0);
    }).pipe(Effect.provide(JobsStore.layerMemory), Effect.scoped),
  );

  it.live("changes() is a live decoded event stream", () =>
    Effect.gen(function* () {
      const store = yield* JobsStore;
      // Collect the first two live events in a forked fiber, then record them.
      const collected = yield* Effect.forkChild(
        store.changes().pipe(Stream.take(2), Stream.runCollect),
      );
      yield* Effect.sleep(Duration.millis(50));

      yield* store.record({ _tag: "Start", key: Jobs.key });
      yield* store.record({
        _tag: "Completed",
        entry: entry("live-1", t0),
        success: undefined,
        elapsed: Duration.millis(5),
      });

      const events = yield* Fiber.join(collected).pipe(
        Effect.timeout(Duration.seconds(3)),
      );
      expect(Array.from(events).map((e) => e._tag)).toEqual(["Start", "Completed"]);
    }).pipe(Effect.provide(JobsStore.layerMemory), Effect.scoped),
  );
});
