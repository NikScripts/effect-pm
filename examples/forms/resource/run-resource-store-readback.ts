/**
 * @module examples/forms/resource/run-resource-store-readback
 *
 * RunResource engine auto-writes run facts + state history; read them back via
 * {@link Store.Service} registration (`RunResource.store`) on an app store layer.
 *
 * `DemoStore.layerMemory` provides `StoreScopeBridgeTag` (same role as
 * {@link Store.layerDefaultMemory} when you have no custom aggregate store).
 *
 * Run: `pnpm run example:run-resource-store-readback`
 */

import { Effect, Layer, Schema } from "effect";
import * as RunResource from "../../../src/RunResource";
import * as Store from "../../../src/Store";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

class PriceGate extends RunResource.Service<PriceGate>()("examples/PriceGate", {
  payload: Schema.Number,
  success: Schema.Number,
  error: Schema.String,
  effect: (n: number) =>
    n >= 0 ? Effect.succeed(n * 10) : Effect.fail("negative price"),
  concurrency: 2,
}) {}

const priceGateStore = RunResource.store(PriceGate);

class DemoStore extends Store.Service<DemoStore>("@examples/RunStore")(priceGateStore) {}

const live = PriceGate.layer.pipe(Layer.provideMerge(DemoStore.layerMemory));

const program = Effect.gen(function* () {
  yield* Effect.log("");
  yield* Effect.log("=== RunResource.store readback after gate.run ===");

  const gate = yield* PriceGate;
  yield* gate.run(3);
  yield* gate.run(-1).pipe(Effect.flip);

  const store = yield* DemoStore.at(PriceGate);
  const facts = yield* store.facts();
  const stateHistory = yield* store.stateHistory({ limit: 20 });

  yield* Effect.log(
    `facts: ${facts.map((row) => `${row.type}(runId=${row.runId})`).join(", ")}`,
  );
  yield* Effect.log(
    `state transitions: ${stateHistory.map((row) => row.reason).join(" → ")}`,
  );
  const completed = yield* gate.completed.get;
  const failed = yield* gate.failed.get;
  yield* Effect.log(
    `latest counters: completed=${String(completed)}, failed=${String(failed)}`,
  );
  yield* Effect.log("");
});

runNodeProgramWithLayer(program, live, "form:run-resource-store-readback finished OK");
