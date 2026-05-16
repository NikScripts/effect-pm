/**
 * @module examples/forms/schedule/schedule-at
 *
 * ProcessSchedule.at — open-ended entry. Run: `pnpm run example:form:schedule-at`
 */

import { Duration, Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule, ProcessStore } from "../../../src";
import { runNodeProgramOrExit } from "../../shared/demo-harness";
import { provideLayer } from "../../../src/provideLayer";
import { utcDateFromMillis } from "../../../src/utcDate";

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const proc = Process.make("examples/forms/schedule-at", {
    polling: Polling.spaced(Duration.millis(100)),
    schedule: ProcessSchedule.inMemory([
      // No stopAt — armed from startAt forward until entry removed or process stopped.
      ProcessSchedule.at("one-shot", utcDateFromMillis(0)),
    ]),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const fib = yield* Effect.forkChild(proc.effect.pipe(provideLayer(ProcessStore.layer)));
  yield* TestClock.adjust(Duration.seconds(2));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`ticks with at entry: ${yield* Ref.get(ticks)}`);
}).pipe(provideLayer(TestClock.layer()), Effect.scoped);

runNodeProgramOrExit(program, "form:schedule-at finished");
