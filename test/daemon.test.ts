import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Daemon, DaemonMakeInvalidLayerArgument } from "../src";
import { PollingTag } from "../src/internal/pollingTag";
// Engine schedule constructors live on the `Daemon` namespace now (the standalone `DaemonSchedule`
// module was retired): `Daemon.scheduleInMemory` (call with no args for an empty schedule) +
// `Daemon.at` / `Daemon.window`.
import { utcDateFromMillis } from "../src/internal/utcDate";

const alwaysOnEntry = {
  id: Option.none<string>(),
  startAt: utcDateFromMillis(0),
  stopAt: Option.none<Date>(),
};

describe("Daemon.make", () => {
  it("sets daemon.name to the id passed as the first argument", () => {
    const id = "test/make-id-first" as const;
    const proc = Daemon.make(id, { effect: Effect.void });
    expect(proc.name).toBe(id);
  });

  it("sets daemon.name for positional effect overload", () => {
    const id = "test/make-positional" as const;
    const proc = Daemon.make(id, Effect.void);
    expect(proc.name).toBe(id);
  });

  it("throws DaemonMakeInvalidLayerArgument for unregistered positional layers", () => {
    const customPolling = Layer.succeed(PollingTag, {
      awaitNextTick: Effect.void,
      requestWake: Effect.void,
      resetCadence: Effect.void,
      afterTick: Effect.void,
      peekCadence: Effect.succeed(Option.none()),
    });

    expect(() =>
      Daemon.make("test/invalid-positional", Effect.void, customPolling),
    ).toThrowError(DaemonMakeInvalidLayerArgument);
  });

});

describe("Daemon runtime with schedule windows", () => {
  const clock = TestClock.layer();

  it.effect("positional make runs driver with polling before schedule in args", () =>
    Effect.gen(function* () {
      const proc = Daemon.make(
        "test/positional-order",
        Effect.void,
        Polling.spaced(Duration.millis(100)),
        Daemon.scheduleInMemory([alwaysOnEntry]),
      );

      const fib = yield* Effect.forkChild(proc.effect);
      yield* TestClock.adjust(Duration.millis(250));
      yield* Fiber.interrupt(fib);
    }).pipe(Effect.provide(TestClock.layer()), Effect.scoped),
  );

  it.effect("omitted schedule defaults to always armed so polling ticks without manual set", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Daemon.make("test/default-schedule-armed", {
          effect: Ref.update(ticks, (n) => n + 1),
          polling: Polling.spaced(Duration.millis(100)),
        });

        const fib = yield* Effect.forkChild(proc.effect);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Effect.yieldNow;
        expect(yield* Ref.get(ticks)).toBeGreaterThan(0);
        yield* Fiber.interrupt(fib);
      }).pipe(
      Effect.provide(clock),
      Effect.scoped,
    ),
);

  it.effect("Daemon.scheduleInMemory() stays disarmed with no ticks", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Daemon.make("test/schedule-empty", {
          effect: Ref.update(ticks, (n) => n + 1),
          polling: Polling.spaced(Duration.millis(100)),
          schedule: Daemon.scheduleInMemory(),
        });

        const fib = yield* Effect.forkChild(proc.effect);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Effect.yieldNow;
        expect(yield* Ref.get(ticks)).toBe(0);
        yield* Fiber.interrupt(fib);
      }).pipe(
      Effect.provide(clock),
      Effect.scoped,
    ),
);

  it.effect("schedule initializer arms empty in-memory backing store", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Daemon.make("test/schedule-initializer-empty-backing", {
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
      Effect.provide(clock),
      Effect.scoped,
    ),
);

  it.effect("exposes current schedule id inside the running effect", () =>
    Effect.gen(function* () {
        const seenIds = yield* Ref.make<ReadonlyArray<string>>([]);
        const proc = Daemon.make("test/schedule-id", {
          schedule: Daemon.scheduleInMemory([
            Daemon.at("match-101", utcDateFromMillis(0)),
          ]),
          effect: Effect.gen(function* () {
            const currentId = yield* Daemon.currentScheduleId;
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
      Effect.provide(clock),
      Effect.scoped,
    ),
);

  it.effect("exposes schedule controls inside process effect", () =>
    Effect.gen(function* () {
        const tickIds = yield* Ref.make<ReadonlyArray<string>>([]);
        const proc = Daemon.make("test/schedule-controls-inside-effect", {
          polling: Polling.spaced(Duration.millis(100)),
          schedule: ({ set }) =>
            set([
              Daemon.window("first-window", utcDateFromMillis(0), utcDateFromMillis(500)),
              Daemon.window("second-window", utcDateFromMillis(2_000), utcDateFromMillis(2_500)),
            ]),
          effect: Effect.gen(function* () {
            const currentId = yield* Daemon.currentScheduleId;
            const controls = yield* Daemon.scheduleControls;
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
      Effect.provide(clock),
      Effect.scoped,
    ),
);

  it.effect("starts from schedule startAt and repeats while stopAt is open", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Daemon.make("test/repeats-while-open", {
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
      Effect.provide(clock),
      Effect.scoped,
    ),
);

  it.effect("stops naturally after stopAt", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Daemon.make("test/stop-window", {
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
      Effect.provide(clock),
      Effect.scoped,
    ),
);

  it.effect("process without polling runs once for scheduled one-shot windows", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const proc = Daemon.make("test/one-shot", {
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
      Effect.provide(clock),
      Effect.scoped,
    ),
);

  it("run (engine handle) does not carry a schedule id", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const seen = yield* Ref.make<ReadonlyArray<Option.Option<string>>>([]);
        const proc = Daemon.make("test/run-immediately-no-schedule-id", {
          polling: Polling.spaced(Duration.millis(100)),
          schedule: Daemon.scheduleInMemory([
            Daemon.at("scheduled-id", utcDateFromMillis(0)),
          ]),
          effect: Effect.gen(function* () {
            const currentId = yield* Daemon.currentScheduleId;
            yield* Ref.update(seen, (items) => [...items, currentId]);
          }),
        });

        yield* proc.run();
        const values = yield* Ref.get(seen);
        expect(values.length).toBe(1);
        expect(Option.isNone(values[0] ?? Option.none())).toBe(true);
      }).pipe(Effect.provide(TestClock.layer())),
    ),
  );

  it.effect("schedule mutation cancels stale pending starts", () =>
    Effect.gen(function* () {
        const ticks = yield* Ref.make(0);
        const mutated = yield* Ref.make(false);
        const proc = Daemon.make("test/mutation-cancels-stale-pending", {
          schedule: ({ set }) =>
            set([
              Daemon.at("mutator", utcDateFromMillis(0)),
              Daemon.at("kickoff", utcDateFromMillis(10_000)),
            ]),
          effect: Effect.gen(function* () {
            const currentId = yield* Daemon.currentScheduleId;
            const controls = yield* Daemon.scheduleControls;
            yield* Option.match(currentId, {
              onNone: () => Effect.void,
              onSome: (id) =>
                id === "mutator"
                  ? Effect.gen(function* () {
                      if (!(yield* Ref.get(mutated))) {
                        yield* Ref.set(mutated, true);
                        yield* controls.set([Daemon.at("kickoff", utcDateFromMillis(30_000))]);
                      }
                    })
                  : Ref.update(ticks, (n) => n + 1),
            });
          }),
        });

        const fib = yield* Effect.forkChild(proc.effect);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Effect.yieldNow;

        yield* TestClock.adjust(Duration.seconds(14));
        yield* Effect.yieldNow;
        expect(yield* Ref.get(ticks)).toBe(0);
        yield* Fiber.interrupt(fib);
      }).pipe(
      Effect.provide(clock),
      Effect.scoped,
    ),
);

});
