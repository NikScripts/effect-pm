import { describe, expect, it } from "@effect/vitest";
import { Deferred, Duration, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Process from "../src/Process";
import * as Store from "../src/Store";
import { Polling } from "../src/Polling";
import { builtInProcessStoreContract } from "../src/internal/store/processStoreSpec";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

class VoidExec extends Process.Tag<VoidExec>()("test/engine/Void") {}

class PricedExec extends Process.Tag<PricedExec>()("test/engine/Priced", Price) {}

class FailingExec extends Process.Tag<FailingExec>()(
  "test/engine/Failing",
  Price,
  FetchErr,
) {}

class InterruptExec extends Process.Tag<InterruptExec>()("test/engine/Interrupt") {}

class EngineStore extends Store.Service<EngineStore>("@test/EngineStore")(
  Store.register(VoidExec, builtInProcessStoreContract(VoidExec)),
  Store.register(PricedExec, builtInProcessStoreContract(PricedExec)),
  Store.register(FailingExec, builtInProcessStoreContract(FailingExec)),
  Store.register(InterruptExec, builtInProcessStoreContract(InterruptExec)),
) {}

const processLayer = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Layer.provideMerge(EngineStore.layerMemory, layer);

const storeAndClock = Layer.mergeAll(EngineStore.layerMemory, TestClock.layer());

describe("Process.layer — Process.store auto-write", () => {
  it.effect("records void run completion via the built-in store contract", () =>
    Effect.gen(function* () {
      const live = processLayer(
        Process.layer(VoidExec, {
          effect: Effect.void,
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* VoidExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* EngineStore.at(VoidExec);
        const events = yield* store.events();
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[0]?._tag).toBe("RunCompleted");
        expect(events[0]).toMatchObject({
          processId: VoidExec.key,
          isStartupRun: true,
        });
        expect(yield* store.hasPriorExecutions()).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );

  it.effect("records optional result on value-returning processes", () =>
    Effect.gen(function* () {
      const live = processLayer(
        Process.layer(PricedExec, {
          effect: Effect.succeed({ symbol: "AAPL", usd: 42 }),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* PricedExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* EngineStore.at(PricedExec);
        const events = yield* store.events();
        const completed = events.find((row) => row._tag === "RunCompleted");
        expect(completed).toMatchObject({
          result: { symbol: "AAPL", usd: 42 },
        });
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );

  it.effect("encodes typed failures when error is stamped on the tag", () =>
    Effect.gen(function* () {
      const fail = yield* Schema.decodeUnknownEffect(FetchErr)({
        _tag: "FetchError",
        status: 503,
      });
      const live = processLayer(
        Process.layer(FailingExec, {
          effect: Effect.fail(fail),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* FailingExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* EngineStore.at(FailingExec);
        const events = yield* store.events();
        const failed = events.find((row) => row._tag === "RunFailed");
        expect(failed).toMatchObject({
          error: { _tag: "FetchError", status: 503 },
        });
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );

  it.effect("records RunInterrupted when a run is interrupted mid-effect", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void, never>();
      const hold = yield* Deferred.make<void, never>();
      const live = processLayer(
        Process.layer(InterruptExec, {
          effect: Effect.gen(function* () {
            yield* Deferred.succeed(entered, void 0);
            yield* Deferred.await(hold);
          }),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        const proc = yield* InterruptExec;
        yield* TestClock.adjust(Duration.millis(100));
        yield* Deferred.await(entered);
        yield* proc.stop;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        const store = yield* EngineStore.at(InterruptExec);
        const events = yield* store.events();
        const interrupted = events.find((row) => row._tag === "RunInterrupted");
        expect(interrupted).toMatchObject({
          processId: InterruptExec.key,
          isStartupRun: true,
        });
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );
});
