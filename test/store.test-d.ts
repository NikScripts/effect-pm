import { Effect, Schema } from "effect";
import * as QueueResource from "../src/QueueResource";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";
import { builtInQueueStoreContract, type QueueEntryRowSchema } from "../src/internal/store/queueStoreSpec";
import type { SchemaDecoded } from "../src/internal/store/contractDef";
import type { RegistrationHandleOf, StoreHandleAtKey } from "../src/internal/store/defineStore";
import type { RegsOfStoreInput } from "../src/internal/store/registrationTypes";

const readingSchema = Schema.Struct({ value: Schema.Number });

const thermometerContract = Store.contract(
  { readings: readingSchema },
  ({ readings }) => ({
    listReadings: readings.read,
  }),
);

type ThermometerHandle = Store.HandleOf<typeof thermometerContract>;
type ReadingOnlyHandle = Store.HandleOf<typeof readingOnlyContract>;

declare const _readingOnlyHandle: ReadingOnlyHandle;
void _readingOnlyHandle.readings.read();

const readingOnlyContract = Store.contract({ readings: readingSchema });

class LabThermometer extends Resource.Tag<LabThermometer>()("@app/LabThermometer", {
  temperature: Resource.ref(Schema.Number),
}).pipe(Resource.store(thermometerContract)) {}

class Mail extends Resource.Tag<Mail>()("@app/Mail", {
  send: Resource.effectFn(Schema.Void),
}) {}

const jobSchema = Schema.Struct({ id: Schema.String });

class MailQueue extends QueueResource.Tag<MailQueue>()("@app/MailQueue", jobSchema) {}

const mailQueueContract = builtInQueueStoreContract(MailQueue).pipe(
  Store.extend({ campaignAudit: Schema.Struct({ campaignId: Schema.String }) }),
);
type MailQueueHandle = Store.HandleOf<typeof mailQueueContract>;

declare const _queueHandle: MailQueueHandle;
void _queueHandle.entry.append({
  queueId: MailQueue.key,
  entryId: "e1",
  item: { id: "job" },
});
void _queueHandle.entries();
void _queueHandle.recordEntry({
  queueId: MailQueue.key,
  entryId: "e2",
  item: { id: "job-2" },
});

type QueueEntryRow = SchemaDecoded<QueueEntryRowSchema<typeof MailQueue>>;

type QueueEntriesResult = ReturnType<MailQueueHandle["entries"]> extends Effect.Effect<
  infer A,
  infer _E,
  infer _R
>
  ? A
  : never;

void ({} as QueueEntriesResult satisfies ReadonlyArray<QueueEntryRow>);

declare const _entryRead: MailQueueHandle["entry"]["read"];
void _entryRead({ limit: 5 });
void _entryRead();

type _QueueReadPayload = Parameters<MailQueueHandle["entries"]>[0];
void ({} as _QueueReadPayload satisfies { readonly limit?: number } | undefined);

type DropletRegs = RegsOfStoreInput<
  [
    ReturnType<typeof Resource.store<typeof Mail, typeof thermometerContract>>,
    ReturnType<typeof Resource.store<"custom-store", typeof thermometerContract>>,
    ReturnType<typeof Store.register<typeof MailQueue, typeof mailQueueContract>>,
  ]
>;
type QueueAtHandle = StoreHandleAtKey<DropletRegs, typeof MailQueue>;

declare const _queueAtHandle: QueueAtHandle;
void _queueAtHandle.entry.append({
  queueId: MailQueue.key,
  entryId: "e1",
  item: { id: "job" },
});
void _queueAtHandle.entries();

const campaignAuditSchema = Schema.Struct({ campaignId: Schema.String });

type FacetQueueRegs = RegsOfStoreInput<
  [
    ReturnType<
      typeof QueueResource.store<
        typeof MailQueue,
        { readonly campaignAudit: typeof campaignAuditSchema }
      >
    >,
  ]
>;
type FacetQueueAtHandle = StoreHandleAtKey<FacetQueueRegs, typeof MailQueue>;

type FacetEntryRow = Parameters<FacetQueueAtHandle["entry"]["append"]>[0] extends infer R
  ? R extends ReadonlyArray<unknown>
    ? never
    : R
  : never;
void ({} as FacetEntryRow satisfies {
  readonly queueId: string;
  readonly entryId: string;
  readonly item: { readonly id: string };
});

type FacetCampaignAuditRow = Parameters<FacetQueueAtHandle["campaignAudit"]["append"]>[0] extends infer R
  ? R extends ReadonlyArray<unknown>
    ? never
    : R
  : never;
void ({} as FacetCampaignAuditRow satisfies { readonly campaignId: string });

type NamedInput = {
  temp: ReturnType<typeof Resource.store<typeof LabThermometer, typeof thermometerContract>>;
  custom: typeof readingOnlyContract;
};
type NamedRegsDirect = RegsOfStoreInput<NamedInput>;
type CustomDirect = NamedRegsDirect["custom"];
type CustomHandleDirect = RegistrationHandleOf<CustomDirect>;
declare const _customDirect: CustomHandleDirect;
void _customDirect.readings.read();

const NamedStoreBase = Store.Service<NamedStore>("@repo/app/NamedStore")({
  temp: Resource.store(LabThermometer, thermometerContract),
  custom: readingOnlyContract,
});
class NamedStore extends NamedStoreBase {}

class DropletStore extends Store.Service<DropletStore>("@repo/app/Store")(
  Resource.store(Mail, thermometerContract),
  Resource.store("custom-store", thermometerContract),
  Store.register(MailQueue, mailQueueContract),
) {}

void Effect.gen(function* () {
  const stores = yield* DropletStore;
  const mail = yield* DropletStore.at(Mail);
  const custom = yield* DropletStore.at("custom-store");
  const queue = yield* DropletStore.at(MailQueue);
  const tagStore = yield* LabThermometer.store;
  yield* mail.readings.append({ value: 1 });
  yield* custom.listReadings();
  yield* queue.entry.append({
    queueId: MailQueue.key,
    entryId: "e1",
    item: { id: "job" },
  });
  return { stores, mail, custom, queue, tagStore };
});

void Effect.gen(function* () {
  const stores = yield* NamedStore;
  const temp = yield* NamedStore.at(LabThermometer);
  yield* temp.readings.append({ value: 1 });
  yield* stores.custom.readings.read();
  return { stores, temp };
});

const pipedStore = Store.contract({
  readings: readingSchema,
}).pipe(
  Store.extend({
    audit: Schema.Struct({ note: Schema.String }),
  }),
);

void pipedStore.shapes.readings;
void pipedStore.shapes.audit;

const _shapedContract = Store.contract({
  readings: Store.shape(readingSchema, Schema.Struct({ limit: Schema.optional(Schema.Number) })),
});
type ShapedHandle = Store.HandleOf<typeof _shapedContract>;

declare const _shaped: ShapedHandle;
void _shaped.readings.read({ limit: 5 });
void _shaped.readings.read();

void Effect.gen(function* () {
  const queue = yield* DropletStore.at(MailQueue);
  yield* queue.entries();
  return queue;
});

type NamedStoreKeys = Store.KeysOf<typeof NamedStore>;
void ({} as "@app/LabThermometer" satisfies NamedStoreKeys);
void ({} as "custom" satisfies NamedStoreKeys);

type DropletStoreKeys = Store.KeysOf<typeof DropletStore>;
void ({} as "@app/Mail" satisfies DropletStoreKeys);
void ({} as "@app/MailQueue" satisfies DropletStoreKeys);

declare const _mailFromAt: typeof DropletStore extends {
  readonly at: (key: typeof Mail) => Effect.Effect<infer H, unknown, unknown>;
}
  ? H
  : never;
void (_mailFromAt satisfies ThermometerHandle);

declare const _queueFromAt: typeof DropletStore extends {
  readonly at: (key: typeof MailQueue) => Effect.Effect<infer H, unknown, unknown>;
}
  ? H
  : never;
void (_queueFromAt satisfies MailQueueHandle);

declare const _namedFromYield: typeof NamedStore extends { readonly Service: infer S } ? S : never;
void (_namedFromYield satisfies { custom: Store.HandleOf<typeof readingOnlyContract> });

type ShapedReadRows = ReturnType<ShapedHandle["readings"]["read"]> extends Effect.Effect<
  infer A,
  infer _E,
  infer _R
>
  ? A
  : never;
void ({} as ShapedReadRows satisfies ReadonlyArray<{ readonly value: number }>);

type ThermometerReadings = ThermometerHandle["readings"];
declare const _thermReadings: ThermometerReadings;
void _thermReadings.read();
void _thermReadings.append({ value: 1 });
