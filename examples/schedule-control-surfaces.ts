/**
 * @module examples/schedule-control-surfaces
 *
 * Schedule-control patterns for the current process runtime.
 *
 * This file demonstrates three places you can control schedules:
 * 1) `schedule` initializer controls (`set`, `add`, `clear`, `entries`)
 * 2) inside the running process `effect` (`Process.scheduleControls`)
 * 3) from an external controller fiber via `ProcessSchedule` service
 */

import { Duration, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule, ProcessStore } from "../src";
import { runNodeProgramOrExit } from "./mocks/demo-harness.mock.js";

const initializerControlsDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── demo 1: initializer controls (set/add) ──");
  const ticks = yield* Ref.make(0);

  const proc = Process.make({
    name: "examples/schedule-initializer-controls",
    polling: Polling.spaced(Duration.millis(100)),
    schedule: ({ entries, set, add }) =>
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(10));
        yield* set([
          ProcessSchedule.window("init-window", new Date(0), new Date(700)),
        ]);
        const existing = yield* entries;
        if (existing.length === 1) {
          yield* add(ProcessSchedule.window("late-window", new Date(1_200), new Date(1_700)));
        }
      }),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const fib = yield* Effect.forkChild(proc.effect.pipe(Effect.provide(ProcessStore.layer)));
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`  ticks across startup windows: ${yield* Ref.get(ticks)}`);
});

const effectControlsDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── demo 2: effect controls (Process.scheduleControls) ──");
  const seenIds = yield* Ref.make<ReadonlyArray<string>>([]);

  const proc = Process.make({
    name: "examples/schedule-effect-controls",
    polling: Polling.spaced(Duration.millis(100)),
    schedule: ({ set }) =>
      set([
        ProcessSchedule.window("first-window", new Date(0), new Date(700)),
        ProcessSchedule.window("second-window", new Date(1_500), new Date(2_200)),
      ]),
    effect: Effect.gen(function* () {
      const controls = yield* Process.scheduleControls;
      const currentId = yield* Process.currentScheduleId;
      const all = yield* controls.entries;

      if (all.length > 1) {
        yield* controls.set(all.slice(0, 1));
      }

      yield* Option.match(currentId, {
        onNone: () => Effect.void,
        onSome: (id) => Ref.update(seenIds, (ids) => [...ids, id]),
      });
    }),
  });

  const fib = yield* Effect.forkChild(proc.effect.pipe(Effect.provide(ProcessStore.layer)));
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);

  const ids = yield* Ref.get(seenIds);
  yield* Effect.logInfo(
    `  ids observed after in-effect schedule pruning: ${ids.length === 0 ? "(none)" : ids.join(", ")}`,
  );
});

const externalControllerDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── demo 3: external controller fiber (service-level controls) ──");
  const ticks = yield* Ref.make(0);
  const scheduleLayer = ProcessSchedule.inMemory([
    ProcessSchedule.window("external-1", new Date(0), new Date(500)),
  ]);
  const runtimeLayer = Layer.mergeAll(ProcessStore.layer, scheduleLayer);

  const proc = Process.make({
    name: "examples/schedule-external-controller",
    polling: Polling.spaced(Duration.millis(100)),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const controller = Effect.gen(function* () {
    const schedule = yield* ProcessSchedule;
    yield* Effect.sleep(Duration.millis(900));
    yield* schedule.add(
      ProcessSchedule.window("external-2", new Date(900), new Date(1_500)),
    );
    yield* Effect.sleep(Duration.millis(700));
    yield* schedule.set([
      ProcessSchedule.window("external-2", new Date(900), new Date(1_500)),
    ]);
  });

  yield* Effect.gen(function* () {
    const supervised = yield* Effect.forkChild(proc.effect);
    const side = yield* Effect.forkChild(controller);
    yield* TestClock.adjust(Duration.seconds(3));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(side);
    yield* Fiber.interrupt(supervised);
  }).pipe(Effect.provide(runtimeLayer));

  yield* Effect.logInfo(`  ticks with external schedule controller: ${yield* Ref.get(ticks)}`);
});

const program = Effect.gen(function* () {
  yield* initializerControlsDemo;
  yield* TestClock.setTime(0);
  yield* Effect.logInfo("");

  yield* effectControlsDemo;
  yield* TestClock.setTime(0);
  yield* Effect.logInfo("");

  yield* externalControllerDemo;
}).pipe(
  Effect.provide(TestClock.layer()),
  Effect.scoped,
);

runNodeProgramOrExit(program, "✅ schedule-control-surfaces.ts finished");
