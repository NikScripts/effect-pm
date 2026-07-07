import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Process from "../src/Process";
import * as Store from "../src/Store";
import { Polling } from "../src/Polling";
import { StoreScopeBridgeTag } from "../src/internal/store/bridge";
import { builtInProcessStoreContract } from "../src/internal/store/processStoreSpec";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class DefaultExec extends Process.Tag<DefaultExec>()("test/store-default/Default") {}

class OverrideExec extends Process.Tag<OverrideExec>()("test/store-default/Override", Price) {}

class OverrideStore extends Store.Service<OverrideStore>("@test/OverrideStore")(
  Store.register(OverrideExec, builtInProcessStoreContract(OverrideExec)),
) {}

const clock = TestClock.layer();

describe("Process.layer — baked-in default store", () => {
  it.effect("records terminal runs with no external StoreScopeBridgeTag layer", () =>
    Effect.gen(function* () {
      const live = Process.layer(DefaultExec, {
        effect: Effect.void,
        polling: Polling.spaced(Duration.millis(50)),
      });
      yield* Effect.gen(function* () {
        yield* DefaultExec;
        yield* TestClock.adjust(Duration.millis(200));
        const bridge = yield* StoreScopeBridgeTag;
        const store = yield* bridge.at(
          DefaultExec.key,
          builtInProcessStoreContract(DefaultExec),
        );
        const events = yield* store.events();
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[0]?._tag).toBe("RunCompleted");
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );

  it.effect("app Store.Service overrides the baked-in default via provideMerge", () =>
    Effect.gen(function* () {
      const live = Layer.provideMerge(
        OverrideStore.layerMemory,
        Process.layer(OverrideExec, {
          effect: Effect.succeed({ symbol: "OVERRIDE", usd: 1 }),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* OverrideExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* OverrideStore.at(OverrideExec);
        const events = yield* store.events();
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events.find((row) => row._tag === "RunCompleted")).toMatchObject({
          result: { symbol: "OVERRIDE", usd: 1 },
        });
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );
});
