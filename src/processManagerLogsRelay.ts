/**
 * Process-manager log capture relay (persists via {@link ProcessStoreGroupLog}).
 *
 * @module processManagerLogsRelay
 */

import { Cause, Duration, Effect, Layer, Option, PubSub, Ref, Schedule, Scope, Stream } from "effect";
import { ProcessGroupLogContext } from "./processManagerLogContext";
import type { ProcessManagerLogEntry } from "./processManagerLogEntry";
import {
  ProcessManagerLogRelay,
  type ProcessManagerLogRelayService,
} from "./processManagerLogRelay";
import { ProcessStoreGroupLog } from "./ProcessStoreGroupLog";

const storeFlushInterval = Duration.millis(250);
const storeFlushBatchSize = 64;
const historyCapacity = 500;

type PendingLogAppend = {
  readonly entryId: string;
  readonly entry: ProcessManagerLogEntry;
};

const makePersistingRelay = (
  base: ProcessManagerLogRelayService,
): Effect.Effect<ProcessManagerLogRelayService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const entryCounter = yield* Ref.make(0);
    const buffer = yield* Ref.make<ReadonlyArray<PendingLogAppend>>([]);

    const flush = Effect.gen(function* () {
      const groupLogOption = yield* Effect.serviceOption(ProcessStoreGroupLog);
      const groupOption = yield* Effect.serviceOption(ProcessGroupLogContext);
      if (Option.isNone(groupLogOption) || Option.isNone(groupOption)) {
        return;
      }
      const batch = yield* Ref.getAndSet(buffer, []);
      if (batch.length === 0) {
        return;
      }
      yield* groupLogOption.value.recordBatch(groupOption.value.groupId, batch).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("ProcessStoreGroupLog.recordBatch failed").pipe(
            Effect.annotateLogs("cause", Cause.pretty(cause)),
          ),
        ),
      );
    });

    yield* Effect.addFinalizer(() => flush);
    yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(storeFlushInterval)));

    const queueAppend = (entry: ProcessManagerLogEntry): Effect.Effect<void> =>
      Effect.gen(function* () {
        const groupLogOption = yield* Effect.serviceOption(ProcessStoreGroupLog);
        if (Option.isNone(groupLogOption)) {
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
          yield* flush;
        }),
      snapshot: base.snapshot,
      stream: base.stream,
    });
  });

/**
 * Relay layer with in-memory tail plus batched flush into {@link ProcessStoreGroupLog}.
 *
 * @public
 */
export const logsRelayLayer: Layer.Layer<ProcessManagerLogRelay, never, Scope.Scope> =
  Layer.effect(
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

/** @public Root export alias for process-manager wiring. */
export const relayLayer = logsRelayLayer;
