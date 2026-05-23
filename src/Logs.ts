/**
 * `@nikscripts/effect-pm/Logs` — re-exports the {@link ProcessStoreInterface.Logs} facet.
 *
 * @remarks
 * **Storage:** compose `RuntimeStorage` + `ProcessStore` at launch (e.g.
 * `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`). This module does not
 * provide storage layers.
 *
 * Prefer:
 *
 * ```ts
 * const { Logs } = yield* ProcessStore;
 * yield* Logs.query({ groupId: "g1", limit: 100, sort: "desc" });
 * ```
 *
 * Top-level `record` / `query` helpers delegate to `store.Logs` when {@link ProcessStore}
 * is in context. {@link relayLayer} is process-manager capture (not part of the store API).
 *
 * @module Logs
 */

import { Cause, Duration, Effect, Layer, Option, PubSub, Ref, Schedule, Scope, Stream } from "effect";
import {
  ProcessGroupLogContext,
} from "./processManagerLogContext.js";
import type { ProcessManagerLogEntry } from "./processManagerLogEntry.js";
import {
  ProcessManagerLogRelay,
  type ProcessManagerLogRelayService,
} from "./processManagerLogRelay.js";
import type { ProcessManagerLogQuery } from "./processManagerLogQuery.js";
import { ProcessManagerLogQueryError } from "./processManagerLogQuery.js";
import { ProcessStore, type ProcessStoreWriteError } from "./ProcessStore.js";
import type { ProcessStoreLogsApi } from "./ProcessStoreLogs.js";
import {
  makeRecordedEvent,
  storeEventQueryFromLogQuery,
} from "./ProcessStoreLogs.js";

export type { ProcessStoreLogsApi };
export { makeRecordedEvent, storeEventQueryFromLogQuery };

export const record = (
  groupId: string,
  entryId: string,
  entry: ProcessManagerLogEntry,
): Effect.Effect<void, ProcessStoreWriteError, ProcessStore> =>
  Effect.flatMap(ProcessStore, (store) => store.Logs.record(groupId, entryId, entry));

export const recordBatch = (
  groupId: string,
  rows: Parameters<ProcessStoreLogsApi["recordBatch"]>[1],
): Effect.Effect<void, ProcessStoreWriteError, ProcessStore> =>
  Effect.flatMap(ProcessStore, (store) => store.Logs.recordBatch(groupId, rows));

export const load = (
  query: ProcessManagerLogQuery,
): Effect.Effect<ReadonlyArray<ProcessManagerLogEntry>, ProcessManagerLogQueryError, ProcessStore> =>
  Effect.flatMap(ProcessStore, (store) => store.Logs.load(query));

export const query = (
  logQuery: ProcessManagerLogQuery,
): Effect.Effect<void, ProcessManagerLogQueryError, ProcessStore> =>
  Effect.flatMap(ProcessStore, (store) => store.Logs.query(logQuery));

const storeFlushInterval = Duration.millis(250);
const storeFlushBatchSize = 64;

type PendingLogAppend = {
  readonly entryId: string;
  readonly entry: ProcessManagerLogEntry;
};

const makePersistingRelay = (
  base: ProcessManagerLogRelayService,
): Effect.Effect<
  ProcessManagerLogRelayService,
  never,
  ProcessGroupLogContext | ProcessStore | Scope.Scope
> =>
  Effect.gen(function* () {
    const group = yield* ProcessGroupLogContext;
    const storeOption = yield* Effect.serviceOption(ProcessStore);
    const entryCounter = yield* Ref.make(0);
    const buffer = yield* Ref.make<ReadonlyArray<PendingLogAppend>>([]);

    const flush = Effect.gen(function* () {
      if (Option.isNone(storeOption)) {
        return;
      }
      const batch = yield* Ref.getAndSet(buffer, []);
      if (batch.length === 0) {
        return;
      }
      yield* storeOption.value.Logs.recordBatch(group.groupId, batch).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("ProcessStore Logs.recordBatch failed").pipe(
            Effect.annotateLogs("cause", Cause.pretty(cause)),
          ),
        ),
      );
    });

    yield* Effect.addFinalizer(() => flush);
    yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(storeFlushInterval)));

    const queueAppend = (entry: ProcessManagerLogEntry): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (Option.isNone(storeOption)) {
          return;
        }
        const entryId = String((yield* Ref.getAndUpdate(entryCounter, (n) => n + 1)));
        yield* Ref.update(buffer, (rows) => [...rows, { entryId, entry }]);
        const pending = yield* Ref.get(buffer);
        if (pending.length >= storeFlushBatchSize) {
          yield* flush;
        }
      });

    return ProcessManagerLogRelay.of({
      publish: (entry) =>
        Effect.gen(function* () {
          yield* base.publish(entry);
          yield* queueAppend(entry);
        }),
      snapshot: base.snapshot,
      stream: base.stream,
    });
  });

const historyCapacity = 500;

/**
 * Relay layer with in-memory tail plus batched flush into `store.Logs`.
 *
 * @public
 */
export const relayLayer: Layer.Layer<
  ProcessManagerLogRelay,
  never,
  ProcessGroupLogContext | ProcessStore
> = Layer.effect(
  ProcessManagerLogRelay,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<ProcessManagerLogEntry>();
    const history = yield* Ref.make<ReadonlyArray<ProcessManagerLogEntry>>([]);
    const base = ProcessManagerLogRelay.of({
      publish: (entry) =>
        Effect.gen(function* () {
          yield* PubSub.publish(pubsub, entry);
          yield* Ref.update(history, (items) => {
            const next = [...items, entry];
            return next.length <= historyCapacity
              ? next
              : next.slice(next.length - historyCapacity);
          });
        }),
      snapshot: Ref.get(history),
      stream: Stream.fromPubSub(pubsub),
    });
    return yield* makePersistingRelay(base);
  }),
);
