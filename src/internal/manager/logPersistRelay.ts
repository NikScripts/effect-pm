/**
 * In-memory log relay — a bounded sliding tail + PubSub for live watch. Durable persistence is a
 * separate, opt-in concern (`HostLogs.persistLayer(host)` → {@link LogStore}, keyed by host).
 *
 * @module logsRelay
 */

import { Effect, Layer, PubSub, Ref, type Scope, Stream } from "effect";
import type { LogEntry } from "../../LogEntry";
import { LogRelay } from "./logCapture";

const historyCapacity = 500;

/**
 * Relay layer: an in-memory sliding tail (last {@link historyCapacity}) for {@link LogRelay.snapshot}
 * plus a PubSub for {@link LogRelay.stream} (live watch).
 *
 * @public
 */
export const logsRelayLayer: Layer.Layer<LogRelay, never, Scope.Scope> = Layer.effect(
  LogRelay,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<LogEntry>();
    const history = yield* Ref.make<ReadonlyArray<LogEntry>>([]);
    return LogRelay.of({
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
  }),
);

/** @public Root export alias for process-manager wiring. */
export const relayLayer = logsRelayLayer;
