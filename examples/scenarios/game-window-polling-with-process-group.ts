/**
 * @module examples/scenarios/game-window-polling-with-process-group
 *
 * ProcessGroup.start + schedule windows. Run: `pnpm run example:process-game-window` — see `docs/SCHEDULE-AND-PROCESSGROUP.md`
 */

import { Duration, Effect, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import {
  Process,
  Polling,
  ProcessGroup,
  type ProcessGroupErrors,
  ProcessSchedule,
  ProcessStore,
} from "../../src";
import { runNodeProgramWithLayer } from "../shared/demo-harness";
import { utcDateFromMillis } from "../../src/utcDate";

/** Shared tick counter across runs (script exits after one invocation). */
const pollTicks = Effect.runSync(Ref.make(0));

class GameWindowPoller extends Process.Service<GameWindowPoller>()(
  "examples/game-window-poller",
  {
    polling: Polling.spaced(Duration.millis(200)),
    schedule: ProcessSchedule.define(({ all, at, window }) =>
      all(
        window("match-101", utcDateFromMillis(0), utcDateFromMillis(2_000)),
        at("match-102", utcDateFromMillis(60_000)),
      )
    ),
    effect: Effect.gen(function* () {
      const scheduleId = yield* Process.currentScheduleId;
      yield* Ref.update(pollTicks, (n) => n + 1);
      yield* Effect.logInfo(
        `tick for ${
          Option.match(scheduleId, {
            onNone: () => "unspecified-window",
            onSome: (id) => id,
          })
        }`,
      );
    }),
  },
) {}

const program = Effect.gen(function* () {
  yield* Ref.set(pollTicks, 0);

  // `ProcessGroup.make` does **not** start supervisors — it only registers handles + initial
  // `stopped` status. Processes without queues use a single-entry tuple.
  const group = yield* ProcessGroup.make("@examples/scenario-game-window", [
    GameWindowPoller,
  ] as const);

  // **This** line forks schedule + polling drivers. Until here, no runtime fibers are active for
  // the process under group lifecycle.
  yield* group.start(GameWindowPoller);

  // Enough simulated time to run the first window.
  yield* TestClock.adjust(Duration.seconds(5));

  const totalTicks = yield* Ref.get(pollTicks);
  yield* Effect.logInfo(
    `── Game-window demo: pollTicks=${totalTicks} (expect > 0 while schedule window is active) ──`,
  );

  yield* group.stop(GameWindowPoller);
}).pipe(
  Effect.scoped,
  Effect.catch((error: ProcessGroupErrors) =>
    Effect.logError(`Game-window demo failed: ${String(error)}`),
  ),
);

runNodeProgramWithLayer(
  program,
  Layer.mergeAll(
    TestClock.layer(),
    ProcessStore.layer,
    GameWindowPoller.layer,
  ),
  "scenario:game-window-polling-with-process-group finished",
);
