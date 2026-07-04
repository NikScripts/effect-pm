import * as ProcessStorage from "../../../src/ProcessStorage";
/**
 * @module examples/forms/polling/polling-accelerating-reset-cadence
 *
 * Accelerating poll + resetCadence on score change. Run: `pnpm run example:form:polling-accelerating-reset-cadence`
 */

import { DateTime, Duration, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Process, Polling } from "../../../src";
import {
  forkSupervisedAndSideThenAdvanceTime,
  runNodeProgramWithLayer,
} from "../../shared/demo-harness";
import {
  makeSportsScoreFeedTestDouble,
  scoreKey,
} from "../../shared/sports-score-feed";

const scheduleStartAtUnixEpoch = DateTime.toDateUtc(DateTime.makeUnsafe(0));

const pollLayer = Polling.accelerating({
  fastest: "25 millis",
  slowest: "500 millis",
  decay: 0.55,
});
const scheduleLayer = Process.scheduleInMemory([
  Process.at("sports-accel-simple", scheduleStartAtUnixEpoch),
]);

const env = Layer.mergeAll(
  TestClock.layer(),
  ProcessStorage.layer,
  pollLayer,
  scheduleLayer,
);

const program = Effect.gen(function* () {
  const feed = yield* makeSportsScoreFeedTestDouble();
  const lastScoreKey = yield* Ref.make<string>(scoreKey({ home: 0, away: 0 }));

  const proc = Process.make("examples/forms/polling-accelerating-reset-cadence", {
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
    supervised: proc.effect,
    sideFiber: feed.runSimulator,
    advanceBy: Duration.millis(2_200),
  });
}).pipe(Effect.scoped);

runNodeProgramWithLayer(program, env, "form:polling-accelerating-reset-cadence finished");
