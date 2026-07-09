/**
 * @module examples/forms/process-store/process-layer-typed-error-store
 *
 * `Process.layer` auto-writes typed `Failed.error` when the tag stamps an `error` schema.
 * Register the tag on an app `Store.Service` for durable reads.
 * Run: `pnpm run example:process-layer-typed-error-store`
 */

import { Duration, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Process from "../../../src/Process";
import * as Store from "../../../src/Store";
import { Polling } from "../../../src/Polling";
import { builtInProcessStoreContract } from "../../../src/internal/store/processStoreSpec";
import { runNodeProgramOrExit } from "../../shared/demo-harness";

const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

class FailingPrices extends Process.Tag<FailingPrices>()("examples/FailingPrices", {
  error: FetchErr,
}) {}

class DemoStore extends Store.Service<DemoStore>("@examples/DemoStore")(
  Store.register(FailingPrices, builtInProcessStoreContract(FailingPrices)),
) {}

const storeEnv = Layer.mergeAll(DemoStore.layerMemory, TestClock.layer());

const program = Effect.gen(function* () {
  const fail = yield* Schema.decodeUnknownEffect(FetchErr)({
    _tag: "FetchError",
    status: 503,
  });
  const live = Process.layer(FailingPrices, {
    effect: Effect.fail(fail),
    polling: Polling.spaced(Duration.millis(50)),
  }).pipe(Layer.provideMerge(DemoStore.layerMemory));

  yield* Effect.gen(function* () {
    yield* FailingPrices;
    yield* TestClock.adjust(Duration.millis(200));

    const store = yield* DemoStore.at(FailingPrices);
    const events = yield* store.events();
    const failed = events.find((row) => row._tag === "Failed");
    yield* Effect.log(
      `failed row present: ${String(failed !== undefined && failed._tag === "Failed")}`,
    );
  }).pipe(Effect.provide(live), Effect.scoped);
}).pipe(Effect.provide(storeEnv), Effect.scoped, Effect.orDie);

runNodeProgramOrExit(program, "process-layer-typed-error-store finished");
