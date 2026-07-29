/**
 * @module examples/schedule/window
 *
 * Daemon.window — bounded entry. Run: `pnpm run example:schedule-window`
 *
 * Docs: `docs/examples/schedule/window.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramWithLayer } from "../../shared/demo-harness";

// ---cut---
import { Duration, Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Daemon } from "../../src";
import { utcDateFromMillis } from "../../src/internal/utcDate";

const env = TestClock.layer();

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const proc = Daemon.make("examples/schedule-window", {
    polling: Polling.spaced(Duration.millis(100)),
    schedule: Daemon.scheduleInMemory([
      // Armed only between 1000 ms and 1600 ms (simulated). Outside → disarmed, no ticks.
      Daemon.window("window-a", utcDateFromMillis(1_000), utcDateFromMillis(1_600)),
    ]),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const fib = yield* Effect.forkChild(proc.effect);
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`ticks inside window: ${yield* Ref.get(ticks)}`);
}).pipe(Effect.scoped);

// ---cut-after---
runNodeProgramWithLayer(program, env, "form:schedule-window finished");
