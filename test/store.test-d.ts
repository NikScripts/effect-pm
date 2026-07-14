import { Effect, Schema } from "effect";
import * as QueueResource from "../src/QueueResource";
import * as RunResource from "../src/RunResource";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";
import { builtInQueueStoreContract, type QueueEventOf } from "../src/internal/store/queueStoreSpec";
import {
  builtInRunResourceStoreContract,
  runFactSchemaForTag,
} from "../src/internal/store/runResourceStoreSpec";
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
}).pipe(Resource.withStore(thermometerContract)) {}

class Mail extends Resource.Tag<Mail>()("@app/Mail", {
  send: Resource.effect(Schema.Void),
}) {}

const jobSchema = Schema.Struct({ id: Schema.String });

class MailQueue extends QueueResource.Tag<MailQueue>()("@app/MailQueue", { payload: jobSchema }) {}

class FetchGate extends RunResource.Tag<FetchGate>()("@app/FetchGate", { payload: Schema.String, success: Schema.Number }) {}

const mailQueueContract = builtInQueueStoreContract(MailQueue).pipe(
  Store.extend({ campaignAudit: Schema.Struct({ campaignId: Schema.String }) }),
);
type MailQueueHandle = Store.HandleOf<typeof mailQueueContract>;

declare const _queueHandle: MailQueueHandle;
void _queueHandle.record({ _tag: "Start", key: MailQueue.key });
void _queueHandle.record({ _tag: "Cleared", key: MailQueue.key, count: 3 });
void _queueHandle.events();

type QueueEvent = QueueEventOf<typeof MailQueue>;

type QueueEventsResult = ReturnType<MailQueueHandle["events"]> extends Effect.Effect<
  infer A,
  infer _E,
  infer _R
>
  ? A
  : never;

void ({} as QueueEventsResult satisfies ReadonlyArray<QueueEvent>);

const runGateContract = builtInRunResourceStoreContract(FetchGate);
type RunGateHandle = Store.HandleOf<typeof runGateContract>;

declare const _runGateHandle: RunGateHandle;
void _runGateHandle.record({
  id: "run-1/started",
  resourceId: FetchGate.key,
  runId: "run-1",
  _tag: "Started",
  occurredAt: 1,
  concurrency: 2,
});
void _runGateHandle.facts();
void _runGateHandle.recordStateChange({
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
void _runGateHandle.stateHistory();

type RunFactsResult = ReturnType<RunGateHandle["facts"]> extends Effect.Effect<
  infer A,
  infer _E,
  infer _R
>
  ? A
  : never;

const fetchGateFactSchema = runFactSchemaForTag(FetchGate);
type FetchGateRunFact = Schema.Schema.Type<typeof fetchGateFactSchema>;

void ({} as RunFactsResult satisfies ReadonlyArray<FetchGateRunFact>);

type _QueueReadPayload = Parameters<MailQueueHandle["events"]>[0];
void ({} as _QueueReadPayload satisfies { readonly limit?: number } | undefined);

type DropletRegs = RegsOfStoreInput<
  [
    ReturnType<typeof Store.scoped<typeof Mail, typeof thermometerContract>>,
    ReturnType<typeof Store.scoped<"custom-store", typeof thermometerContract>>,
    ReturnType<typeof Store.register<typeof MailQueue, typeof mailQueueContract>>,
  ]
>;
type QueueAtHandle = StoreHandleAtKey<DropletRegs, typeof MailQueue>;

declare const _queueAtHandle: QueueAtHandle;
void _queueAtHandle.record({ _tag: "Start", key: MailQueue.key });
void _queueAtHandle.events();

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

// `record` accepts the shared QueueEvent union (the item is typed through its entry-bearing variants).
declare const _facetRecord: FacetQueueAtHandle["record"];
void _facetRecord({ _tag: "Start", key: "q" });
void _facetRecord({ _tag: "Cleared", key: "q", count: 0 });

type FacetCampaignAuditRow = Parameters<FacetQueueAtHandle["campaignAudit"]["append"]>[0] extends infer R
  ? R extends ReadonlyArray<unknown>
    ? never
    : R
  : never;
void ({} as FacetCampaignAuditRow satisfies { readonly campaignId: string });

type NamedInput = {
  temp: ReturnType<typeof Store.scoped<typeof LabThermometer, typeof thermometerContract>>;
  custom: typeof readingOnlyContract;
};
type NamedRegsDirect = RegsOfStoreInput<NamedInput>;
type CustomDirect = NamedRegsDirect["custom"];
type CustomHandleDirect = RegistrationHandleOf<CustomDirect>;
declare const _customDirect: CustomHandleDirect;
void _customDirect.readings.read();

const NamedStoreBase = Store.Service<NamedStore>("@repo/app/NamedStore")({
  temp: Store.scoped(LabThermometer, thermometerContract),
  custom: readingOnlyContract,
});
class NamedStore extends NamedStoreBase {}

class DropletStore extends Store.Service<DropletStore>("@repo/app/Store")(
  Store.scoped(Mail, thermometerContract),
  Store.scoped("custom-store", thermometerContract),
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
  yield* queue.record({ _tag: "Start", key: MailQueue.key });
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
  readings: Store.shape(readingSchema),
});
type ShapedHandle = Store.HandleOf<typeof _shapedContract>;

declare const _shaped: ShapedHandle;
void _shaped.readings.read({ limit: 5 });
void _shaped.readings.read({ where: { value: { gte: 1 } } });
void _shaped.readings.read();
// @ts-expect-error — unknown where field
void _shaped.readings.read({ where: { nope: 1 } });

void Effect.gen(function* () {
  const queue = yield* DropletStore.at(MailQueue);
  yield* queue.events();
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

// Store.extend — tier-2 engine writes merge onto tier-1 custom methods
const runEngineContract = Store.extend(
  (handles) => ({
    started: (row: {
      readonly id: string;
      readonly resourceId: string;
      readonly runId: string;
      readonly occurredAt: number;
      readonly concurrency: number;
    }) => handles.fact.append({ _tag: "Started", ...row }),
  }),
  runGateContract,
);

type RunEngineHandle = Store.HandleOf<typeof runEngineContract>;
declare const _runEngineHandle: RunEngineHandle;
void _runEngineHandle.facts();
void _runEngineHandle.started({
  id: "run-2/started",
  resourceId: FetchGate.key,
  runId: "run-2",
  occurredAt: 3,
  concurrency: 1,
});

type RunEngineEffects = Store.StoreEffectsOf<typeof runEngineContract>;
declare const _runEngineEffects: RunEngineEffects;
void _runEngineEffects.started({
  id: "run-3/started",
  resourceId: FetchGate.key,
  runId: "run-3",
  occurredAt: 4,
  concurrency: 1,
});
