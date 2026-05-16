/**
 * @module examples/forms/polling/polling-accelerating
 *
 * Polling.acceleratingScoped only — no feed, no resetCadence. Run: `pnpm run example:form:polling-accelerating`
 */

import { Duration, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule, ProcessStore } from "../../../src";
import { provideLayer } from "../../../src/provideLayer";
import { utcDateFromMillis } from "../../../src/utcDate";

const program = Effect.gen(function* () {
  const tickCount = yield* Ref.make(0);

  const proc = Process.make("examples/forms/polling-accelerating", {
    effect: Ref.update(tickCount, (n) => n + 1),
    schedule: ProcessSchedule.inMemory([
      ProcessSchedule.at("polling-accelerating", utcDateFromMillis(0)),
    ]),
  });

  const runtime = Layer.mergeAll(
    ProcessStore.layer,
    Polling.acceleratingScoped({
      minIntervalMs: 40,
      maxIntervalMs: 400,
      decayK: 0.4,
    }),
    ProcessSchedule.inMemory([
      ProcessSchedule.at("polling-accelerating", utcDateFromMillis(0)),
    ]),
  );

  const mainFiber = yield* Effect.forkChild(proc.effect.pipe(provideLayer(runtime)));

  yield* TestClock.adjust(Duration.seconds(2));
  yield* Fiber.interrupt(mainFiber);

  const totalTicks = yield* Ref.get(tickCount);
  yield* Effect.logInfo(
    `ticks in ~2s simulated time: ${totalTicks} (gaps shrink each iteration)`,
  );
}).pipe(provideLayer(TestClock.layer()), Effect.scoped);

void Effect.runPromise(
  program.pipe(Effect.tap(() => Effect.logInfo("form:polling-accelerating finished"))),
);
