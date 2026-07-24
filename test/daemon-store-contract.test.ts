import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Daemon from "../src/Daemon";
import * as Store from "../src/Store";
import { builtInDaemonStoreContract } from "../src/internal/store/daemonStoreSpec";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

class VoidProc extends Daemon.Tag<VoidProc>()("test/store/Void") {}

class PricedProc extends Daemon.Tag<PricedProc>()("test/store/Priced", Price) {}

class PricedErrProc extends Daemon.Tag<PricedErrProc>()(
  "test/store/PricedErr",
  Price,
  FetchErr,
) {}

const pricedRegistration = Store.register(PricedProc, builtInDaemonStoreContract(PricedProc));
const pricedErrRegistration = Store.register(
  PricedErrProc,
  builtInDaemonStoreContract(PricedErrProc),
);

class DaemonStore extends Store.Service<DaemonStore>("@test/DaemonStore")(
  Store.register(VoidProc, builtInDaemonStoreContract(VoidProc)),
  pricedRegistration,
  pricedErrRegistration,
) {}

describe("Daemon store contract", () => {
  it.effect("void daemon exposes record and events", () =>
    Effect.gen(function* () {
      const store = yield* DaemonStore.at(VoidProc);
      yield* store.record({
        _tag: "Completed",
        key: VoidProc.key,
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

  it.effect("value process record includes optional success field", () =>
    Effect.gen(function* () {
      const store = yield* DaemonStore.at(PricedProc);
      yield* store.record({
        _tag: "Completed",
        key: PricedProc.key,
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
    expect(Daemon.successOf(PricedProc)).toBe(Price);
    expect(Daemon.errorOf(PricedErrProc)).toBe(FetchErr);
    expect(Daemon.successOf(VoidProc)).toBeUndefined();
  });

  it.effect("Failed carries typed error when error schema is stamped", () =>
    Effect.gen(function* () {
      const store = yield* DaemonStore.at(PricedErrProc);
      yield* store.record({
        _tag: "Failed",
        key: PricedErrProc.key,
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
