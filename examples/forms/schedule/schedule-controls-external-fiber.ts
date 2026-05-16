/**
 * @module examples/forms/schedule/schedule-controls-external-fiber
 *
 * ProcessSchedule service from an external controller fiber. Run: `pnpm run example:form:schedule-controls-external-fiber`
 */

import { Duration, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule, ProcessStore } from "../../../src";
import { runNodeProgramOrExit } from "../../shared/demo-harness";
import { provideLayer } from "../../../src/provideLayer";
import { utcDateFromMillis } from "../../../src/utcDate";

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const scheduleLayer = ProcessSchedule.inMemory([
    ProcessSchedule.window("external-1", utcDateFromMillis(0), utcDateFromMillis(500)),
  ]);
  const runtimeLayer = Layer.mergeAll(ProcessStore.layer, scheduleLayer);

  const proc = Process.make("examples/forms/schedule-controls-external-fiber", {
    polling: Polling.spaced(Duration.millis(100)),
    // No inlined schedule — arms via ProcessSchedule layer at fork site.
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const controller = Effect.gen(function* () {
    const schedule = yield* ProcessSchedule;
    yield* Effect.sleep(Duration.millis(900));
    yield* schedule.add(
      ProcessSchedule.window("external-2", utcDateFromMillis(900), utcDateFromMillis(1_500)),
    );
    yield* Effect.sleep(Duration.millis(700));
    yield* schedule.set([
      ProcessSchedule.window("external-2", utcDateFromMillis(900), utcDateFromMillis(1_500)),
    ]);
  });

  yield* Effect.gen(function* () {
    const supervised = yield* Effect.forkChild(proc.effect);
    const side = yield* Effect.forkChild(controller);
    yield* TestClock.adjust(Duration.seconds(3));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(side);
    yield* Fiber.interrupt(supervised);
  }).pipe(provideLayer(runtimeLayer));

  yield* Effect.logInfo(`ticks with external schedule controller: ${yield* Ref.get(ticks)}`);
}).pipe(provideLayer(TestClock.layer()), Effect.scoped);

runNodeProgramOrExit(program, "form:schedule-controls-external-fiber finished");
