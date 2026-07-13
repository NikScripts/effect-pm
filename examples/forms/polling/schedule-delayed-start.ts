/**
 * @module examples/forms/polling/schedule-delayed-start
 *
 * Zero ticks before schedule startAt. Run: `pnpm run example:form:schedule-delayed-start`
 */

import { Duration, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";
import { utcDateFromMillis } from "../../../src/internal/utcDate";

const runtime = Layer.mergeAll(
  Polling.spaced(Duration.millis(100)),
  Process.scheduleInMemory([
    // Disarmed until t=500 ms — supervisor runs but tick body never executes before this.
    Process.at("delayed-start", utcDateFromMillis(500)),
  ]),
);

const env = Layer.mergeAll(TestClock.layer(), runtime);

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const proc = Process.make("examples/forms/schedule-delayed-start", {
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const fib = yield* Effect.forkChild(proc.effect);

  yield* TestClock.adjust(Duration.millis(350));
  const whileDisarmed = yield* Ref.get(ticks);

  yield* TestClock.adjust(Duration.millis(250));
  const afterStart = yield* Ref.get(ticks);

  yield* Fiber.interrupt(fib);

  yield* Effect.logInfo(
    `ticks before startAt: ${whileDisarmed} (expect 0); ticks after startAt: ${afterStart} (expect ≥ 1)`,
  );
}).pipe(Effect.scoped);

runNodeProgramWithLayer(program, env, "form:schedule-delayed-start finished");
