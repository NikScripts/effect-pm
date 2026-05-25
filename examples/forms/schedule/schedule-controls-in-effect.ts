import { ProcessStorage } from "../../../src/ProcessStorage";
/**
 * @module examples/forms/schedule/schedule-controls-in-effect
 *
 * Process.scheduleControls inside the tick body. Run: `pnpm run example:form:schedule-controls-in-effect`
 */

import { Duration, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process, ProcessSchedule } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";
import { utcDateFromMillis } from "../../../src/internal/utcDate";

const env = Layer.mergeAll(ProcessStorage.layer, TestClock.layer());

const program = Effect.gen(function* () {
  const seenIds = yield* Ref.make<ReadonlyArray<string>>([]);

  const proc = Process.make("examples/forms/schedule-controls-in-effect", {
    polling: Polling.spaced(Duration.millis(100)),
    schedule: ({ set }) =>
      set([
        ProcessSchedule.window("first-window", utcDateFromMillis(0), utcDateFromMillis(700)),
        ProcessSchedule.window("second-window", utcDateFromMillis(1_500), utcDateFromMillis(2_200)),
      ]),
    effect: Effect.gen(function* () {
      const controls = yield* Process.scheduleControls;
      const currentId = yield* Process.currentScheduleId;
      const all = yield* controls.entries;

      // Prune to first entry only while more than one remains.
      if (all.length > 1) {
        yield* controls.set(all.slice(0, 1));
      }

      yield* Option.match(currentId, {
        onNone: () => Effect.void,
        onSome: (id) => Ref.update(seenIds, (ids) => [...ids, id]),
      });
    }),
  });

  const fib = yield* Effect.forkChild(proc.effect);
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);

  const ids = yield* Ref.get(seenIds);
  yield* Effect.logInfo(
    `ids observed after in-effect schedule pruning: ${ids.length === 0 ? "(none)" : ids.join(", ")}`,
  );
}).pipe(Effect.scoped);

runNodeProgramWithLayer(program, env, "form:schedule-controls-in-effect finished");
