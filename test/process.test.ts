import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule, ProcessStore } from "../src";
import { utcDateFromMillis } from "../src/utcDate.js";

const alwaysOnEntry = {
  id: Option.none<string>(),
  startAt: utcDateFromMillis(0),
  stopAt: Option.none<Date>(),
};

describe("Process.make", () => {
  it("sets process.name to the id passed as the first argument", () => {
    const id = "test/make-id-first" as const;
    const proc = Process.make(id, { effect: Effect.void });
    expect(proc.name).toBe(id);
  });

  it("sets process.name for positional effect overload", () => {
    const id = "test/make-positional" as const;
    const proc = Process.make(id, Effect.void);
    expect(proc.name).toBe(id);
  });

});

describe("Process runtime with schedule windows", () => {
  const storeAndClock = Layer.mergeAll(ProcessStore.layer, TestClock.layer());

  it.effect("positional make runs driver with polling before schedule in args", () =>
    Effect.gen(function* () {
      const proc = Process.make(
        "test/positional-order",
        Effect.void,
        Polling.spaced(Duration.millis(100)),
        ProcessSchedule.inMemory([alwaysOnEntry]),
      );

      const fib = yield* Effect.forkChild(proc.effect);
      yield* TestClock.adjust(Duration.millis(250));
      const status = yield* proc.getStatus();
      expect(status.executions).toBeGreaterThanOrEqual(1);
      yield* Fiber.interrupt(fib);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );

  it.effect("omitted schedule defaults to always armed so polling ticks without manual set", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Process.make("test/default-schedule-armed", {
          effect: Ref.update(ticks, (n) => n + 1),
          polling: Polling.spaced(Duration.millis(100)),
        });

        const fib = yield* Effect.forkChild(proc.effect);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Effect.yieldNow;
        expect(yield* Ref.get(ticks)).toBeGreaterThan(0);
        yield* Fiber.interrupt(fib);
      }).pipe(
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);

  it.effect("ProcessSchedule.empty stays disarmed with no ticks", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Process.make("test/schedule-empty", {
          effect: Ref.update(ticks, (n) => n + 1),
          polling: Polling.spaced(Duration.millis(100)),
          schedule: ProcessSchedule.empty,
        });

        const fib = yield* Effect.forkChild(proc.effect);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Effect.yieldNow;
        expect(yield* Ref.get(ticks)).toBe(0);
        yield* Fiber.interrupt(fib);
      }).pipe(
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);

  it.effect("schedule initializer arms empty in-memory backing store", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Process.make("test/schedule-initializer-empty-backing", {
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
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);

  it.live("runImmediately records one tracked execution", () => {
    const proc = Process.make("test/run-immediately", {
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
        const proc = Process.make("test/schedule-id", {
          schedule: ProcessSchedule.inMemory([
            ProcessSchedule.at("match-101", utcDateFromMillis(0)),
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
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);

  it.effect("exposes schedule controls inside process effect", () =>
    Effect.gen(function* () {
        const tickIds = yield* Ref.make<ReadonlyArray<string>>([]);
        const proc = Process.make("test/schedule-controls-inside-effect", {
          polling: Polling.spaced(Duration.millis(100)),
          schedule: ({ set }) =>
            set([
              ProcessSchedule.window("first-window", utcDateFromMillis(0), utcDateFromMillis(500)),
              ProcessSchedule.window("second-window", utcDateFromMillis(2_000), utcDateFromMillis(2_500)),
            ]),
          effect: Effect.gen(function* () {
            const currentId = yield* Process.currentScheduleId;
            const controls = yield* Process.scheduleControls;
            const existing = yield* controls.entries;
            if (existing.length > 1) {
              yield* controls.set(existing.slice(0, 1));
            }
            yield* Option.match(currentId, {
              onNone: () => Effect.void,
              onSome: (id) => Ref.update(tickIds, (ids) => [...ids, id]),
            });
          }),
        });

        const fib = yield* Effect.forkChild(proc.effect);
        yield* TestClock.adjust(Duration.seconds(3));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fib);

        const seen = yield* Ref.get(tickIds);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((id) => id === "first-window")).toBe(true);
      }).pipe(
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);

  it.effect("starts from schedule startAt and repeats while stopAt is open", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Process.make("test/repeats-while-open", {
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
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);

  it.effect("stops naturally after stopAt", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Process.make("test/stop-window", {
          effect: Ref.update(ticks, (n) => n + 1),
          polling: Polling.spaced(Duration.millis(100)),
          schedule: ({ set }) =>
            set([
              {
                id: Option.none(),
                startAt: utcDateFromMillis(0),
                stopAt: Option.some(utcDateFromMillis(500)),
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
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);

  it.effect("process without polling runs once for scheduled one-shot windows", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Process.make("test/one-shot", {
          effect: Ref.update(ticks, (n) => n + 1),
          schedule: ({ set }) =>
            set([
              { id: Option.none(), startAt: utcDateFromMillis(0), stopAt: Option.none() },
              { id: Option.none(), startAt: utcDateFromMillis(1_000), stopAt: Option.none() },
            ]),
        });

        const fib = yield* Effect.forkChild(proc.effect);
        yield* TestClock.adjust(Duration.seconds(2));
        yield* Effect.yieldNow;
        expect(yield* Ref.get(ticks)).toBeGreaterThanOrEqual(1);
        yield* Fiber.interrupt(fib);
      }).pipe(
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);

  it.effect("runImmediately does not carry a schedule id", () =>
    Effect.gen(function* () {
        const seen = yield* Ref.make<ReadonlyArray<Option.Option<string>>>([]);
        const proc = Process.make("test/run-immediately-no-schedule-id", {
          polling: Polling.spaced(Duration.millis(100)),
          schedule: ProcessSchedule.inMemory([
            ProcessSchedule.at("scheduled-id", utcDateFromMillis(0)),
          ]),
          effect: Effect.gen(function* () {
            const currentId = yield* Process.currentScheduleId;
            yield* Ref.update(seen, (items) => [...items, currentId]);
          }),
        });

        yield* proc.runImmediately();
        const values = yield* Ref.get(seen);
        expect(values.length).toBe(1);
        expect(Option.isNone(values[0] ?? Option.none())).toBe(true);
      }).pipe(Effect.provide(ProcessStore.layer)),
  );

  it.effect("schedule mutation cancels stale pending starts", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const mutated = yield* Ref.make(false);
        const proc = Process.make("test/mutation-cancels-stale-pending", {
          schedule: ({ set }) =>
            set([
              ProcessSchedule.at("mutator", utcDateFromMillis(0)),
              ProcessSchedule.at("kickoff", utcDateFromMillis(10_000)),
            ]),
          effect: Effect.gen(function* () {
            const currentId = yield* Process.currentScheduleId;
            const controls = yield* Process.scheduleControls;
            yield* Option.match(currentId, {
              onNone: () => Effect.void,
              onSome: (id) =>
                id === "mutator"
                  ? Effect.gen(function* () {
                      if (!(yield* Ref.get(mutated))) {
                        yield* Ref.set(mutated, true);
                        yield* controls.set([ProcessSchedule.at("kickoff", utcDateFromMillis(30_000))]);
                      }
                    })
                  : Ref.update(ticks, (n) => n + 1),
            });
          }),
        });

        const fib = yield* Effect.forkChild(proc.effect);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Effect.yieldNow;
        const status = yield* proc.getStatus();
        expect(Option.getOrNull(status.nextTriggerRun)?.getTime()).toBe(30_000);

        yield* TestClock.adjust(Duration.seconds(14));
        yield* Effect.yieldNow;
        expect(yield* Ref.get(ticks)).toBe(0);
        yield* Fiber.interrupt(fib);
      }).pipe(
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);

  it.effect("status reports activeInstances for overlapping live windows", () =>
    Effect.gen(function* () {
        const proc = Process.make("test/status-active-instances", {
          schedule: ProcessSchedule.inMemory([
            ProcessSchedule.window("a", utcDateFromMillis(0), utcDateFromMillis(60_000)),
            ProcessSchedule.window("b", utcDateFromMillis(0), utcDateFromMillis(60_000)),
          ]),
          effect: Effect.sleep(Duration.days(1)),
        });

        const fib = yield* Effect.forkChild(proc.effect);
        yield* Effect.yieldNow;
        const status = yield* proc.getStatus();
        expect(status.activeInstances).toBe(2);
        yield* Fiber.interrupt(fib);
      }).pipe(
      Effect.provide(storeAndClock),
      Effect.scoped,
    ),
);
});
