import { ProcessStorage } from "../../../src/ProcessStorage";
/**
 * @module examples/forms/process-store/process-store-memory
 *
 * ProcessStorage in-memory storage + lifecycle facet query.
 * Run: `npx tsx examples/forms/process-store/process-store-memory.ts`
 */

import { Effect } from "effect";
import { ProcessLifecycleScope } from "../../../src/ProcessLifecycleScope";
import { ProcessLifecycleStore } from "../../../src/store/processLifecycle";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

const program = Effect.gen(function* () {
  yield* ProcessLifecycleScope.run(
    { processId: "examples/MemoryProcess" },
    ProcessLifecycleStore.Lifecycle.Started,
  );

  const lifecycle = yield* ProcessLifecycleStore;
  const events = yield* lifecycle.lifecycle("examples/MemoryProcess");

  yield* Effect.log(
    `memory events: ${events.map((event) => event.id).join(", ")}`,
  );
});

runNodeProgramWithLayer(program, ProcessStorage.layer, "memory store example finished");
