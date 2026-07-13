import type { DateTime, Duration, Effect, Option, Stream } from "effect";
import * as Schema from "effect/Schema";
import * as QueueResource from "../src/QueueResource";
import * as Store from "../src/Store";
import { builtInQueueStoreContract } from "../src/internal/store/queueStoreSpec";
import type {
  EngineQueueStoreContract,
  QueueStoreCompleted,
  QueueStoreEntry,
  QueueStoreEvent,
  QueueStoreFailed,
  QueueStoreLatency,
  QueueStoreReads,
  QueueStoreStats,
} from "../src/internal/store/queueStoreSpec";
import type { StoreJournalDecodeError } from "../src/internal/store/errors";
import type { StoreHandleAtKey } from "../src/internal/store/defineStore";
import type { RegsOfStoreInput } from "../src/internal/store/registrationTypes";

// ── exact type-equality harness ──────────────────────────────────────────────
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectExact = <_Check extends true>(): void => {};

const jobSchema = Schema.Struct({ id: Schema.String });

class Jobs extends QueueResource.Tag<Jobs>()("@test/AnalyticsJobs", { payload: jobSchema }) {}

type Ev = QueueStoreEvent<typeof Jobs>;
type Entry = QueueStoreEntry<typeof Jobs>;
type Failed = QueueStoreFailed<typeof Jobs>;
type Completed = QueueStoreCompleted<typeof Jobs>;

// ── Tier 3: `QueueResource.store(queue)` resolves to base + the 12 reads ──────
type Regs = RegsOfStoreInput<[ReturnType<typeof QueueResource.store<typeof Jobs>>]>;
type Handle = StoreHandleAtKey<Regs, typeof Jobs>;

// base is still present
declare const _handle: Handle;
void _handle.record({ _tag: "Start", queueId: "q" });
void _handle.events();

// each read method has the exact required signature
expectExact<Equals<Handle["failures"], () => Effect.Effect<ReadonlyArray<Failed>>>>();
expectExact<Equals<Handle["deadLettered"], () => Effect.Effect<ReadonlyArray<Entry>>>>();
expectExact<Equals<Handle["inFlight"], () => Effect.Effect<ReadonlyArray<Entry>>>>();
expectExact<
  Equals<Handle["history"], (entryId: string) => Effect.Effect<ReadonlyArray<Ev>>>
>();
expectExact<Equals<Handle["lastFailure"], () => Effect.Effect<Option.Option<Failed>>>>();
expectExact<
  Equals<Handle["slowest"], (n: number) => Effect.Effect<ReadonlyArray<Completed>>>
>();
expectExact<Equals<Handle["recent"], (n: number) => Effect.Effect<ReadonlyArray<Ev>>>>();
expectExact<
  Equals<
    Handle["since"],
    (when: DateTime.DateTime) => Effect.Effect<ReadonlyArray<Ev>>
  >
>();
expectExact<Equals<Handle["stats"], () => Effect.Effect<QueueStoreStats>>>();
expectExact<Equals<Handle["failureRate"], () => Effect.Effect<number>>>();
expectExact<Equals<Handle["latency"], () => Effect.Effect<QueueStoreLatency>>>();
expectExact<
  Equals<
    Handle["changes"],
    () => Stream.Stream<Ev, StoreJournalDecodeError, Store.Storage>
  >
>();

// the read surface as a whole matches the documented `QueueStoreReads` shape.
expectExact<
  Equals<Pick<Handle, keyof QueueStoreReads<typeof Jobs>>, QueueStoreReads<typeof Jobs>>
>();

// `stats` / `latency` fields are Effect-v4 idiomatic (numbers / `Duration.Duration`, never ms).
expectExact<Equals<QueueStoreStats["retried"], number>>();
expectExact<Equals<QueueStoreLatency["p99"], Duration.Duration>>();

// ── `QueueResource.store(queue, additions)` = base + reads + additions ────────
const auditSchema = Schema.Struct({ campaignId: Schema.String });
type RegsWithAdditions = RegsOfStoreInput<
  [ReturnType<typeof QueueResource.store<typeof Jobs, { readonly audit: typeof auditSchema }>>]
>;
type HandleWithAdditions = StoreHandleAtKey<RegsWithAdditions, typeof Jobs>;

declare const _handleAdd: HandleWithAdditions;
// the reads are still present alongside the app-specific shape
void _handleAdd.failures();
void _handleAdd.latency();
void _handleAdd.audit.append({ campaignId: "c1" });

// ── tier isolation: the lean base does NOT leak the rich reads ───────────────
type BaseHandle = Store.HandleOf<ReturnType<typeof builtInQueueStoreContract<typeof Jobs>>>;
declare const _base: BaseHandle;
void _base.record({ _tag: "Start", queueId: "q" });
void _base.events();
// @ts-expect-error the base contract has no analytics reads
void _base.failures;

// ── tier isolation: the engine write-extension exposes writes, not the reads ──
type EngineHandle = Store.HandleOf<EngineQueueStoreContract<typeof Jobs>>;
declare const _engine: EngineHandle;
void _engine.completed;
void _engine.retryExhausted;
// @ts-expect-error the engine write-extension does not carry the analytics reads
void _engine.failures;

// ── bare single Store.Service: service type is the handle (no at) ─────────────
const jobsStoreRegistration = QueueResource.store(Jobs);

class JobsStore extends Store.Service<JobsStore>("@test/SingleJobsStore")(
  jobsStoreRegistration,
) {}

type SingleHandle = StoreHandleAtKey<
  RegsOfStoreInput<ReturnType<typeof QueueResource.store<typeof Jobs>>>,
  typeof Jobs
>;

declare const _singleYield: Effect.Effect<SingleHandle, never, JobsStore>;
void _singleYield;

// @ts-expect-error single-registration Store.Service has no at
void JobsStore.at;
