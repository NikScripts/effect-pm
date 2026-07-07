import * as ProcessStorage from "../../../src/ProcessStorage";
/**
 * @module examples/forms/process-store/process-layer-store-auto-write
 *
 * Process.layer auto-writes terminal runs to Process.store(tag) and the legacy
 * ProcessExecutionStore facet when both are composed.
 * Run: `pnpm run example:process-layer-store-auto-write`
 */

import { Duration, Effect, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Process from "../../../src/Process";
import * as Store from "../../../src/Store";
import { Polling } from "../../../src/Polling";
import { ProcessExecutionStore } from "../../../src/store/processExecution";
import { layerDefaultMemory } from "../../../src/internal/store/scopeBridge";
import { builtInProcessStoreContract } from "../../../src/internal/store/processStoreSpec";
import { runNodeProgramOrExit } from "../../shared/demo-harness";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class PricesProcess extends Process.Tag<PricesProcess>()("examples/Prices", Price) {}

class DemoStore extends Store.Service<DemoStore>("@examples/DemoStore")(
  Store.register(PricesProcess, builtInProcessStoreContract(PricesProcess)),
) {}

const storeEnv = Layer.mergeAll(
  DemoStore.layerMemory,
  ProcessStorage.layer,
  TestClock.layer(),
  layerDefaultMemory,
);

const program = Effect.gen(function* () {
  const live = Process.layer(PricesProcess, {
    effect: Effect.succeed({ symbol: "BTC", usd: 100_000 }),
    polling: Polling.spaced(Duration.millis(50)),
  }).pipe(Layer.provide(DemoStore.layerMemory), Layer.provide(layerDefaultMemory));

  yield* Effect.gen(function* () {
    yield* PricesProcess;
    yield* TestClock.adjust(Duration.millis(200));

    const store = yield* DemoStore.at(PricesProcess);
    const events = yield* store.events();
    const completed = events.find((row) => row._tag === "RunCompleted");
    yield* Effect.log(`built-in store: ${String(events.length)} event(s)`);
    const price =
      completed !== undefined && completed._tag === "RunCompleted"
        ? yield* Schema.decodeUnknownEffect(Price)(completed.result).pipe(Effect.option)
        : Option.none();
    yield* Option.match(price, {
      onNone: () => Effect.log("latest result: none"),
      onSome: (p) =>
        Effect.log(`latest result: ${p.symbol} @ ${String(p.usd)}`),
    });

    const facet = yield* ProcessExecutionStore;
    const rows = yield* facet.executions({ processId: PricesProcess.key });
    yield* Effect.log(
      `legacy facet: ${String(rows.length)} execution row(s), status=${rows[0]?.execution.status ?? "none"}`,
    );
  }).pipe(Effect.provide(live), Effect.scoped);
}).pipe(Effect.provide(storeEnv), Effect.scoped);

runNodeProgramOrExit(program, "process-layer-store-auto-write finished");
