/**
 * @module examples/forms/polling/polling-accelerating-reset-cadence
 *
 * Accelerating poll + resetCadence on score change. Run: `pnpm run example:form:polling-accelerating-reset-cadence`
 */

import { DateTime, Duration, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Process, Polling, ProcessSchedule, ProcessStore } from "../../../src";
import {
  forkSupervisedAndSideThenAdvanceTime,
  runNodeProgramOrExit,
} from "../../shared/demo-harness";
import { provideLayer } from "../../../src/provideLayer";
import {
  makeSportsScoreFeedTestDouble,
  scoreKey,
} from "../../shared/sports-score-feed";

const scheduleStartAtUnixEpoch = DateTime.toDateUtc(DateTime.makeUnsafe(0));

const program = Effect.gen(function* () {
  const feed = yield* makeSportsScoreFeedTestDouble();
  const lastScoreKey = yield* Ref.make<string>(scoreKey({ home: 0, away: 0 }));

  const pollLayer = Polling.acceleratingScoped({
    minIntervalMs: 25,
    maxIntervalMs: 500,
    decayK: 0.55,
  });
  const scheduleLayer = ProcessSchedule.inMemory([
    ProcessSchedule.at("sports-accel-simple", scheduleStartAtUnixEpoch),
  ]);

  const proc = Process.make({
    name: "examples/forms/polling-accelerating-reset-cadence",
    // pollLayer at fork site — required so resetCadence in the tick hits the supervisor's Polling.
    effect: Effect.gen(function* () {
      const snapshot = yield* feed.readScore;
      const prev = yield* Ref.get(lastScoreKey);
      const key = scoreKey(snapshot);

      if (key !== prev) {
        const polling = yield* Polling;
        yield* polling.resetCadence;
        yield* Ref.set(lastScoreKey, key);
        yield* Effect.logInfo(`  score changed → resetCadence → ${key}`);
      } else {
        yield* Effect.logInfo(`  poll → still ${key}`);
      }
    }),
  });

  yield* forkSupervisedAndSideThenAdvanceTime({
    supervised: proc.effect.pipe(
      provideLayer(Layer.mergeAll(ProcessStore.layer, pollLayer, scheduleLayer)),
    ),
    sideFiber: feed.runSimulator,
    advanceBy: Duration.millis(2_200),
  });
}).pipe(provideLayer(TestClock.layer()), Effect.scoped);

runNodeProgramOrExit(program, "form:polling-accelerating-reset-cadence finished");
