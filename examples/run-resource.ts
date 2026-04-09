/**
 * RunResource example
 *
 * Run: `npm run example:run-resource`
 *
 * Demonstrates:
 * - Configuring `effect` + optional `limits` (concurrency / throttle) in one `make()` call
 * - Tag + `.layer`, then `const run = yield* Tag` and `yield* run()` / `yield* run(x)`
 * - Zero-arg `effect` (an `Effect`) vs `effect: (input) => Effect` with `run(input)`
 */

import { Duration, Effect } from "effect";
import { RunResource } from "../src";

/** Records wall time when the gated body actually starts (after exec slot + throttle). */
const TimedWorkGate = RunResource.make({
  name: "TimedWorkGate",
  effect: Effect.gen(function* () {
    const startedAt = Date.now();
    yield* Effect.sleep(Duration.millis(45));
    return startedAt;
  }),
  limits: {
    throttle: { limit: 10, duration: Duration.seconds(1) },
    concurrency: 3,
  },
});

const DoubleGate = RunResource.make({
  name: "DoubleGate",
  effect: (n: number) =>
    Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(8));
      return n * 2;
    }),
  limits: {
    throttle: { limit: 20, duration: Duration.seconds(1) },
    concurrency: 2,
  },
});

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const program = Effect.gen(function* () {
  yield* Effect.log("");
  yield* Effect.log(
    "=== TimedWorkGate: 15 parallel run() calls (throttle 10/s, concurrency 3) ==="
  );

  const timed = yield* TimedWorkGate;
  const startTimes = yield* Effect.all(
    Array.from({ length: 15 }, () => timed()),
    { concurrency: "unbounded" }
  );

  const sorted = [...startTimes].sort((a, b) => a - b);
  const gapsMs = sorted.slice(1).map((t, i) => t - sorted[i]!);

  yield* Effect.log(
    `Median gap between body starts: ${median(gapsMs).toFixed(1)}ms — with limit 10/s and 3 slots, minimum spacing is ~${(1000 / 10 / 3).toFixed(1)}ms`
  );
  yield* Effect.log(`First gaps (ms): ${gapsMs.slice(0, 8).join(", ")}`);

  yield* Effect.log("");
  yield* Effect.log("=== DoubleGate: parameterized effect ===");

  const dbl = yield* DoubleGate;
  const x = yield* dbl(11);
  const y = yield* dbl(21);
  yield* Effect.log(`run(11) => ${x}, run(21) => ${y}`);
  yield* Effect.log("");
});

const runnable = program.pipe(
  Effect.provide(TimedWorkGate.layer),
  Effect.provide(DoubleGate.layer),
);

Effect.runPromise(runnable).then(
  () => {
    console.log("example:run-resource finished OK");
  },
  (e) => {
    console.error(e);
    process.exitCode = 1;
  }
);
