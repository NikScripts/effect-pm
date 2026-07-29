/**
 * @module examples/schedule/controls-external-fiber
 *
 * Drive a running daemon's schedule from an EXTERNAL controller fiber. The schedule initializer
 * seeds the first window and hands the live `Daemon.ScheduleControls` to a shared `Ref`; a separate
 * fiber then arms/replaces windows through those controls.
 * Run: `pnpm run example:schedule-controls-external-fiber`
 *
 * Docs: `docs/examples/schedule/controls-external-fiber.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramWithLayer } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Fiber, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Daemon } from "../../src";
import { utcDateFromMillis } from "../../src/internal/utcDate";

const env = TestClock.layer();

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);
  // The live schedule controls, published by the initializer for the external controller to use.
  const controlsRef = yield* Ref.make<Option.Option<Daemon.ScheduleControls>>(
    Option.none(),
  );

  const daemon = Daemon.make("examples/schedule-controls-external-fiber", {
    polling: Polling.spaced(Duration.millis(100)),
    // Seed the first window, then hand the live controls to the external controller fiber.
    schedule: (controls) =>
      controls
        .set([Daemon.window("external-1", utcDateFromMillis(0), utcDateFromMillis(500))])
        .pipe(Effect.andThen(Ref.set(controlsRef, Option.some(controls)))),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const controller = Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(900));
    const controls = yield* Ref.get(controlsRef);
    yield* Option.match(controls, {
      onNone: () => Effect.void,
      onSome: (c) =>
        c.add(Daemon.window("external-2", utcDateFromMillis(900), utcDateFromMillis(1_500))),
    });
    yield* Effect.sleep(Duration.millis(700));
    yield* Option.match(controls, {
      onNone: () => Effect.void,
      onSome: (c) =>
        c.set([Daemon.window("external-2", utcDateFromMillis(900), utcDateFromMillis(1_500))]),
    });
  });

  const supervised = yield* Effect.forkChild(daemon.effect);
  const side = yield* Effect.forkChild(controller);
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(side);
  yield* Fiber.interrupt(supervised);

  yield* Effect.logInfo(`ticks with external schedule controller: ${yield* Ref.get(ticks)}`);
}).pipe(Effect.scoped);

// ---cut-after---
runNodeProgramWithLayer(program, env, "form:schedule-controls-external-fiber finished");
