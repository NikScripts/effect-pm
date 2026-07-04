import * as ProcessStorage from "../../../src/ProcessStorage";
/**
 * @module examples/forms/schedule/schedule-define
 *
 * Process.scheduleDefine composition. Run: `pnpm run example:form:schedule-define`
 */

import { Duration, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Process } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";
import { utcDateFromMillis } from "../../../src/internal/utcDate";

const env = Layer.mergeAll(ProcessStorage.layer, TestClock.layer());

const program = Effect.gen(function* () {
  const seen = yield* Ref.make<ReadonlyArray<string>>([]);

  const proc = Process.make("examples/forms/schedule-define", {
    polling: Polling.spaced(Duration.millis(120)),
    schedule: Process.scheduleDefine(({ all, at, window }) =>
      all(
        at("define-one-shot", utcDateFromMillis(0)),
        window("define-window", utcDateFromMillis(900), utcDateFromMillis(1_500)),
      ),
    ),
    effect: Effect.gen(function* () {
      // Which entry armed this tick instance — useful when multiple windows overlap.
      const currentId = yield* Process.currentScheduleId;
      yield* Option.match(currentId, {
        onNone: () => Effect.void,
        onSome: (id) => Ref.update(seen, (ids) => [...ids, id]),
      });
    }),
  });

  const fib = yield* Effect.forkChild(proc.effect);
  yield* TestClock.adjust(Duration.seconds(3));
  yield* Effect.yieldNow;
  yield* Fiber.interrupt(fib);
  yield* Effect.logInfo(`ids observed: ${(yield* Ref.get(seen)).join(", ")}`);
}).pipe(Effect.scoped);

runNodeProgramWithLayer(program, env, "form:schedule-define finished");
