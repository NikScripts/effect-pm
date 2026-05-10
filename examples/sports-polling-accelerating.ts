/**
 * @module examples/sports-polling-accelerating
 *
 * **Three demos, easiest first** (same scripted feed each time — see mock module).
 *
 * 1. **Basic** — **`Polling.spaced` (~500 ms)** so the first tick can still see **0–0** before the
 *    scripted feed updates; each tick **reads** the score and logs it. No **`resetCadence`**.
 * 2. **Accelerating + reset (minimal)** — **`Polling.acceleratingScoped`**; on score change,
 *    **`resetCadence`**; short log lines only (no cadence math).
 * 3. **Accelerating + reset (verbose)** — same logic as (2) plus **`peekCadence`** / gap ms and
 *    an event buffer for post-run review.
 *
 * | Read next | Purpose |
 * |-----------|---------|
 * | **`examples/mocks/sports-score-feed.mock.ts`** | What **`readScore`** / **`runSimulator`** do over simulated time. |
 * | **`examples/mocks/demo-harness.mock.ts`** | **`forkSupervisedAndSideThenAdvanceTime`**, **`runNodeProgramOrExit`**. |
 *
 * **Run:** `pnpm run example:sports-polling-accelerating`
 *
 * **See also:** `examples/process-supervisor-patterns.ts`, `docs/PROCESS-API.md`
 */

import { Duration, Effect, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Process, Polling, ProcessSchedule, ProcessStore } from "../src";
import {
  forkSupervisedAndSideThenAdvanceTime,
  runNodeProgramOrExit,
} from "./mocks/demo-harness.mock.js";
import {
  makeSportsScoreFeedTestDouble,
  scoreKey,
} from "./mocks/sports-score-feed.mock.js";

const basicSportsPollDemo = Effect.gen(function* () {
  yield* Effect.logInfo(
    "── (1) Basic: spaced polling — read feed each tick, log score (no resetCadence) ──",
  );
  const feed = yield* makeSportsScoreFeedTestDouble();

  /** 500 ms so the **first** tick lands before the feed’s first scripted change (600 ms). */
  const proc = Process.make({
    name: "examples/sports-basic-poller",
    polling: Polling.spaced(Duration.millis(500)),
    schedule: ProcessSchedule.inMemory([
      ProcessSchedule.at("sports-basic", new Date(0)),
    ]),
    effect: Effect.gen(function* () {
      const s = yield* feed.readScore;
      yield* Effect.logInfo(`  score ${s.home}-${s.away}`);
    }),
  });

  yield* forkSupervisedAndSideThenAdvanceTime({
    supervised: proc.effect.pipe(Effect.provide(ProcessStore.layer)),
    sideFiber: feed.runSimulator,
    advanceBy: Duration.millis(2_200),
  });
});

const acceleratingScoreResetSimpleDemo = Effect.gen(function* () {
  yield* Effect.logInfo(
    "── (2) Accelerating + reset on score change (small tick body — no peekCadence) ──",
  );
  const feed = yield* makeSportsScoreFeedTestDouble();
  const lastScoreKey = yield* Ref.make<string>(scoreKey({ home: 0, away: 0 }));

  const pollLayer = Polling.acceleratingScoped({
    minIntervalMs: 25,
    maxIntervalMs: 500,
    decayK: 0.55,
  });
  const scheduleLayer = ProcessSchedule.inMemory([
    ProcessSchedule.at("sports-accel-simple", new Date(0)),
  ]);

  const proc = Process.make({
    name: "examples/sports-accel-simple",
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
      Effect.provide(Layer.mergeAll(ProcessStore.layer, pollLayer, scheduleLayer)),
    ),
    sideFiber: feed.runSimulator,
    advanceBy: Duration.millis(2_200),
  });
});

const acceleratingScoreResetVerboseDemo = Effect.gen(function* () {
  yield* Effect.logInfo(
    "── (3) Same as (2) + peekCadence / gap ms + replay buffer (extra teaching detail) ──",
  );
  const feed = yield* makeSportsScoreFeedTestDouble();
  const lastScoreKey = yield* Ref.make<string>(scoreKey({ home: 0, away: 0 }));
  const events = yield* Ref.make<readonly string[]>([]);
  const logEvent = (line: string): Effect.Effect<void, never, never> =>
    Ref.update(events, (lines) => [...lines, line]).pipe(Effect.asVoid);

  const pollLayer = Polling.acceleratingScoped({
    minIntervalMs: 25,
    maxIntervalMs: 500,
    decayK: 0.55,
  });
  const scheduleLayer = ProcessSchedule.inMemory([
    ProcessSchedule.at("sports-accel-verbose", new Date(0)),
  ]);

  const proc = Process.make({
    name: "examples/sports-accel-verbose",
    effect: Effect.gen(function* () {
      const snapshot = yield* feed.readScore;
      const prev = yield* Ref.get(lastScoreKey);
      const key = scoreKey(snapshot);

      const polling = yield* Polling;
      const peeked = yield* polling.peekCadence;
      const gapMs = Option.match(peeked, {
        onNone: () => "?" as const,
        onSome: (d) => Duration.toMillis(d),
      });

      if (key !== prev) {
        yield* polling.resetCadence;
        yield* Ref.set(lastScoreKey, key);
        yield* logEvent(
          `SCORE CHANGE → reset cadence | now ${snapshot.home}-${snapshot.away} | next gap≈500 ms again`,
        );
      } else {
        yield* logEvent(
          `poll ok | ${snapshot.home}-${snapshot.away} | next gap ${String(gapMs)} ms (accelerating shrinks each tick until reset)`,
        );
      }
    }),
  });

  yield* forkSupervisedAndSideThenAdvanceTime({
    supervised: proc.effect.pipe(
      Effect.provide(Layer.mergeAll(ProcessStore.layer, pollLayer, scheduleLayer)),
    ),
    sideFiber: feed.runSimulator,
    advanceBy: Duration.millis(2_200),
  });

  const lines = yield* Ref.get(events);
  for (const line of lines) {
    yield* Effect.logInfo(`  ${line}`);
  }
  yield* Effect.logInfo(
    "  (Each SCORE CHANGE line → cadence snapped back toward ~500 ms.)",
  );
});

const program = Effect.gen(function* () {
  yield* basicSportsPollDemo;
  /** Each demo gets a fresh feed; snap **simulated** time so scripted sleeps line up with the mock doc. */
  yield* TestClock.setTime(0);
  yield* Effect.logInfo("");
  yield* acceleratingScoreResetSimpleDemo;
  yield* TestClock.setTime(0);
  yield* Effect.logInfo("");
  yield* acceleratingScoreResetVerboseDemo;
}).pipe(Effect.provide(TestClock.layer()), Effect.scoped);

runNodeProgramOrExit(program, "✅ sports-polling-accelerating.ts finished");
