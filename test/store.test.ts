import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Layer, Schema } from "effect";
import * as QueueResource from "../src/QueueResource";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";

const readingSchema = Schema.Struct({
  value: Schema.Number,
});

const thermometerStore = {
  readings: Store.append(readingSchema),
  listReadings: Store.query({
    from: "readings",
    payload: Schema.Struct({}),
    result: Schema.Array(readingSchema),
  }),
};

class LabThermometer extends Resource.Tag<LabThermometer>()("@app/LabThermometer", {
  temperature: Resource.ref(Schema.Number),
}).pipe(Resource.store(thermometerStore)) {}

class Mail extends Resource.Tag<Mail>()("@app/Mail", {
  send: Resource.effectFn(Schema.Void),
}) {}

const jobSchema = Schema.Struct({ id: Schema.String });

class MailQueue extends QueueResource.Tag<MailQueue>()("@app/MailQueue", jobSchema) {}

interface DropletStoreArrayId {
  readonly _tag: "DropletStoreArray";
}

interface DropletStoreRestId {
  readonly _tag: "DropletStoreRest";
}

const DropletStoreArray = Store.Service<DropletStoreArrayId>("@repo/app/Store")([
  Resource.store(Mail, thermometerStore),
  Resource.store("custom-store", thermometerStore),
]);

const DropletStoreRest = Store.Service<DropletStoreRestId>("@repo/app/Store")(
  Resource.store(Mail, thermometerStore),
  Resource.store(LabThermometer, thermometerStore),
  Resource.store("custom-store", thermometerStore),
);

const dropletArrayMemoryLive = DropletStoreArray.layerMemory;
const dropletMemoryLive = DropletStoreRest.layerMemory;

const auditSchema = Schema.Struct({ campaignId: Schema.String });
const noteSchema = Schema.Struct({ note: Schema.String });

interface QueueStoreId {
  readonly _tag: "QueueStoreId";
}

const QueueStore = Store.Service<QueueStoreId>("@repo/app/QueueStore")(
  QueueResource.store(MailQueue, {
    campaignAudit: Store.append(auditSchema),
  }),
);

interface ExtendStoreId {
  readonly _tag: "ExtendStoreId";
}

const extendedThermometerStore = Store.extend(thermometerStore, {
  audit: Store.append(noteSchema),
});

const ExtendStore = Store.Service<ExtendStoreId>("@repo/app/ExtendStore")(
  Resource.store("extended", extendedThermometerStore),
);

describe("Store.Service", () => {
  it.effect("accepts array and rest registration forms", () =>
    Effect.gen(function* () {
      const fromArray = yield* DropletStoreArray(Mail.key);
      const fromRest = yield* DropletStoreRest("custom-store");
      expect(Object.keys(fromArray)).toEqual(["readings", "listReadings"]);
      expect(Object.keys(fromRest)).toEqual(["readings", "listReadings"]);
    }).pipe(
      Effect.provide(Layer.merge(dropletArrayMemoryLive, dropletMemoryLive)),
      Effect.scoped,
    ),
  );

  it.effect("append and query scoped rows", () =>
    Effect.gen(function* () {
      const store = yield* DropletStoreRest("custom-store");
      yield* store.readings({ value: 72 });
      yield* store.readings({ value: 68 });
      const rows = yield* store.listReadings({});
      expect(rows).toEqual([{ value: 72 }, { value: 68 }]);
    }).pipe(Effect.provide(dropletMemoryLive), Effect.scoped),
  );

  it.effect("registered resource tags resolve store handles", () =>
    Effect.gen(function* () {
      const store = yield* DropletStoreRest(LabThermometer);
      yield* store.readings({ value: 90 });
      const rows = yield* store.listReadings({});
      expect(rows).toEqual([{ value: 90 }]);
    }).pipe(Effect.provide(dropletMemoryLive), Effect.scoped),
  );

  it.effect("fails for unregistered keys", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(DropletStoreRest("missing"));
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = Cause.findErrorOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value._tag).toBe("StoreScopeNotRegistered");
        }
      }
    }).pipe(Effect.provide(dropletMemoryLive), Effect.scoped),
  );

  it.effect("QueueResource.store merges built-in and extended specs", () =>
    Effect.gen(function* () {
      const store = yield* QueueStore(MailQueue);
      expect(Object.keys(store).sort()).toEqual([
        "campaignAudit",
        "entries",
        "recordEntry",
      ]);

      yield* store.recordEntry({
        queueId: MailQueue.key,
        entryId: "e1",
        item: { id: "job-1" },
      });
      yield* store.campaignAudit({ campaignId: "c1" });

      const entries = yield* store.entries({});
      expect(entries).toEqual([
        {
          queueId: MailQueue.key,
          entryId: "e1",
          item: { id: "job-1" },
        },
      ]);
    }).pipe(Effect.provide(QueueStore.layerMemory), Effect.scoped),
  );

  it.effect("Store.extend composes specs incrementally", () =>
    Effect.gen(function* () {
      const store = yield* ExtendStore("extended");
      yield* store.readings({ value: 1 });
      yield* store.audit({ note: "ok" });
      const rows = yield* store.listReadings({});
      expect(rows).toEqual([{ value: 1 }]);
    }).pipe(Effect.provide(ExtendStore.layerMemory), Effect.scoped),
  );
});
