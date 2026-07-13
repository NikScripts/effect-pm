/**
 * @module examples/forms/schedule/schedule-window
 *
 * Process.window — bounded entry. Run: `pnpm run example:form:schedule-window`
 */

import { Duration, Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";
import { utcDateFromMillis } from "../../../src/internal/utcDate";

const env = TestClock.layer();

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const proc = Process.make("examples/forms/schedule-window", {
    polling: Polling.spaced(Duration.millis(100)),
    schedule: Process.scheduleInMemory([
      // Armed only between 1000 ms and 1600 ms (simulated). Outside → disarmed, no ticks.
      Process.window("window-a", utcDateFromMillis(1_000), utcDateFromMillis(1_600)),
    ]),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const fib = yield* Effect.forkChild(proc.effect);
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`ticks inside window: ${yield* Ref.get(ticks)}`);
}).pipe(Effect.scoped);

runNodeProgramWithLayer(program, env, "form:schedule-window finished");
