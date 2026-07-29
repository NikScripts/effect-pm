/**
 * @module examples/forms/hyperlink/gate-store-readback
 *
 * Gate engine auto-writes run facts + state history; read them back via
 * {@link Store.Service} registration (`Gate.store`) on an app store layer.
 *
 * `DemoStore.layerMemory` provides `StoreScopeBridgeTag` (same role as
 * {@link Store.layerDefaultMemory} when you have no custom aggregate store).
 *
 * Run: `pnpm run example:gate-store-readback`
 *
 * Docs: `docs/examples/hyperlink/gate-store-readback.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramWithLayer } from "../../shared/demo-harness";

// ---cut---
import { Effect, Layer, Schema } from "effect";
import * as Gate from "../../../src/Gate";
import * as Store from "../../../src/Store";

class PriceGate extends Gate.Service<PriceGate>()("examples/PriceGate", {
  payload: Schema.Number,
  success: Schema.Number,
  error: Schema.String,
  effect: (n: number) =>
    n >= 0 ? Effect.succeed(n * 10) : Effect.fail("negative price"),
  concurrency: 2,
}) {}

const priceGateStore = Gate.store(PriceGate);

class DemoStore extends Store.Service<DemoStore>("@examples/RunStore")(priceGateStore) {}

const live = PriceGate.layer.pipe(Layer.provideMerge(DemoStore.layerMemory));

const program = Effect.gen(function* () {
  yield* Effect.log("");
  yield* Effect.log("=== Gate.store readback after gate.run ===");

  const gate = yield* PriceGate;
  yield* gate.run(3);
  yield* gate.run(-1).pipe(Effect.flip);

  const store = yield* DemoStore;
  const facts = yield* store.facts();
  const stateHistory = yield* store.stateHistory({ limit: 20 });

  yield* Effect.log(
    `facts: ${facts.map((row) => `${row._tag}(runId=${row.runId})`).join(", ")}`,
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
// ---cut-after---

runNodeProgramWithLayer(program, live, "form:gate-store-readback finished OK");
