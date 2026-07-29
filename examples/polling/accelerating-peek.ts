/**
 * @module examples/polling/accelerating-peek
 *
 * Accelerating poll + resetCadence + peekCadence (verbose). Run: `pnpm run example:polling-accelerating-peek`
 *
 * Docs: `docs/examples/polling/accelerating-peek.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import {
  forkSupervisedAndSideThenAdvanceTime,
  runNodeProgramWithLayer,
} from "../shared/demo-harness";

// ---cut---
import { DateTime, Duration, Effect, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Daemon, Polling } from "../../src";
import {
  makeSportsScoreFeedTestDouble,
  scoreKey,
} from "../shared/sports-score-feed";

// Daemon.at expects Date — build from DateTime, not `new Date()` inside Effect.
const scheduleStartAtUnixEpoch = DateTime.toDateUtc(DateTime.makeUnsafe(0));

const pollLayer = Polling.accelerating({
  fastest: "25 millis",
  slowest: "500 millis",
  decay: 0.55,
});

const scheduleLayer = Daemon.scheduleInMemory([
  Daemon.at("sports-accel-verbose", scheduleStartAtUnixEpoch),
]);

const env = Layer.mergeAll(
  TestClock.layer(),
  pollLayer,
  scheduleLayer,
);

const program = Effect.gen(function* () {
  // Stand-in for your scores API. See shared/sports-score-feed.ts for the scripted timeline.
  const feed = yield* makeSportsScoreFeedTestDouble();

  // Last seen score as "home-away" — cheap per-tick change detection.
  const lastScoreKey = yield* Ref.make<string>(scoreKey({ home: 0, away: 0 }));

  // Replay at end so tick-by-tick output stays readable in one block.
  const events = yield* Ref.make<readonly string[]>([]);
  const logEvent = (line: string): Effect.Effect<void, never, never> =>
    Ref.update(events, (lines) => [...lines, line]).pipe(Effect.asVoid);

  const daemon = Daemon.make("examples/polling-accelerating-peek-cadence", {
    effect: Effect.gen(function* () {
      const snapshot = yield* feed.readScore;
      const prev = yield* Ref.get(lastScoreKey);
      const key = scoreKey(snapshot);

      const polling = yield* Polling.current;
      // Read-only: upcoming wait duration without consuming a tick.
      const peeked = yield* polling.peekCadence;
      const gapMs = Option.match(peeked, {
        onNone: () => "?" as const,
        onSome: (d) => Duration.toMillis(d),
      });

      if (key !== prev) {
        // Snap iteration to 0 and wake the waiter — next gap returns toward maxIntervalMs.
        yield* polling.resetCadence;
        yield* Ref.set(lastScoreKey, key);
        yield* logEvent(
          `SCORE CHANGE → reset cadence | now ${snapshot.home}-${snapshot.away} | next gap≈500 ms again`,
        );
      } else {
        yield* logEvent(
          `poll ok | ${snapshot.home}-${snapshot.away} | next gap ${String(gapMs)} ms (shrinks until reset)`,
        );
      }
    }),
  });

  // Fork daemon + feed simulator, advance TestClock, tear down daemon fiber.
  yield* forkSupervisedAndSideThenAdvanceTime({
    supervised: daemon.effect,
    sideFiber: feed.runSimulator,
    advanceBy: Duration.millis(2_200),
  });

  const lines = yield* Ref.get(events);
  for (const line of lines) {
    yield* Effect.logInfo(`  ${line}`);
  }
}).pipe(Effect.scoped);

// ---cut-after---
runNodeProgramWithLayer(program, env, "form:polling-accelerating-peek-cadence finished");
