import { describe, expect, it } from "@effect/vitest";
import { Data, DateTime, Deferred, Duration, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Daemon from "../src/Daemon";
import * as Store from "../src/Store";
import * as Polling from "../src/Polling";
import { builtInDaemonStoreContract } from "../src/internal/store/daemonStoreSpec";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });
const Snapshot = Schema.Struct({
  at: Schema.DateTimeUtc,
  count: Schema.Number,
});

class VoidExec extends Daemon.Tag<VoidExec>()("test/engine/Void") {}

class PricedExec extends Daemon.Tag<PricedExec>()("test/engine/Priced", { success: Price }) {}

class FailingExec extends Daemon.Tag<FailingExec>()("test/engine/Failing", {
  success: Price,
  error: FetchErr,
}) {}

class StringFailExec extends Daemon.Tag<StringFailExec>()("test/engine/StringFail") {}

class RichSuccessExec extends Daemon.Tag<RichSuccessExec>()("test/engine/RichSuccess", {
  success: Snapshot,
}) {}

class InterruptExec extends Daemon.Tag<InterruptExec>()("test/engine/Interrupt") {}

class ServeExec extends Daemon.Tag<ServeExec>()("test/engine/Serve") {}

class ServeRemoteExec extends Daemon.Tag<ServeRemoteExec>()("test/engine/ServeRemote") {}

class Boom extends Data.TaggedError("Boom")<{ readonly code: number }> {}

class EngineStore extends Store.Service<EngineStore>("@test/EngineStore")(
  Store.register(VoidExec, builtInDaemonStoreContract(VoidExec)),
  Store.register(PricedExec, builtInDaemonStoreContract(PricedExec)),
  Store.register(FailingExec, builtInDaemonStoreContract(FailingExec)),
  Store.register(StringFailExec, builtInDaemonStoreContract(StringFailExec)),
  Store.register(RichSuccessExec, builtInDaemonStoreContract(RichSuccessExec)),
  Store.register(InterruptExec, builtInDaemonStoreContract(InterruptExec)),
  Store.register(ServeExec, builtInDaemonStoreContract(ServeExec)),
  Store.register(ServeRemoteExec, builtInDaemonStoreContract(ServeRemoteExec)),
) {}

const daemonLayer = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(Layer.provideMerge(EngineStore.layerMemory));

const storeAndClock = Layer.mergeAll(EngineStore.layerMemory, TestClock.layer());

describe("Daemon.layer — Daemon.store auto-write", () => {
  it.effect("records void run completion via the built-in store contract", () =>
    Effect.gen(function* () {
      const live = daemonLayer(
        Daemon.layer(VoidExec, {
          effect: Effect.void,
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* VoidExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* EngineStore.at(VoidExec);
        const events = yield* store.events();
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events.some((row) => row._tag === "Started")).toBe(true);
        const completed = events.find((row) => row._tag === "Completed");
        expect(completed).toMatchObject({
          key: VoidExec.key,
          isStartupRun: true,
        });
        expect(yield* store.hasPriorExecutions()).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );

  it.effect("records optional success on value-returning daemons", () =>
    Effect.gen(function* () {
      const live = daemonLayer(
        Daemon.layer(PricedExec, {
          effect: Effect.succeed({ symbol: "AAPL", usd: 42 }),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* PricedExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* EngineStore.at(PricedExec);
        const events = yield* store.events();
        const completed = events.find((row) => row._tag === "Completed");
        expect(completed).toMatchObject({
          success: { symbol: "AAPL", usd: 42 },
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
      const live = daemonLayer(
        Daemon.layer(FailingExec, {
          effect: Effect.fail(fail),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* FailingExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* EngineStore.at(FailingExec);
        const events = yield* store.events();
        const failed = events.find((row) => row._tag === "Failed");
        expect(failed).toMatchObject({
          error: { _tag: "FetchError", status: 503 },
        });
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );

  it.effect("records Interrupted when a run is interrupted mid-effect", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void, never>();
      const hold = yield* Deferred.make<void, never>();
      const live = daemonLayer(
        Daemon.layer(InterruptExec, {
          effect: Effect.gen(function* () {
            yield* Deferred.succeed(entered, void 0);
            yield* Deferred.await(hold);
          }),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        const daemon = yield* InterruptExec;
        yield* TestClock.adjust(Duration.millis(100));
        yield* Deferred.await(entered);
        yield* daemon.stop;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        const store = yield* EngineStore.at(InterruptExec);
        const events = yield* store.events();
        const interrupted = events.find((row) => row._tag === "Interrupted");
        expect(interrupted).toMatchObject({
          key: InterruptExec.key,
          isStartupRun: true,
        });
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );

  it.effect("stringifies Failed.error when the tag has no error schema", () =>
    Effect.gen(function* () {
      const boom = new Boom({ code: 9 });
      const live = daemonLayer(
        Daemon.layer(StringFailExec, {
          effect: Effect.fail(boom),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* StringFailExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* EngineStore.at(StringFailExec);
        const events = yield* store.events();
        const failed = events.find((row) => row._tag === "Failed");
        expect(failed).toMatchObject({
          error: String(boom),
        });
        expect(typeof failed?.error).toBe("string");
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );

  it.effect("round-trips rich success values through the journal codec", () =>
    Effect.gen(function* () {
      const at = DateTime.makeUnsafe("2026-02-01T12:00:00.000Z");
      const live = daemonLayer(
        Daemon.layer(RichSuccessExec, {
          effect: Effect.succeed({ at, count: 7 }),
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* RichSuccessExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* EngineStore.at(RichSuccessExec);
        const events = yield* store.events();
        const completed = events.find((row) => row._tag === "Completed");
        expect(completed).toMatchObject({
          success: { at, count: 7 },
        });
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );
});

describe("Daemon.serve / serveRemote — store auto-write", () => {
  it.effect("Daemon.serve records terminal runs via the app store", () =>
    Effect.gen(function* () {
      const live = daemonLayer(
        Daemon.serve(ServeExec, {
          effect: Effect.void,
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* ServeExec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* EngineStore.at(ServeExec);
        const events = yield* store.events();
        expect(events.some((row) => row._tag === "Completed")).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );

  it.effect("Daemon.serveRemote records terminal runs without granting the local tag", () =>
    Effect.gen(function* () {
      const live = daemonLayer(
        Daemon.serveRemote(ServeRemoteExec, {
          effect: Effect.void,
          polling: Polling.spaced(Duration.millis(50)),
        }),
      );
      yield* Effect.gen(function* () {
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* Store.resolveOrDie(
          ServeRemoteExec.key,
          builtInDaemonStoreContract(ServeRemoteExec),
        );
        const events = yield* store.events();
        expect(events.some((row) => row._tag === "Completed")).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(storeAndClock), Effect.scoped),
  );
});
