/**
 * @module examples/forms/process/process-external-layers
 *
 * Omit `polling` on `Process.make`; provide `Polling` when forking `process.effect`.
 * Schedule gates still belong on `make` — see `schedule-delayed-start` for `TestClock` windows.
 * Run: `pnpm run example:form:process-external-layers`
 */

import { Duration, Effect, Fiber, Ref } from "effect";
import { Polling, Process, ProcessStore } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const proc = Process.make("@examples/process-external-layers", {
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const driver = yield* Effect.forkChild(
    proc.effect.pipe(Effect.provide(Polling.spaced(Duration.millis(50)))),
  );
  yield* Effect.sleep(Duration.millis(180));
  yield* Fiber.interrupt(driver);

  yield* Effect.logInfo(`ticks with external polling: ${String(yield* Ref.get(ticks))} (expect ≥ 1)`);
}).pipe(Effect.scoped);

runNodeProgramWithLayer(program, ProcessStore.layer, "form:process-external-layers finished OK");
