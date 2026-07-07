import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Process from "../src/Process";
import * as Store from "../src/Store";
import { builtInProcessStoreContract } from "../src/internal/store/processStoreSpec";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

class VoidProc extends Process.Tag<VoidProc>()("test/store/Void") {}

class PricedProc extends Process.Tag<PricedProc>()("test/store/Priced", Price) {}

class PricedErrProc extends Process.Tag<PricedErrProc>()(
  "test/store/PricedErr",
  Price,
  FetchErr,
) {}

const pricedRegistration = Store.register(PricedProc, builtInProcessStoreContract(PricedProc));

class ProcessStore extends Store.Service<ProcessStore>("@test/ProcessStore")(
  Store.register(VoidProc, builtInProcessStoreContract(VoidProc)),
  pricedRegistration,
) {}

describe("Process store contract", () => {
  it.effect("void process exposes record and events", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore.at(VoidProc);
      yield* store.record({
        _tag: "RunCompleted",
        processId: VoidProc.key,
        scheduleKey: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        isStartupRun: true,
      });
      const events = yield* store.events();
      expect(events).toHaveLength(1);
      expect(events[0]?._tag).toBe("RunCompleted");
      expect(yield* store.hasPriorExecutions()).toBe(true);
    }).pipe(Effect.provide(ProcessStore.layerMemory), Effect.scoped),
  );

  it.effect("value process record includes optional result field", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore.at(PricedProc);
      yield* store.record({
        _tag: "RunCompleted",
        processId: PricedProc.key,
        scheduleKey: null,
        startedAt: 10,
        completedAt: 20,
        durationMs: 10,
        isStartupRun: false,
        result: { symbol: "AAPL", usd: 1 },
      });
      const events = yield* store.events();
      expect(events[0]).toMatchObject({
        _tag: "RunCompleted",
        result: { symbol: "AAPL", usd: 1 },
      });
    }).pipe(Effect.provide(ProcessStore.layerMemory), Effect.scoped),
  );

  it("Tag stamps success from positional args", () => {
    expect(Process.successOf(PricedProc)).toBe(Price);
    expect(Process.errorOf(PricedErrProc)).toBe(FetchErr);
    expect(Process.successOf(VoidProc)).toBeUndefined();
  });
});
