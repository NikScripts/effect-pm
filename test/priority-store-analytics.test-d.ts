import type { DateTime, Effect, Option, Stream } from "effect";
import * as Schema from "effect/Schema";
import * as WorkPool from "../src/WorkPool";
import * as Store from "../src/Store";
import type {
  QueueStoreCompleted,
  QueueStoreEntry,
  QueueStoreEvent,
  QueueStoreFailed,
  QueueStoreLatency,
  QueueStoreReads,
  QueueStoreStats,
} from "../src/internal/store/workPoolStoreSpec";
import type { StoreJournalDecodeError } from "../src/internal/store/errors";
import type { StoreHandleAtKey } from "../src/internal/store/defineStore";
import type { RegsOfStoreInput } from "../src/internal/store/registrationTypes";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectExact = <_Check extends true>(): void => {};

const jobSchema = Schema.Struct({ id: Schema.String });

class Jobs extends WorkPool.priority<Jobs>()("@test/CustomAnalyticsJobs", {
  payload: jobSchema,
  laneCount: 4,
}) {}

type Ev = QueueStoreEvent<typeof Jobs>;
type Entry = QueueStoreEntry<typeof Jobs>;
type Failed = QueueStoreFailed<typeof Jobs>;
type Completed = QueueStoreCompleted<typeof Jobs>;

type Regs = RegsOfStoreInput<[ReturnType<typeof WorkPool.store<typeof Jobs>>]>;
type Handle = StoreHandleAtKey<Regs, typeof Jobs>;

declare const _handle: Handle;
void _handle.record({ _tag: "Start", key: "q" });
void _handle.events();

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

expectExact<
  Equals<Pick<Handle, keyof QueueStoreReads<typeof Jobs>>, QueueStoreReads<typeof Jobs>>
>();
