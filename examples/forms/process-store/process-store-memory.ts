/**
 * @module examples/forms/process-store/process-store-memory
 *
 * **Legacy facet plane** — `ProcessStorage.layer` + `ProcessLifecycleStore` lifecycle rows.
 * This is **not** `Process.store` execution history (`Started` / `Completed` / `Failed` / `Interrupted`).
 * For execution events, start with {@link ./process-layer-store-auto-write.ts}.
 *
 * Run: `npx tsx examples/forms/process-store/process-store-memory.ts`
 */

import { Effect } from "effect";
import * as ProcessStorage from "../../../src/ProcessStorage";
import { ProcessLifecycleStore } from "../../../src/store/processLifecycle";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

const program = Effect.gen(function* () {
  yield* ProcessLifecycleStore.lifecycleChanged({
    processId: "examples/MemoryProcess",
    tag: "Started",
  });

  const lifecycle = yield* ProcessLifecycleStore;
  const events = yield* lifecycle.lifecycle("examples/MemoryProcess");

  yield* Effect.log(
    `memory events: ${events.map((event) => event.id).join(", ")}`,
  );
});

runNodeProgramWithLayer(program, ProcessStorage.layer, "memory store example finished");
