/**
 * Process-manager log capture relay (persists via {@link LogStore}).
 *
 * @module logsRelay
 */

import { Duration, Effect, Layer, Option, PubSub, Ref, Schedule, Scope, Stream } from "effect";
import { ProcessGroupLogContext } from "../../LogContext";
import type { LogEntry } from "../../LogEntry";
import {
  LogRelay,
  type LogRelayService,
} from "./logCapture";
import { LogStore } from "../../store/log";
import { ProcessStore } from "../../ProcessStore";

const storeFlushInterval = Duration.millis(250);
const storeFlushBatchSize = 64;
const historyCapacity = 500;

type PendingLogAppend = {
  readonly entryId: string;
  readonly entry: LogEntry;
};

const makePersistingRelay = (
  base: LogRelayService,
): Effect.Effect<LogRelayService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const entryCounter = yield* Ref.make(0);
    const buffer = yield* Ref.make<ReadonlyArray<PendingLogAppend>>([]);

    const flush = Effect.gen(function* () {
      const groupOption = yield* Effect.serviceOption(ProcessGroupLogContext);
      if (Option.isNone(groupOption)) {
        return;
      }
      const batch = yield* Ref.getAndSet(buffer, []);
      if (batch.length === 0) {
        return;
      }
      yield* LogStore.recordBatch(groupOption.value.groupId, batch).pipe(
        ProcessStore.catchErrorAndLog({
          message: "LogStore write failed while relaying logs",
          level: "warning",
          annotations: { groupId: groupOption.value.groupId },
        }),
      );
    });

    yield* Effect.addFinalizer(() => flush);
    yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(storeFlushInterval)));

    const queueAppend = (entry: LogEntry): Effect.Effect<void> =>
      Effect.gen(function* () {
        const groupOption = yield* Effect.serviceOption(ProcessGroupLogContext);
        if (Option.isNone(groupOption)) {
          return;
        }
        const entryId = String((yield* Ref.getAndUpdate(entryCounter, (n) => n + 1)));
        yield* Ref.update(buffer, (rows) => [...rows, { entryId, entry }]);
        const pending = yield* Ref.get(buffer);
        if (pending.length >= storeFlushBatchSize) {
          yield* flush;
        }
      });

    return LogRelay.of({
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
 * Relay layer with in-memory tail plus batched flush into {@link LogStore}.
 *
 * @public
 */
export const logsRelayLayer: Layer.Layer<LogRelay, never, Scope.Scope> =
  Layer.effect(
  LogRelay,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<LogEntry>();
    const history = yield* Ref.make<ReadonlyArray<LogEntry>>([]);
    const base = LogRelay.of({
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
