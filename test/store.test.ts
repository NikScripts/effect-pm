import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Schema } from "effect";
import * as QueueResource from "../src/QueueResource";
import * as RunResource from "../src/RunResource";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";
import { builtInQueueStoreContract } from "../src/internal/store/queueStoreSpec";

const readingSchema = Schema.Struct({
  value: Schema.Number,
});

const listReadingsPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

const shapedThermometerContract = Store.contract({
  readings: Store.shape(readingSchema, listReadingsPayload),
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

class LabThermometer extends Resource.Tag<LabThermometer>()("@app/LabThermometer", {
  temperature: Resource.ref(Schema.Number),
}).pipe(Resource.withStore(thermometerContract)) {}

class Mail extends Resource.Tag<Mail>()("@app/Mail", {
  send: Resource.effect(Schema.Void),
}) {}

const jobSchema = Schema.Struct({ id: Schema.String });

class MailQueue extends QueueResource.Tag<MailQueue>()("@app/MailQueue", { payload: jobSchema }) {}

class FetchGate extends RunResource.Tag<FetchGate>()("@app/FetchGate", { payload: Schema.String, success: Schema.Number }) {}

const fetchGateRegistration = RunResource.store(FetchGate);

const campaignAuditSchema = Schema.Struct({ campaignId: Schema.String });

const mailQueueContract = builtInQueueStoreContract(MailQueue).pipe(
  Store.extend({ campaignAudit: campaignAuditSchema }),
);

const mailQueueRegistration = Store.register(MailQueue, mailQueueContract);

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

class RunGateStore extends Store.Service<RunGateStore>("@repo/app/RunGateStore")(
  fetchGateRegistration,
) {}

const extendedThermometerContract = thermometerContract.pipe(
  Store.extend({
    audit: Schema.Struct({ note: Schema.String }),
  }),
);

type ExtendedThermometerHandle = Store.HandleOf<typeof extendedThermometerContract>;

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

type CustomEffectHandle = Store.HandleOf<typeof customEffectContract>;

class CustomEffectStore extends Store.Service<CustomEffectStore>("@repo/app/CustomEffectStore")(
  Store.scoped("custom", customEffectContract),
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

  it.effect("QueueResource.store exposes typed emit effects + extended shapes", () =>
    Effect.gen(function* () {
      const store = yield* QueueStore.at(MailQueue);
      // record persists the same QueueEvent the live stream carries; events reads them back.
      const keys = Object.keys(store);
      expect(keys).toContain("record");
      expect(keys).toContain("events");
      expect(keys).toContain("campaignAudit");

      yield* store.record({ _tag: "Start", queueId: MailQueue.key });
      yield* store.record({ _tag: "Cleared", queueId: MailQueue.key, count: 3 });

      const events = yield* store.events();
      expect(events.map((e) => e._tag)).toEqual(["Start", "Cleared"]);
      const cleared = events.find((e) => e._tag === "Cleared");
      expect(cleared).toMatchObject({ queueId: MailQueue.key, count: 3 });
    }).pipe(Effect.provide(QueueStore.layerMemory), Effect.scoped),
  );

  it.effect("RunResource.store exposes typed fact + stateHistory methods", () =>
    Effect.gen(function* () {
      const store = yield* RunGateStore.at(FetchGate);
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
        reason: "run-resource.run.started",
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
      expect(history[0]?.reason).toBe("run-resource.run.started");
    }).pipe(Effect.provide(RunGateStore.layerMemory), Effect.scoped),
  );

  it.effect("Store.extend adds shapes and keeps pipe", () =>
    Effect.gen(function* () {
      const store = (yield* ExtendStore.at("extended")) as unknown as ExtendedThermometerHandle;
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

  it.effect("standalone Resource.store is yieldable with a single layer", () =>
    Effect.gen(function* () {
      const store = (yield* mailStore) as unknown as ThermometerHandle;
      yield* store.readings.append({ value: 42 });
      const rows = yield* store.listReadings();
      expect(rows).toEqual([{ value: 42 }]);
    }).pipe(Effect.provide(mailStore.layerMemory), Effect.scoped),
  );

  it.effect("shape read payload is on the namespace", () =>
    Effect.gen(function* () {
      const store = (yield* DropletStoreRest.at("custom-store")) as unknown as Store.HandleOf<
        typeof shapedThermometerContract
      >;
      yield* store.readings.append({ value: 10 });
      yield* store.readings.append({ value: 20 });
      const rows = yield* store.readings.read({ limit: 1 });
      expect(rows).toEqual([{ value: 10 }]);
    }).pipe(
      Effect.provide(
        Store.Service<DropletStoreRest>("@repo/app/StoreRest")(
          Store.scoped("custom-store", shapedThermometerContract),
        ).layerMemory,
      ),
      Effect.scoped,
    ),
  );

  it.effect("custom bare Effect and effect functions run after materialization", () =>
    Effect.gen(function* () {
      const store = (yield* CustomEffectStore.at("custom")) as unknown as CustomEffectHandle;
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
