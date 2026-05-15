/**
 * @module examples/forms/schedule/schedule-window
 *
 * ProcessSchedule.window — bounded entry. Run: `pnpm run example:form:schedule-window`
 */

import { Duration, Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule, ProcessStore } from "../../../src";
import { runNodeProgramOrExit } from "../../shared/demo-harness";
import { provideLayer } from "../../../src/provideLayer";
import { utcDateFromMillis } from "../../../src/utcDate";

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const proc = Process.make({
    name: "examples/forms/schedule-window",
    polling: Polling.spaced(Duration.millis(100)),
    schedule: ProcessSchedule.inMemory([
      // Armed only between 1000 ms and 1600 ms (simulated). Outside → disarmed, no ticks.
      ProcessSchedule.window("window-a", utcDateFromMillis(1_000), utcDateFromMillis(1_600)),
    ]),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const fib = yield* Effect.forkChild(proc.effect.pipe(provideLayer(ProcessStore.layer)));
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`ticks inside window: ${yield* Ref.get(ticks)}`);
}).pipe(provideLayer(TestClock.layer()), Effect.scoped);

runNodeProgramOrExit(program, "form:schedule-window finished");
