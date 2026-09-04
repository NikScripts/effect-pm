import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Daemon from "../src/Daemon";
import * as Store from "../src/Store";
import * as Polling from "../src/Polling";
import { builtInDaemonStoreContract } from "../src/internal/store/daemonStoreSpec";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class DefaultExec extends Daemon.Service<DefaultExec>()("test/store-default/Default") {}

class OverrideExec extends Daemon.Service<OverrideExec>()("test/store-default/Override", { success: Price }) {}

class OverrideStore extends Store.Service<OverrideStore>("@test/OverrideStore")(
  Store.register(OverrideExec, builtInDaemonStoreContract(OverrideExec)),
) {}

const clock = TestClock.layer();

describe("Daemon.layer — soft-default Memory + AppStore override", () => {
  it.effect("layer alone records terminal runs with no app Store.Service", () =>
    Effect.gen(function* () {
      const live = Daemon.layer(DefaultExec, {
        effect: Effect.void,
        polling: Polling.spaced(Duration.millis(50)),
      });
      yield* Effect.gen(function* () {
        yield* DefaultExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* Store.resolveOrDie(
          DefaultExec.key,
          builtInDaemonStoreContract(DefaultExec),
        );
        const events = yield* store.events();
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events.some((row) => row._tag === "Started")).toBe(true);
        expect(events.find((row) => row._tag === "Completed")?._tag).toBe(
          "Completed",
        );
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );

  it.effect("AppStore via Layer.provideMerge — engine captures app Storage (not layerDefaultMemory)", () =>
    Effect.gen(function* () {
      const live = Daemon.layer(OverrideExec, {
        effect: Effect.succeed({ symbol: "OVERRIDE", usd: 1 }),
        polling: Polling.spaced(Duration.millis(50)),
      }).pipe(Layer.provideMerge(OverrideStore.layerMemory));
      yield* Effect.gen(function* () {
        yield* OverrideExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* OverrideStore;
        const events = yield* store.events();
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events.find((row) => row._tag === "Completed")).toMatchObject({
          success: { symbol: "OVERRIDE", usd: 1 },
        });
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );
});
