import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Process from "../src/Process";
import * as ProcessStorage from "../src/ProcessStorage";
import * as Store from "../src/Store";
import { Polling } from "../src/Polling";
import { layerDefaultMemory } from "../src/internal/store/scopeBridge";
import { builtInProcessStoreContract } from "../src/internal/store/processStoreSpec";
import { ProcessExecutionStore } from "../src/store/processExecution";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class DualWriteExec extends Process.Tag<DualWriteExec>()("test/dual-write", Price) {}

class DualWriteStore extends Store.Service<DualWriteStore>("@test/DualWriteStore")(
  Store.register(DualWriteExec, builtInProcessStoreContract(DualWriteExec)),
) {}

const storeAndClock = Layer.mergeAll(
  DualWriteStore.layerMemory,
  ProcessStorage.layer,
  TestClock.layer(),
  layerDefaultMemory,
);

const processLayer = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(
    Layer.provide(DualWriteStore.layerMemory),
    Layer.provide(ProcessStorage.layer),
    Layer.provide(layerDefaultMemory),
  );

describe("Process.layer — dual-write to Store + ProcessExecutionStore", () => {
  it.effect("appends to both the built-in store contract and the legacy facet", () =>
    Effect.gen(function* () {
      const live = processLayer(
        Process.layer(DualWriteExec, {
          effect: Effect.succeed({ symbol: "ETH", usd: 3_500 }),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* DualWriteExec;
        yield* TestClock.adjust(Duration.millis(200));

        const store = yield* DualWriteStore.at(DualWriteExec);
        const events = yield* store.events();
        expect(events.some((row) => row._tag === "RunCompleted")).toBe(true);
        expect(events.find((row) => row._tag === "RunCompleted")).toMatchObject({
          result: { symbol: "ETH", usd: 3_500 },
          isStartupRun: true,
        });

        const facet = yield* ProcessExecutionStore;
        const rows = yield* facet.executions({ processId: DualWriteExec.key });
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows.some((row) => row.execution.status === "completed")).toBe(true);
        expect(rows.some((row) => row.execution.isStartupRun)).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );
});
