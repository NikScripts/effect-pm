/**
 * @module examples/run-resource
 *
 * ## **`RunResource`** — concurrency gate around effects
 *
 * `RunResource.make` produces a **gated callable** (a `RunGate<T, A, E>`):
 * a function that wraps each call with a `Semaphore.withPermits(1)`, limiting
 * how many concurrent executions can run through the gate at once.
 *
 * This example runs 15 parallel calls through a gate with concurrency 3
 * to show how the semaphore serializes execution into batches.
 *
 * ### Run
 *
 * ```bash
 * pnpm run example:run-resource
 * ```
 *
 * ### Related examples
 *
 * - **`examples/http-client-run-gate.ts`** — same gate concept on `HttpClient`
 * - **`examples/http-api-resource.ts`** — gate on typed HttpApi client factory
 */

import { Clock, Duration, Effect } from "effect";
import { RunResource } from "../src";
import { provideLayer } from "../src/provideLayer.js";

// ─── Gated callable: records wall time when the body starts ───

class TimedWorkGate extends RunResource.Service<TimedWorkGate, void, number, never>()("examples/TimedWorkGate", {
  effect: () =>
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      yield* Effect.sleep(Duration.millis(45));
      return startedAt;
    }),
  concurrency: 3,
}) {}

// ─── Parameterized gate: doubles a number ───

class DoubleGate extends RunResource.Service<DoubleGate, number, number, never>()("examples/DoubleGate", {
  effect: (n: number) =>
    Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(8));
      return n * 2;
    }),
  concurrency: 2,
}) {}

const median = (xs: ReadonlyArray<number>): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

const program = Effect.gen(function* () {
  yield* Effect.log("");
  yield* Effect.log(
    "=== TimedWorkGate: 15 parallel calls (concurrency 3) ===",
  );

  const timed = yield* TimedWorkGate;
  const startTimes = yield* Effect.all(
    Array.from({ length: 15 }, () => timed(undefined)),
    { concurrency: "unbounded" },
  );

  const sorted = [...startTimes].sort((a, b) => a - b);
  const gapsMs = sorted.slice(1).map((t, i) => t - (sorted[i] ?? 0));

  yield* Effect.log(
    `Median gap between body starts: ${String(median(gapsMs).toFixed(1))}ms — concurrency 3 means batches of 3`,
  );
  yield* Effect.log(`First gaps (ms): ${gapsMs.slice(0, 8).join(", ")}`);

  yield* Effect.log("");
  yield* Effect.log("=== DoubleGate: parameterized effect ===");

  const dbl = yield* DoubleGate;
  const x = yield* dbl(11);
  const y = yield* dbl(21);
  yield* Effect.log(`run(11) => ${String(x)}, run(21) => ${String(y)}`);
  yield* Effect.log("");
});

const runnable = program.pipe(
  provideLayer(TimedWorkGate.layer),
  provideLayer(DoubleGate.layer),
);

void Effect.runPromise(
  runnable.pipe(
    Effect.tap(() => Effect.logInfo("example:run-resource finished OK")),
  ),
);
