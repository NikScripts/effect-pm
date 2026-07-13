/**
 * @module examples/forms/process-store/process-layer-store-auto-write
 *
 * Process.layer auto-writes terminal runs to Process.store(tag). The layer includes a baked-in
 * default in-memory store; override with AppStore.layerMemory via Layer.provideMerge.
 * Run: `pnpm run example:process-layer-store-auto-write`
 */

import { Duration, Effect, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Process from "../../../src/Process";
import * as Store from "../../../src/Store";
import { Polling } from "../../../src/Polling";
import { builtInProcessStoreContract } from "../../../src/internal/store/processStoreSpec";
import { runNodeProgramOrExit } from "../../shared/demo-harness";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class PricesProcess extends Process.Tag<PricesProcess>()("examples/Prices", { success: Price }) {}

class DemoStore extends Store.Service<DemoStore>("@examples/DemoStore")(
  Store.register(PricesProcess, builtInProcessStoreContract(PricesProcess)),
) {}

const storeEnv = Layer.mergeAll(DemoStore.layerMemory, TestClock.layer());

const program = Effect.gen(function* () {
  const live = Process.layer(PricesProcess, {
    effect: Effect.succeed({ symbol: "BTC", usd: 100_000 }),
    polling: Polling.spaced(Duration.millis(50)),
  }).pipe(Layer.provideMerge(DemoStore.layerMemory));

  yield* Effect.gen(function* () {
    yield* PricesProcess;
    yield* TestClock.adjust(Duration.millis(200));

    const store = yield* DemoStore;
    const events = yield* store.events();
    const completed = events.find((row) => row._tag === "Completed");
    yield* Effect.log(`built-in store: ${String(events.length)} event(s)`);
    const price =
      completed !== undefined &&
      completed._tag === "Completed" &&
      "success" in completed &&
      completed.success !== undefined
        ? yield* Schema.decodeUnknownEffect(Price)(completed.success).pipe(Effect.option)
        : Option.none();
    yield* Option.match(price, {
      onNone: () => Effect.log("latest result: none"),
      onSome: (p) =>
        Effect.log(`latest result: ${p.symbol} @ ${String(p.usd)}`),
    });
  }).pipe(Effect.provide(live), Effect.scoped);
}).pipe(Effect.provide(storeEnv), Effect.scoped, Effect.orDie);

runNodeProgramOrExit(program, "process-layer-store-auto-write finished");
