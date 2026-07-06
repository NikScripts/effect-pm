/**
 * @module examples/forms/resource/run-resource-unit-and-input
 *
 * RunResource unit + input forms. Run: `pnpm run example:run-resource`
 */

import { Clock, Duration, Effect, Layer, Schema } from "effect";
import { RunResource } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

class TimedWorkGate extends RunResource.Service<TimedWorkGate>()(
  "examples/TimedWorkGate",
  Schema.Void,
  Schema.Number,
  {
    effect: () =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        yield* Effect.sleep(Duration.millis(45));
        return startedAt;
      }),
    concurrency: 3,
  },
) {}

class DoubleGate extends RunResource.Service<DoubleGate>()(
  "examples/DoubleGate",
  Schema.Number,
  Schema.Number,
  {
    effect: (n: number) =>
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(8));
        return n * 2;
      }),
    concurrency: 2,
  },
) {}

const median = (xs: ReadonlyArray<number>): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

const program = Effect.gen(function* () {
  yield* Effect.log("");
  yield* Effect.log("=== TimedWorkGate: 15 parallel calls (concurrency 3) ===");

  const timed = yield* TimedWorkGate;
  const startTimes = yield* Effect.all(
    Array.from({ length: 15 }, () => timed.run()),
    { concurrency: "unbounded" },
  );

  const sorted = [...startTimes].sort((a, b) => a - b);
  const gapsMs = sorted.slice(1).map((t, i) => t - (sorted[i] ?? 0));

  yield* Effect.log(
    `Median gap between body starts: ${String(median(gapsMs).toFixed(1))}ms — batches of 3`,
  );
  yield* Effect.log(`First gaps (ms): ${gapsMs.slice(0, 8).join(", ")}`);

  yield* Effect.log("");
  yield* Effect.log("=== DoubleGate: parameterized effect + static .run shortcut ===");

  const dbl = yield* DoubleGate;
  const x = yield* dbl.run(11);
  const y = yield* DoubleGate.run(21);
  yield* Effect.log(`run(11) => ${String(x)}, run(21) => ${String(y)}`);

  const inFlight = yield* dbl.inFlight.get;
  yield* Effect.log(`DoubleGate inFlight after runs: ${String(inFlight)}`);
  yield* Effect.log("");
});

const mainLayer = Layer.mergeAll(TimedWorkGate.layer, DoubleGate.layer);

runNodeProgramWithLayer(program, mainLayer, "form:run-resource-unit-and-input finished OK");
