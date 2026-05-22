/**
 * @module examples/forms/process/process-run-immediately
 *
 * `runImmediately` — one tracked repeat without forking the driver.
 * Run: `pnpm run example:form:process-run-immediately`
 */

import { Effect } from "effect";
import { Process, ProcessStore } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

const program = Effect.gen(function* () {
  const sync = Process.make("@examples/process-run-immediately", {
    effect: Effect.logInfo("single sync tick"),
  });

  yield* sync.runImmediately();

  const store = yield* ProcessStore;
  const executions = yield* store.getProcessExecutions(sync.name);
  yield* Effect.logInfo(
    `executions recorded: ${String(executions.length)} (expect 1)`,
  );
});

runNodeProgramWithLayer(
  program,
  ProcessStore.layer,
  "form:process-run-immediately finished OK",
);
