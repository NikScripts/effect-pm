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
import { runNodeProgramOrExit } from "../shared/demo-harness";
import { provideLayer } from "../../src/provideLayer";
import { utcDateFromMillis } from "../../src/utcDate";

const program = Effect.gen(function* () {
  // Tick counter: only increments inside the process `effect` body (i.e. when schedule allows).
  const pollTicks = yield* Ref.make(0);

  // `Process.make` merges `schedule` + `polling` into the supervisor — fork site only needs
  // `ProcessStore` for execution analytics (same pattern as the main scenario).
  const liveGamePoller = Process.make("examples/game-window-poller", {
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
  });

  // `ProcessGroup.make` does **not** start supervisors — it only registers handles + initial
  // `stopped` status. Empty `queues: []` is valid (see `test/process-group.test.ts`).
  const group = yield* ProcessGroup.make({
    queues: [],
    processes: [liveGamePoller],
  });

  // **This** line forks `liveGamePoller.effect` (driver + inlined schedule/polling). Until
  // here, no runtime fibers are active for the process in a group-managed scope (you could fork
  // `process.effect` yourself without a group; the group adds lifecycle + `stop` /
  // metrics wiring).
  yield* group.start(liveGamePoller.name);

  // Enough simulated time to run the first window.
  yield* TestClock.adjust(Duration.seconds(5));

  const totalTicks = yield* Ref.get(pollTicks);
  yield* Effect.logInfo(
    `── Game-window demo: pollTicks=${totalTicks} (expect > 0 while schedule window is active) ──`,
  );

  // Stop the managed runtime and close its scope.
  yield* group.stop(liveGamePoller.name);
}).pipe(
  provideLayer(Layer.mergeAll(TestClock.layer(), ProcessStore.layer)),
  Effect.scoped,
  Effect.catch((error: ProcessGroupErrors) =>
    Effect.logError(`Game-window demo failed: ${String(error)}`),
  ),
);

runNodeProgramOrExit(program, "scenario:game-window-polling-with-process-group finished");
