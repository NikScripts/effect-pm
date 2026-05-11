/**
 * @module examples/schedule-control-basics
 *
 * Intro schedule patterns:
 * - one-shot starts (`at`)
 * - bounded windows (`window`)
 * - layered composition (`define`)
 *
 * Run:
 * - `pnpm run example:schedule-control-basics`
 * - `npx tsx examples/schedule-control-basics.ts`
 */

import { Duration, Effect, Fiber, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule, ProcessStore } from "../src";
import { runNodeProgramOrExit } from "./mocks/demo-harness.mock.js";

const oneShotAndWindowDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── demo 1: one-shot + bounded window ──");
  const ticks = yield* Ref.make(0);

  const proc = Process.make({
    name: "examples/schedule-basics/one-shot-and-window",
    polling: Polling.spaced(Duration.millis(100)),
    schedule: ProcessSchedule.inMemory([
      // one-shot start: open-ended without stopAt
      ProcessSchedule.at("one-shot", new Date(0)),
      // bounded window: process repeats only while window stays open
      ProcessSchedule.window("window-a", new Date(1_000), new Date(1_600)),
    ]),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const fib = yield* Effect.forkChild(proc.effect.pipe(Effect.provide(ProcessStore.layer)));
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`  total ticks: ${yield* Ref.get(ticks)}`);
});

const defineCompositionDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── demo 2: ProcessSchedule.define composition ──");
  const seen = yield* Ref.make<ReadonlyArray<string>>([]);

  const proc = Process.make({
    name: "examples/schedule-basics/define-composition",
    polling: Polling.spaced(Duration.millis(120)),
    schedule: ProcessSchedule.define(({ all, at, window }) =>
      all(
        at("define-one-shot", new Date(0)),
        window("define-window", new Date(900), new Date(1_500)),
      )
    ),
    effect: Effect.gen(function* () {
      const currentId = yield* Process.currentScheduleId;
      yield* Option.match(currentId, {
        onNone: () => Effect.void,
        onSome: (id) => Ref.update(seen, (ids) => [...ids, id]),
      });
    }),
  });

  const fib = yield* Effect.forkChild(proc.effect.pipe(Effect.provide(ProcessStore.layer)));
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`  ids observed: ${(yield* Ref.get(seen)).join(", ")}`);
});

const program = Effect.gen(function* () {
  yield* oneShotAndWindowDemo;
  yield* TestClock.setTime(0);
  yield* Effect.logInfo("");
  yield* defineCompositionDemo;
}).pipe(
  Effect.provide(TestClock.layer()),
  Effect.scoped,
);

runNodeProgramOrExit(program, "✅ schedule-control-basics.ts finished");
