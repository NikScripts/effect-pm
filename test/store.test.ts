import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Schema } from "effect";
import * as WorkPool from "../src/WorkPool";
import * as Gate from "../src/Gate";
import * as Hyperlink from "../src/Hyperlink";
import * as Store from "../src/Store";

const readingSchema = Schema.Struct({
  value: Schema.Number,
});

const shapedThermometerContract = Store.contract({
  readings: Store.shape(readingSchema),
});

const thermometerContract = Store.contract(
  { readings: readingSchema },
  ({ readings }) => ({
    listReadings: readings.read,
  }),
);

type ThermometerHandle = Store.HandleOf<typeof thermometerContract>;

const readingOnlyContract = Store.contract({ readings: readingSchema });
type ReadingOnlyHandle = Store.HandleOf<typeof readingOnlyContract>;

class LabThermometer extends Hyperlink.Tag<LabThermometer>()("@app/LabThermometer", {
  temperature: Hyperlink.ref(Schema.Number),
}).pipe(Hyperlink.withStore(thermometerContract)) {}

class Mail extends Hyperlink.Tag<Mail>()("@app/Mail", {
  send: Hyperlink.effect(Schema.Void),
}) {}

const jobSchema = Schema.Struct({ id: Schema.String });

class MailQueue extends WorkPool.Tag<MailQueue>()("@app/MailQueue", { payload: jobSchema }) {}

class FetchGate extends Gate.Tag<FetchGate>()("@app/FetchGate", { payload: Schema.String, success: Schema.Number }) {}

const fetchGateRegistration = Gate.store(FetchGate);

const campaignAuditSchema = Schema.Struct({ campaignId: Schema.String });

const mailQueueRegistration = WorkPool.store(MailQueue, {
  campaignAudit: campaignAuditSchema,
});

class DropletStoreArray extends Store.Service<DropletStoreArray>("@repo/app/Store")([
  Store.scoped(Mail, thermometerContract),
  Store.scoped("custom-store", thermometerContract),
]) {}

class DropletStoreRest extends Store.Service<DropletStoreRest>("@repo/app/StoreRest")(
  Store.scoped(Mail, thermometerContract),
  Store.scoped(LabThermometer, thermometerContract),
  Store.scoped("custom-store", thermometerContract),
) {}

class NamedDropletStore extends Store.Service<NamedDropletStore>("@repo/app/NamedStore")({
  temp: Store.scoped(LabThermometer, thermometerContract),
  custom: readingOnlyContract,
}) {}

class QueueStore extends Store.Service<QueueStore>("@repo/app/QueueStore")(mailQueueRegistration) {}

class GateStore extends Store.Service<GateStore>("@repo/app/GateStore")(
  fetchGateRegistration,
) {}

const extendedThermometerContract = thermometerContract.pipe(
  Store.extend({
    audit: Schema.Struct({ note: Schema.String }),
  }),
);

class ExtendStore extends Store.Service<ExtendStore>("@repo/app/ExtendStore")(
  Store.scoped("extended", extendedThermometerContract),
) {}

const mailStore = Store.scoped(Mail, thermometerContract);

const customEffectContract = Store.contract(
  { readings: readingSchema, audit: Schema.Struct({ note: Schema.String }) },
  ({ readings, audit }) => ({
    allNotes: Effect.gen(function* () {
      const rows = yield* audit.read();
      return rows.map((row) => row.note);
    }),
    recordAndCount: (value: number) =>
      Effect.gen(function* () {
        yield* readings.append({ value });
        const rows = yield* readings.read();
        return rows.length;
      }),
  }),
);

class CustomEffectStore extends Store.Service<CustomEffectStore>("@repo/app/CustomEffectStore")(
  Store.scoped("custom", customEffectContract),
) {}

class ShapedDropletStore extends Store.Service<ShapedDropletStore>("@repo/app/StoreRest")(
  Store.scoped("custom-store", shapedThermometerContract),
) {}

describe("Store.Service", () => {
  it.effect("accepts array registration form", () =>
    Effect.gen(function* () {
      const fromArray = yield* DropletStoreArray;
      expect(Object.keys(fromArray).sort()).toEqual(["@app/Mail", "custom-store"]);
    }).pipe(Effect.provide(DropletStoreArray.layerMemory), Effect.scoped),
  );

  it.effect("accepts rest registration form", () =>
    Effect.gen(function* () {
      const fromRest = yield* DropletStoreRest;
      expect(Object.keys(fromRest).sort()).toEqual([
        "@app/LabThermometer",
        "@app/Mail",
        "custom-store",
      ]);
      const custom = (yield* DropletStoreRest.at("custom-store")) as unknown as ThermometerHandle;
      expect(Object.keys(custom).sort()).toEqual(["listReadings", "readings"]);
      expect(Object.keys(custom.readings).sort()).toEqual(["append", "read"]);
    }).pipe(Effect.provide(DropletStoreRest.layerMemory), Effect.scoped),
  );

  it.effect("object form uses accessor names on the bundle", () =>
    Effect.gen(function* () {
      const stores = yield* NamedDropletStore;
      expect(Object.keys(stores).sort()).toEqual(["custom", "temp"]);
      const temp = (yield* NamedDropletStore.at(LabThermometer)) as unknown as ThermometerHandle;
      const custom = (yield* NamedDropletStore.at("custom")) as unknown as ReadingOnlyHandle;
      yield* temp.readings.append({ value: 90 });
      yield* custom.readings.append({ value: 70 });
    }).pipe(Effect.provide(NamedDropletStore.layerMemory), Effect.scoped),
  );

  it.effect("append and query scoped rows", () =>
    Effect.gen(function* () {
      const store = (yield* DropletStoreRest.at("custom-store")) as unknown as ThermometerHandle;
      yield* store.readings.append({ value: 72 });
      yield* store.readings.append({ value: 68 });
      const rows = yield* store.listReadings();
      expect(rows).toEqual([{ value: 72 }, { value: 68 }]);
    }).pipe(Effect.provide(DropletStoreRest.layerMemory), Effect.scoped),
  );

  it.effect("shape append accepts arrays", () =>
    Effect.gen(function* () {
      const store = (yield* DropletStoreRest.at("custom-store")) as unknown as ThermometerHandle;
      yield* store.readings.append([{ value: 1 }, { value: 2 }]);
      const rows = yield* store.readings.read();
      expect(rows).toEqual([{ value: 1 }, { value: 2 }]);
    }).pipe(Effect.provide(DropletStoreRest.layerMemory), Effect.scoped),
  );

  it.effect("fails for unregistered keys", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(DropletStoreRest.at("missing"));
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = Cause.findErrorOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some" && failure.value instanceof Store.StoreScopeNotRegistered) {
          expect(failure.value._tag).toBe("StoreScopeNotRegistered");
        }
      }
    }).pipe(Effect.provide(DropletStoreRest.layerMemory), Effect.scoped),
  );

  it("throws on duplicate tuple scope keys at definition time", () => {
    expect(() =>
      class DupStore extends Store.Service<DupStore>("@repo/app/Dup")(
        Store.scoped("same-key", thermometerContract),
        Store.scoped("same-key", thermometerContract),
      ) {},
    ).toThrow();
  });

  it.effect("single Store.Service yields the store handle directly", () =>
    Effect.gen(function* () {
      const store = yield* GateStore;
      expect(typeof store.record).toBe("function");
    }).pipe(Effect.provide(GateStore.layerMemory), Effect.scoped),
  );

  it.effect("array Store.Service still resolves via at", () =>
    Effect.gen(function* () {
      const store = yield* DropletStoreArray.at(Mail);
      yield* store.readings.append({ value: 1 });
    }).pipe(Effect.provide(DropletStoreArray.layerMemory), Effect.scoped),
  );

  it.effect("WorkPool.store exposes typed emit effects + extended shapes", () =>
    Effect.gen(function* () {
      const store = yield* QueueStore;
      // record persists the same QueueEvent the live stream carries; events reads them back.
      const keys = Object.keys(store);
      expect(keys).toContain("record");
      expect(keys).toContain("events");
      expect(keys).toContain("campaignAudit");

      yield* store.record({ _tag: "Start", key: MailQueue.key });
      yield* store.record({ _tag: "Cleared", key: MailQueue.key, count: 3 });

      const events = yield* store.events();
      expect(events.map((e) => e._tag)).toEqual(["Start", "Cleared"]);
      const cleared = events.find((e) => e._tag === "Cleared");
      expect(cleared).toMatchObject({ key: MailQueue.key, count: 3 });
    }).pipe(Effect.provide(QueueStore.layerMemory), Effect.scoped),
  );

  it.effect("Gate.store exposes typed fact + stateHistory methods", () =>
    Effect.gen(function* () {
      const store = yield* GateStore;
      const keys = Object.keys(store);
      expect(keys).toContain("record");
      expect(keys).toContain("facts");
      expect(keys).toContain("recordStateChange");
      expect(keys).toContain("stateHistory");

      yield* store.record({
        id: "run-1/started",
        resourceId: FetchGate.key,
        runId: "run-1",
        _tag: "Started",
        occurredAt: 1,
        concurrency: 2,
      });
      yield* store.recordStateChange({
        id: "state-1",
        resourceId: FetchGate.key,
        changedAt: 2,
        reason: "gate.run.started",
        previous: null,
        current: {
          resourceId: FetchGate.key,
          observedAt: 2,
          configVersion: 1,
          concurrency: 2,
          waiting: 0,
          inFlight: 1,
          completed: 0,
          failed: 0,
          interrupted: 0,
          totalDurationMs: 0,
        },
      });

      const facts = yield* store.facts();
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        _tag: "Started",
        runId: "run-1",
      });
      const history = yield* store.stateHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.reason).toBe("gate.run.started");
    }).pipe(Effect.provide(GateStore.layerMemory), Effect.scoped),
  );

  it.effect("Store.extend adds shapes and keeps pipe", () =>
    Effect.gen(function* () {
      const store = yield* ExtendStore;
      yield* store.readings.append({ value: 1 });
      yield* store.audit.append({ note: "ok" });
      const rows = yield* store.listReadings();
      expect(rows).toEqual([{ value: 1 }]);
      expect(yield* store.audit.read()).toEqual([{ note: "ok" }]);
    }).pipe(Effect.provide(ExtendStore.layerMemory), Effect.scoped),
  );

  it("Store.contract.pipe(Store.extend) merges shapes", () => {
    const extended = Store.contract({
      readings: readingSchema,
    }).pipe(
      Store.extend({
        audit: Schema.Struct({ note: Schema.String }),
      }),
    );
    expect(Object.keys(extended.shapes).sort()).toEqual(["audit", "readings"]);
    expect(extended.pipe).toBeTypeOf("function");
  });

  it.effect("standalone Hyperlink.store is yieldable with a single layer", () =>
    Effect.gen(function* () {
      const store = (yield* mailStore) as unknown as ThermometerHandle;
      yield* store.readings.append({ value: 42 });
      const rows = yield* store.listReadings();
      expect(rows).toEqual([{ value: 42 }]);
    }).pipe(Effect.provide(mailStore.layerMemory), Effect.scoped),
  );

  it.effect("shape read payload is on the namespace", () =>
    Effect.gen(function* () {
      const store = yield* ShapedDropletStore;
      yield* store.readings.append({ value: 10 });
      yield* store.readings.append({ value: 20 });
      const rows = yield* store.readings.read({ limit: 1 });
      expect(rows).toEqual([{ value: 10 }]);
    }).pipe(Effect.provide(ShapedDropletStore.layerMemory), Effect.scoped),
  );

  it.effect("custom bare Effect and effect functions run after materialization", () =>
    Effect.gen(function* () {
      const store = yield* CustomEffectStore;
      yield* store.audit.append({ note: "a" });
      yield* store.audit.append({ note: "b" });
      expect(yield* store.allNotes).toEqual(["a", "b"]);
      expect(yield* store.recordAndCount(42)).toBe(1);
    }).pipe(Effect.provide(CustomEffectStore.layerMemory), Effect.scoped),
  );

  it.effect("Tag.store resolves through the provided store layer", () =>
    Effect.gen(function* () {
      const store = yield* LabThermometer.store;
      yield* store.readings.append({ value: 90 });
      const rows = yield* store.listReadings();
      expect(rows).toEqual([{ value: 90 }]);
    }).pipe(Effect.provide(DropletStoreRest.layerMemory), Effect.scoped),
  );
});
