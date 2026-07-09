import * as Schema from "effect/Schema";
import type * as Store from "../src/Store";
import type {
  EngineQueueStoreContract,
  makeEngineQueueStoreContract,
  MaterializedEngineQueueStore,
} from "../src/internal/store/queueStoreSpec";
import * as QueueResource from "../src/QueueResource";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectExact = <_Check extends true>(): void => {};

const jobSchema = Schema.Struct({ id: Schema.String });

class Jobs extends QueueResource.Tag<Jobs>()("@test/WriterJobs", jobSchema) {}

type ItemSchema = typeof jobSchema;
type Writer = MaterializedEngineQueueStore<ItemSchema>;
type Contract = EngineQueueStoreContract<typeof Jobs>;

// SSOT: materialized writer = contract effects after catchWriteErrors + provideContext(Storage).
type ExpectedWriter = Store.StoreProvidedContext<
  Store.CatchWriteError<Store.StoreEffectsOf<Contract>>,
  Store.Storage
>;
expectExact<Equals<Writer, ExpectedWriter>>();

// Schema-first path (CustomQueue / QueueResource.make) matches tag path for the same item schema.
type SchemaContract = ReturnType<typeof makeEngineQueueStoreContract<ItemSchema>>;
type SchemaWriter = MaterializedEngineQueueStore<ItemSchema>;
type ExpectedSchemaWriter = Store.StoreProvidedContext<
  Store.CatchWriteError<Store.StoreEffectsOf<SchemaContract>>,
  Store.Storage
>;
expectExact<Equals<SchemaWriter, ExpectedSchemaWriter>>();

declare const _writer: Writer;
void _writer.enqueued;
void _writer.started;
void _writer.completed;
void _writer.failed;
void _writer.retryScheduled;
void _writer.retryExhausted;
void _writer.record;
