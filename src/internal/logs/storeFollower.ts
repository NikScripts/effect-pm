/**
 * Batched durable writer — subscribes to {@link LogRelay} (no second capture logger).
 *
 * @module internal/logs/storeFollower
 * @internal
 */

import { Duration, Effect, Layer, Queue, Ref, Stream } from "effect";
import { LogAnnotationKeys } from "../../LogContext";
import type { LogEntry } from "../../LogEntry";
import { LogStore } from "../../store/log";
import { LogRelay } from "./relay";

/**
 * Fork a batched writer that appends every relay line to {@link LogStore}.
 *
 * @param node - **Node log key** (`Resource.Node.key`) — stamped under annotation key
 *   `LogAnnotationKeys.node` and used as **store bucket key** `groupId`. Example: `WnbaNode.key` in
 *   `resource-web/hub.ts`. Catalog: `docs/LOGS.md`.
 *
 * @internal
 */
export const persistLayer = (node: string): Layer.Layer<never, never, LogRelay | LogStore> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const relay = yield* LogRelay;
      const store = yield* LogStore;
      const queue = yield* Queue.unbounded<LogEntry>();
      const counter = yield* Ref.make(0);

      yield* Effect.forkScoped(
        relay.stream.pipe(Stream.runForEach((entry) => Queue.offer(queue, entry))),
      );

      yield* Effect.forkScoped(
        Stream.runForEach(
          Stream.groupedWithin(Stream.fromQueue(queue), 64, Duration.millis(250)),
          (entries) =>
            Effect.gen(function* () {
              const start = yield* Ref.getAndUpdate(counter, (n) => n + entries.length);
              const rows = entries.map((entry, index) => ({
                entryId: String(start + index).padStart(12, "0"),
                entry: {
                  ...entry,
                  annotations: {
                    ...entry.annotations,
                    [LogAnnotationKeys.node]: node,
                  },
                },
              }));
              return yield* store.recordBatch(node, rows).pipe(Effect.orDie);
            }),
        ),
      );

      return Layer.empty;
    }),
  );
