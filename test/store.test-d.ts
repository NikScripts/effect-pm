import { Effect, Schema } from "effect";
import * as QueueResource from "../src/QueueResource";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";

const readingSchema = Schema.Struct({ value: Schema.Number });

const thermometerStore = {
  readings: Store.append(readingSchema),
};

class LabThermometer extends Resource.Tag<LabThermometer>()("@app/LabThermometer", {
  temperature: Resource.ref(Schema.Number),
}).pipe(Resource.store(thermometerStore)) {}

class Mail extends Resource.Tag<Mail>()("@app/Mail", {
  send: Resource.effectFn(Schema.Void),
}) {}

const jobSchema = Schema.Struct({ id: Schema.String });

class MailQueue extends QueueResource.Tag<MailQueue>()("@app/MailQueue", jobSchema) {}

interface DropletStoreId {
  readonly _tag: "DropletStore";
}

const DropletStore = Store.Service<DropletStoreId>("@repo/app/Store")(
  Resource.store(Mail, thermometerStore),
  Resource.store("custom-store", thermometerStore),
  QueueResource.store(MailQueue, {
    campaignAudit: Store.append(Schema.Struct({ campaignId: Schema.String })),
  }),
);

void Effect.gen(function* () {
  const mail = yield* DropletStore(Mail);
  const custom = yield* DropletStore("custom-store");
  const queue = yield* DropletStore(MailQueue);
  const byKey = yield* Store.acquire(DropletStore, Mail.key);
  const tagStore = yield* LabThermometer.store;
  return { mail, custom, queue, byKey, tagStore };
});

interface DropletStoreArrayId {
  readonly _tag: "DropletStoreArray";
}

void Store.Service<DropletStoreArrayId>("@repo/app/Store")([
  Resource.store("custom-store", thermometerStore),
]);

void Store.Service<DropletStoreArrayId>("@repo/app/Store")(
  Resource.store("custom-store", thermometerStore),
);
