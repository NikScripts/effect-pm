import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule, ProcessStore } from "../src";

const alwaysOnEntry = {
  id: Option.none<string>(),
  startAt: new Date(0),
  stopAt: Option.none<Date>(),
};

describe("Process runtime with schedule windows", () => {
  it.live("runImmediately records one tracked execution", () => {
    const proc = Process.make({
      name: "test/run-immediately",
      effect: Effect.void,
      polling: Polling.spaced(Duration.seconds(10)),
      schedule: ProcessSchedule.inMemory([alwaysOnEntry]),
    });

    return Effect.gen(function* () {
      yield* proc.runImmediately();
      const store = yield* ProcessStore;
      const rows = yield* store.getProcessExecutions(proc.name);
      expect(rows.length).toBe(1);
      expect(rows[0]?.execution.status).toBe("completed");
    }).pipe(Effect.provide(ProcessStore.layer));
  });

  it.effect("exposes current schedule id inside the running effect", () =>
    Effect.gen(function* () {
      const seenIds = yield* Ref.make<ReadonlyArray<string>>([]);
      const proc = Process.make({
        name: "test/schedule-id",
        schedule: ProcessSchedule.inMemory([
          ProcessSchedule.at("match-101", new Date(0)),
        ]),
        effect: Effect.gen(function* () {
          const currentId = yield* Process.currentScheduleId;
          yield* Option.match(currentId, {
            onNone: () => Effect.void,
            onSome: (id) => Ref.update(seenIds, (ids) => [...ids, id]),
          });
        }),
      });

      const fib = yield* Effect.forkChild(proc.effect);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* Effect.yieldNow;
      expect(yield* Ref.get(seenIds)).toContain("match-101");
      yield* Fiber.interrupt(fib);
    }).pipe(
      Effect.provide(ProcessStore.layer),
      Effect.provide(TestClock.layer()),
      Effect.scoped,
    ),
  );

  it.effect("starts from schedule startAt and repeats while stopAt is open", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const proc = Process.make({
        name: "test/repeats-while-open",
        effect: Ref.update(ticks, (n) => n + 1),
        polling: Polling.spaced(Duration.millis(100)),
        schedule: ({ set }) => set([alwaysOnEntry]),
      });

      const fib = yield* Effect.forkChild(proc.effect);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* Effect.yieldNow;
      expect(yield* Ref.get(ticks)).toBeGreaterThan(0);
      yield* Fiber.interrupt(fib);
    }).pipe(
      Effect.provide(ProcessStore.layer),
      Effect.provide(TestClock.layer()),
      Effect.scoped,
    ),
  );

  it.effect("stops naturally after stopAt", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const proc = Process.make({
        name: "test/stop-window",
        effect: Ref.update(ticks, (n) => n + 1),
        polling: Polling.spaced(Duration.millis(100)),
        schedule: ({ set }) =>
          set([
            {
              id: Option.none(),
              startAt: new Date(0),
              stopAt: Option.some(new Date(500)),
            },
          ]),
      });

      const fib = yield* Effect.forkChild(proc.effect);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* Effect.yieldNow;
      const afterWindow = yield* Ref.get(ticks);
      yield* TestClock.adjust(Duration.seconds(1));
      expect(yield* Ref.get(ticks)).toBe(afterWindow);
      yield* Fiber.interrupt(fib);
    }).pipe(
      Effect.provide(ProcessStore.layer),
      Effect.provide(TestClock.layer()),
      Effect.scoped,
    ),
  );

  it.effect("process without polling runs once for scheduled one-shot windows", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const proc = Process.make({
        name: "test/one-shot",
        effect: Ref.update(ticks, (n) => n + 1),
        schedule: ({ set }) =>
          set([
            { id: Option.none(), startAt: new Date(0), stopAt: Option.none() },
            { id: Option.none(), startAt: new Date(1_000), stopAt: Option.none() },
          ]),
      });

      const fib = yield* Effect.forkChild(proc.effect);
      yield* TestClock.adjust(Duration.seconds(2));
      yield* Effect.yieldNow;
      expect(yield* Ref.get(ticks)).toBeGreaterThanOrEqual(1);
      yield* Fiber.interrupt(fib);
    }).pipe(
      Effect.provide(ProcessStore.layer),
      Effect.provide(TestClock.layer()),
      Effect.scoped,
    ),
  );
});
