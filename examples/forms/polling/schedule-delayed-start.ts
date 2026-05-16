/**
 * @module examples/forms/polling/schedule-delayed-start
 *
 * Zero ticks before schedule startAt. Run: `pnpm run example:form:schedule-delayed-start`
 */

import { Duration, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule, ProcessStore } from "../../../src";
import { provideLayer } from "../../../src/provideLayer";
import { utcDateFromMillis } from "../../../src/utcDate";

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const proc = Process.make("examples/forms/schedule-delayed-start", {
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const runtime = Layer.mergeAll(
    ProcessStore.layer,
    Polling.spaced(Duration.millis(100)),
    ProcessSchedule.inMemory([
      // Disarmed until t=500 ms — supervisor runs but tick body never executes before this.
      ProcessSchedule.at("delayed-start", utcDateFromMillis(500)),
    ]),
  );

  const fib = yield* Effect.forkChild(proc.effect.pipe(provideLayer(runtime)));

  yield* TestClock.adjust(Duration.millis(350));
  const whileDisarmed = yield* Ref.get(ticks);

  yield* TestClock.adjust(Duration.millis(250));
  const afterStart = yield* Ref.get(ticks);

  yield* Fiber.interrupt(fib);

  yield* Effect.logInfo(
    `ticks before startAt: ${whileDisarmed} (expect 0); ticks after startAt: ${afterStart} (expect ≥ 1)`,
  );
}).pipe(provideLayer(TestClock.layer()), Effect.scoped);

void Effect.runPromise(
  program.pipe(Effect.tap(() => Effect.logInfo("form:schedule-delayed-start finished"))),
);
