import { ProcessStorage } from "../../../src/ProcessStorage";
/**
 * @module examples/forms/polling/polling-spaced-read
 *
 * Fixed-interval poll — read feed each tick. Run: `pnpm run example:form:polling-spaced-read`
 */

import { DateTime, Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { Process, Polling, ProcessSchedule } from "../../../src";
import {
  forkSupervisedAndSideThenAdvanceTime,
  runNodeProgramWithLayer,
} from "../../shared/demo-harness";
import { makeSportsScoreFeedTestDouble } from "../../shared/sports-score-feed";

const scheduleStartAtUnixEpoch = DateTime.toDateUtc(DateTime.makeUnsafe(0));

const env = Layer.mergeAll(ProcessStorage.layer, TestClock.layer());

const program = Effect.gen(function* () {
  const feed = yield* makeSportsScoreFeedTestDouble();

  const proc = Process.make("examples/forms/polling-spaced-read", {
    // 500 ms so the first tick (t≈500) still sees 0-0 before the feed changes at t≈600.
    polling: Polling.spaced(Duration.millis(500)),
    schedule: ProcessSchedule.inMemory([
      ProcessSchedule.at("sports-basic", scheduleStartAtUnixEpoch),
    ]),
    effect: Effect.gen(function* () {
      // Production: HttpClient.get → parse JSON → GameScore.
      const s = yield* feed.readScore;
      yield* Effect.logInfo(`  score ${s.home}-${s.away}`);
    }),
  });

  yield* forkSupervisedAndSideThenAdvanceTime({
    supervised: proc.effect,
    sideFiber: feed.runSimulator, // delete in production — real APIs update on their own
    advanceBy: Duration.millis(2_200),
  });
}).pipe(Effect.scoped);

runNodeProgramWithLayer(program, env, "form:polling-spaced-read finished");
