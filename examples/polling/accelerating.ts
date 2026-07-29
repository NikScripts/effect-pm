/**
 * @module examples/polling/accelerating
 *
 * Polling.accelerating only — no feed, no resetCadence. Run: `pnpm run example:polling-accelerating`
 *
 * Docs: `docs/examples/polling/accelerating.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramWithLayer } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Polling, Daemon } from "../../src";
import { utcDateFromMillis } from "../../src/internal/utcDate";

const runtime = Layer.mergeAll(
  Polling.accelerating({
    fastest: "40 millis",
    slowest: "400 millis",
    decay: 0.4,
  }),
  Daemon.scheduleInMemory([
    Daemon.at("polling-accelerating", utcDateFromMillis(0)),
  ]),
);

const env = Layer.mergeAll(TestClock.layer(), runtime);

const program = Effect.gen(function* () {
  const tickCount = yield* Ref.make(0);

  const proc = Daemon.make("examples/polling/polling-accelerating", {
    effect: Ref.update(tickCount, (n) => n + 1),
    schedule: Daemon.scheduleInMemory([
      Daemon.at("polling-accelerating", utcDateFromMillis(0)),
    ]),
  });

  const mainFiber = yield* Effect.forkChild(proc.effect);

  yield* TestClock.adjust(Duration.seconds(2));
  yield* Fiber.interrupt(mainFiber);

  const totalTicks = yield* Ref.get(tickCount);
  yield* Effect.logInfo(
    `ticks in ~2s simulated time: ${totalTicks} (gaps shrink each iteration)`,
  );
}).pipe(Effect.scoped);

// ---cut-after---
runNodeProgramWithLayer(program, env, "example:polling-accelerating finished");
