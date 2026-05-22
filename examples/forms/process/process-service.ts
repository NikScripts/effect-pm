/**
 * @module examples/forms/process/process-service
 *
 * `Process.Service` — Context tag + `.layer` for typed `ProcessGroup` entries.
 * Run: `pnpm run example:form:process-service`
 */

import { Duration, Effect, Fiber, Layer } from "effect";
import { Polling, Process, ProcessStore } from "../../../src";
class Heartbeat extends Process.Service<Heartbeat>()("@examples/process-service/Heartbeat", {
  effect: Effect.logInfo("heartbeat tick"),
  polling: Polling.spaced(Duration.millis(50)),
}) {}

const program = Effect.scoped(
  Effect.gen(function* () {
    const proc = yield* Heartbeat;
    const driver = yield* Effect.forkChild(proc.effect);
    yield* Effect.sleep(Duration.millis(180));
    yield* Fiber.interrupt(driver);

    const store = yield* ProcessStore;
    const executions = yield* store.getProcessExecutions(proc.name);
    yield* Effect.logInfo(
      `process name: ${proc.name}; executions: ${String(executions.length)} (expect ≥ 1)`,
    );
  }).pipe(Effect.provide(Layer.mergeAll(Heartbeat.layer, ProcessStore.layer))),
);

void Effect.runPromise(
  program.pipe(Effect.tap(() => Effect.logInfo("form:process-service finished OK"))),
);
