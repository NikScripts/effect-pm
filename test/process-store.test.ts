import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  ProcessStore,
  type EffectCompleteRecord,
  type EnqueuedRecord,
  type ForkCompleteRecord,
} from "../src";

describe("ProcessStore.memory", () => {
  it.live("records and queries executions with ordering and query opts", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore;

      const t1 = new Date("2026-01-01T00:00:00.000Z");
      const t2 = new Date("2026-01-01T00:10:00.000Z");
      const t3 = new Date("2026-01-01T00:20:00.000Z");

      yield* store.recordExecution({
        id: "e1",
        processId: "p1",
        scheduleKey: null,
        startedAt: t1,
        completedAt: t1,
        durationMs: 10,
        status: "completed",
      });
      yield* store.recordExecution({
        id: "e2",
        processId: "p1",
        scheduleKey: "live",
        startedAt: t2,
        completedAt: t2,
        durationMs: 11,
        status: "failed",
        error: "boom",
      });
      yield* store.recordExecution({
        id: "e3",
        processId: "p1",
        scheduleKey: "idle",
        startedAt: t3,
        completedAt: t3,
        durationMs: 12,
        status: "completed",
      });

      const all = yield* store.getExecutions("p1");
      expect(all.map((row) => row.id)).toEqual(["e3", "e2", "e1"]);

      const limited = yield* store.getExecutions("p1", { limit: 2 });
      expect(limited.map((row) => row.id)).toEqual(["e3", "e2"]);

      const before = yield* store.getExecutions("p1", { before: t3 });
      expect(before.map((row) => row.id)).toEqual(["e2", "e1"]);

      const after = yield* store.getExecutions("p1", { after: t1 });
      expect(after.map((row) => row.id)).toEqual(["e3", "e2"]);
    }).pipe(Effect.provide(ProcessStore.layer)));

  it.live("records and queries schedule switch history", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore;
      const t1 = new Date("2026-01-01T01:00:00.000Z");
      const t2 = new Date("2026-01-01T02:00:00.000Z");

      yield* store.recordScheduleSwitch({
        processId: "p2",
        from: "idle",
        to: "live",
        switchedAt: t1,
      });
      yield* store.recordScheduleSwitch({
        processId: "p2",
        from: "live",
        to: "idle",
        switchedAt: t2,
      });

      const rows = yield* store.getScheduleHistory("p2");
      expect(rows.map((row) => row.to)).toEqual(["idle", "live"]);

      const limited = yield* store.getScheduleHistory("p2", { limit: 1 });
      expect(limited.length).toBe(1);
      expect(limited[0]?.to).toBe("idle");
    }).pipe(Effect.provide(ProcessStore.layer)));

  it.live("records and queries lifecycle history", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore;
      const t1 = new Date("2026-01-01T03:00:00.000Z");
      const t2 = new Date("2026-01-01T04:00:00.000Z");

      yield* store.recordLifecycleEvent({
        processId: "p3",
        event: { _tag: "Started" },
        occurredAt: t1,
      });
      yield* store.recordLifecycleEvent({
        processId: "p3",
        event: { _tag: "Disabled" },
        occurredAt: t2,
      });

      const rows = yield* store.getLifecycleHistory("p3");
      expect(rows.map((row) => row.event._tag)).toEqual(["Disabled", "Started"]);
    }).pipe(Effect.provide(ProcessStore.layer)));

  it.live("stores queue records and filters pending by predicate", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore;
      const enqueued: EnqueuedRecord<unknown> = {
        id: "q1",
        resourceId: "queue-A",
        item: { k: 1 },
        priority: "normal",
        enqueuedAt: new Date("2026-01-01T05:00:00.000Z"),
        hasForkWith: true,
      };
      const effectComplete: EffectCompleteRecord<unknown, unknown, unknown> = {
        ...enqueued,
        id: "q2",
        effect: {
          status: "success",
          startedAt: new Date("2026-01-01T05:01:00.000Z"),
          completedAt: new Date("2026-01-01T05:01:01.000Z"),
          durationMs: 1000,
        },
      };
      const forkComplete: ForkCompleteRecord<unknown, unknown, unknown> = {
        ...effectComplete,
        id: "q3",
        fork: {
          status: "success",
          startedAt: new Date("2026-01-01T05:02:00.000Z"),
          completedAt: new Date("2026-01-01T05:02:01.000Z"),
          durationMs: 1000,
        },
      };

      yield* store.pool.onEnqueued(enqueued);
      yield* store.pool.onEffectComplete(effectComplete);
      yield* store.pool.onForkComplete(forkComplete);
      yield* store.pool.onMaxRetries({
        ...enqueued,
        id: "q4",
      });

      const all = yield* store.pool.getPending("queue-A");
      expect(all.map((row) => row.id)).toEqual(["q1", "q2", "q3", "q4"]);

      const onlyWithEffect = yield* store.pool.getPending(
        "queue-A",
        (row) => "effect" in row,
      );
      expect(onlyWithEffect.map((row) => row.id)).toEqual(["q2", "q3"]);
    }).pipe(Effect.provide(ProcessStore.layer)));
});

