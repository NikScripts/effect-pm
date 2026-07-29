/**
 * @module examples/schedule/controls-initializer
 *
 * Schedule controls from the schedule initializer. Run: `pnpm run example:schedule-controls-initializer`
 *
 * Docs: `docs/examples/schedule/controls-initializer.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramWithLayer } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Daemon } from "../../src";
import { utcDateFromMillis } from "../../src/internal/utcDate";

const env = TestClock.layer();

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const proc = Daemon.make("examples/schedule-controls-initializer", {
    polling: Polling.spaced(Duration.millis(100)),
    // Function form runs once before the supervisor loop — bootstrap from config/DB here.
    schedule: ({ entries, set, add }) =>
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(10));
        yield* set([
          Daemon.window("init-window", utcDateFromMillis(0), utcDateFromMillis(700)),
        ]);
        const existing = yield* entries;
        if (existing.length === 1) {
          yield* add(
            Daemon.window("late-window", utcDateFromMillis(1_200), utcDateFromMillis(1_700)),
          );
        }
      }),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const fib = yield* Effect.forkChild(proc.effect);
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`ticks across startup windows: ${yield* Ref.get(ticks)}`);
}).pipe(Effect.scoped);

// ---cut-after---
runNodeProgramWithLayer(program, env, "form:schedule-controls-initializer finished");
