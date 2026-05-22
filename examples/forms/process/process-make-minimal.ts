/**
 * @module examples/forms/process/process-make-minimal
 *
 * `Process.make` — handle API, fork `process.effect`, scoped shutdown.
 * Run: `pnpm run example:form:process-make-minimal`
 */

import { Duration, Effect, Fiber, Ref } from "effect";
import { Polling, Process, ProcessStore } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

const program = Effect.gen(function* () {
  const ticks = yield* Ref.make(0);

  const heartbeat = Process.make("@examples/process-make-minimal", {
    effect: Ref.update(ticks, (n) => n + 1),
    polling: Polling.spaced(Duration.millis(50)),
  });

  const driver = yield* Effect.forkChild(heartbeat.effect);
  yield* Effect.sleep(Duration.millis(180));
  yield* Fiber.interrupt(driver);

  const count = yield* Ref.get(ticks);
  yield* Effect.logInfo(`ticks after driver: ${String(count)} (expect ≥ 1)`);
}).pipe(Effect.scoped);

runNodeProgramWithLayer(program, ProcessStore.layer, "form:process-make-minimal finished OK");
