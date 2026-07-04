import * as ProcessStorage from "../../../src/ProcessStorage";
/**
 * @module examples/forms/schedule/schedule-at
 *
 * Process.at — open-ended entry. Run: `pnpm run example:form:schedule-at`
 */

import { Duration, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";
import { utcDateFromMillis } from "../../../src/internal/utcDate";

const env = Layer.mergeAll(ProcessStorage.layer, TestClock.layer());

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const proc = Process.make("examples/forms/schedule-at", {
    polling: Polling.spaced(Duration.millis(100)),
    schedule: Process.scheduleInMemory([
      // No stopAt — armed from startAt forward until entry removed or process stopped.
      Process.at("one-shot", utcDateFromMillis(0)),
    ]),
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const fib = yield* Effect.forkChild(proc.effect);
  yield* TestClock.adjust(Duration.seconds(2));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`ticks with at entry: ${yield* Ref.get(ticks)}`);
}).pipe(Effect.scoped);

runNodeProgramWithLayer(program, env, "form:schedule-at finished");
