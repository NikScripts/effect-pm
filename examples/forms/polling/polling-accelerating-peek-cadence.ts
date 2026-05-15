/**
 * @module examples/forms/polling/polling-accelerating-peek-cadence
 *
 * Accelerating poll + resetCadence + peekCadence (verbose). Run: `pnpm run example:form:polling-accelerating-peek-cadence`
 */

import { DateTime, Duration, Effect, Layer, Option, Ref } from "effect";
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

// ProcessSchedule.at expects Date — build from DateTime, not `new Date()` inside Effect.
const scheduleStartAtUnixEpoch = DateTime.toDateUtc(DateTime.makeUnsafe(0));

const program = Effect.gen(function* () {
  // Stand-in for your scores API. See shared/sports-score-feed.ts for the scripted timeline.
  const feed = yield* makeSportsScoreFeedTestDouble();

  // Last seen score as "home-away" — cheap per-tick change detection.
  const lastScoreKey = yield* Ref.make<string>(scoreKey({ home: 0, away: 0 }));

  // Replay at end so tick-by-tick output stays readable in one block.
  const events = yield* Ref.make<readonly string[]>([]);
  const logEvent = (line: string): Effect.Effect<void, never, never> =>
    Ref.update(events, (lines) => [...lines, line]).pipe(Effect.asVoid);

  // First gaps ≈ maxIntervalMs (500), then shrink toward minIntervalMs (25) each tick.
  // Merged at fork time (not inlined on Process.make) so resetCadence/peekCadence hit the
  // same Polling instance the supervisor uses for awaitNextTick.
  const pollLayer = Polling.acceleratingScoped({
    minIntervalMs: 25,
    maxIntervalMs: 500,
    decayK: 0.55,
  });

  // Armed from simulated t=0 for the whole run.
  const scheduleLayer = ProcessSchedule.inMemory([
    ProcessSchedule.at("sports-accel-verbose", scheduleStartAtUnixEpoch),
  ]);

  const proc = Process.make({
    name: "examples/forms/polling-accelerating-peek-cadence",
    effect: Effect.gen(function* () {
      const snapshot = yield* feed.readScore;
      const prev = yield* Ref.get(lastScoreKey);
      const key = scoreKey(snapshot);

      const polling = yield* Polling;
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

  // Fork process + feed simulator, advance TestClock, tear down process fiber.
  yield* forkSupervisedAndSideThenAdvanceTime({
    supervised: proc.effect.pipe(
      provideLayer(Layer.mergeAll(ProcessStore.layer, pollLayer, scheduleLayer)),
    ),
    sideFiber: feed.runSimulator,
    advanceBy: Duration.millis(2_200),
  });

  const lines = yield* Ref.get(events);
  for (const line of lines) {
    yield* Effect.logInfo(`  ${line}`);
  }
}).pipe(provideLayer(TestClock.layer()), Effect.scoped);

runNodeProgramOrExit(program, "form:polling-accelerating-peek-cadence finished");
