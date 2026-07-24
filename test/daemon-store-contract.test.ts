import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Daemon from "../src/Daemon";
import * as Store from "../src/Store";
import { builtInDaemonStoreContract } from "../src/internal/store/daemonStoreSpec";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

class VoidDaemon extends Daemon.Tag<VoidDaemon>()("test/store/Void") {}

class PricedDaemon extends Daemon.Tag<PricedDaemon>()("test/store/Priced", Price) {}

class PricedErrDaemon extends Daemon.Tag<PricedErrDaemon>()(
  "test/store/PricedErr",
  Price,
  FetchErr,
) {}

const pricedRegistration = Store.register(PricedDaemon, builtInDaemonStoreContract(PricedDaemon));
const pricedErrRegistration = Store.register(
  PricedErrDaemon,
  builtInDaemonStoreContract(PricedErrDaemon),
);

class DaemonStore extends Store.Service<DaemonStore>("@test/DaemonStore")(
  Store.register(VoidDaemon, builtInDaemonStoreContract(VoidDaemon)),
  pricedRegistration,
  pricedErrRegistration,
) {}

describe("Daemon store contract", () => {
  it.effect("void daemon exposes record and events", () =>
    Effect.gen(function* () {
      const store = yield* DaemonStore.at(VoidDaemon);
      yield* store.record({
        _tag: "Completed",
        key: VoidDaemon.key,
        scheduleKey: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        isStartupRun: true,
      });
      const events = yield* store.events();
      expect(events).toHaveLength(1);
      expect(events[0]?._tag).toBe("Completed");
      expect(yield* store.hasPriorExecutions()).toBe(true);
    }).pipe(Effect.provide(DaemonStore.layerMemory), Effect.scoped),
  );

  it.effect("value daemon record includes optional success field", () =>
    Effect.gen(function* () {
      const store = yield* DaemonStore.at(PricedDaemon);
      yield* store.record({
        _tag: "Completed",
        key: PricedDaemon.key,
        scheduleKey: null,
        startedAt: 10,
        completedAt: 20,
        durationMs: 10,
        isStartupRun: false,
        success: { symbol: "AAPL", usd: 1 },
      });
      const events = yield* store.events();
      expect(events[0]).toMatchObject({
        _tag: "Completed",
        success: { symbol: "AAPL", usd: 1 },
      });
    }).pipe(Effect.provide(DaemonStore.layerMemory), Effect.scoped),
  );

  it("Tag stamps success and error from positional args", () => {
    expect(Daemon.successOf(PricedDaemon)).toBe(Price);
    expect(Daemon.errorOf(PricedErrDaemon)).toBe(FetchErr);
    expect(Daemon.successOf(VoidDaemon)).toBeUndefined();
  });

  it.effect("Failed carries typed error when error schema is stamped", () =>
    Effect.gen(function* () {
      const store = yield* DaemonStore.at(PricedErrDaemon);
      yield* store.record({
        _tag: "Failed",
        key: PricedErrDaemon.key,
        scheduleKey: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        isStartupRun: false,
        error: { _tag: "FetchError", status: 404 },
      });
      const events = yield* store.events();
      expect(events[0]).toMatchObject({
        _tag: "Failed",
        error: { _tag: "FetchError", status: 404 },
      });
    }).pipe(Effect.provide(DaemonStore.layerMemory), Effect.scoped),
  );
});
