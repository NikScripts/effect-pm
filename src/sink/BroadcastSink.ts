/**
 * **BroadcastSink** — optional {@link TelemetryHub} fan-out leg for live wire subscribers.
 *
 * @module sink/BroadcastSink
 */

import { Context, Effect, Layer, Queue, Ref, Stream } from "effect";
import { TelemetryHubState } from "../internal/telemetryHub/state";
import {
  sink,
  TelemetryHub,
  type TelemetryHubEmitted,
  type TelemetrySink,
} from "../TelemetryHub";

/** Live telemetry broadcast service. @public */
export interface TelemetryBroadcastService {
  readonly publish: (event: TelemetryHubEmitted) => Effect.Effect<void>;
  readonly stream: (
    wires?: ReadonlyArray<string> | undefined,
  ) => Stream.Stream<TelemetryHubEmitted>;
}

/** @public */
export class TelemetryBroadcast extends Context.Service<
  TelemetryBroadcast,
  TelemetryBroadcastService
>()("@nikscripts/effect-pm/sink/BroadcastSink/TelemetryBroadcast") {}

const matchesWires = (
  wires: ReadonlyArray<string> | undefined,
  wire: string,
): boolean => wires === undefined || wires.length === 0 || wires.includes(wire);

const makeTelemetryBroadcast = Effect.gen(function* () {
  const subscribersRef = yield* Ref.make<
    ReadonlyArray<Queue.Queue<TelemetryHubEmitted>>
  >([]);

  const publish = (event: TelemetryHubEmitted): Effect.Effect<void> =>
    Ref.get(subscribersRef).pipe(
      Effect.flatMap((queues) =>
        Effect.forEach(queues, (queue) => Queue.offer(queue, event), {
          concurrency: "unbounded",
          discard: true,
        }),
      ),
    );

  const stream = (
    wires?: ReadonlyArray<string> | undefined,
  ): Stream.Stream<TelemetryHubEmitted> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<TelemetryHubEmitted>();
        yield* Ref.update(subscribersRef, (queues) => [...queues, queue]);
        return Stream.fromQueue(queue).pipe(
          Stream.filter((event) => matchesWires(wires, event.wire)),
          Stream.ensuring(
            Ref.update(subscribersRef, (queues) =>
              queues.filter((candidate) => candidate !== queue),
            ),
          ),
        );
      }),
    );

  return TelemetryBroadcast.of({ publish, stream });
});

const broadcastServiceLayer = Layer.effect(
  TelemetryBroadcast,
  makeTelemetryBroadcast,
);

const makeForBroadcast = (): Effect.Effect<TelemetrySink, never, TelemetryBroadcast> =>
  Effect.map(TelemetryBroadcast, (broadcast) =>
    sink({
      tag: "BroadcastSink",
      wires: "all",
      policy: "bestEffort",
      handle: (emitted) => broadcast.publish(emitted),
    }),
  );

const broadcastSinkLayer: Layer.Layer<
  never,
  never,
  TelemetryBroadcast | TelemetryHubState
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const registered = yield* makeForBroadcast();
    const { sinksRef } = yield* TelemetryHubState;
    yield* Ref.update(sinksRef, (sinks) => [...sinks, registered]);
  }),
);

const hubBroadcastLayer = Layer.provideMerge(
  Layer.provideMerge(broadcastSinkLayer, broadcastServiceLayer),
  TelemetryHub.layer,
);

/** @public */
export namespace BroadcastSink {
  export type Service = TelemetryBroadcastService;

  /** Hub + {@link TelemetryBroadcast} + broadcast sink registered (default compose). */
  export const layer = hubBroadcastLayer;

  /** {@link TelemetryBroadcast} service only. */
  export const layerBroadcast = broadcastServiceLayer;

  /** Register hub sink without {@link TelemetryHub.layer}. */
  export const sinkLayer = broadcastSinkLayer;
  export const forBroadcast = makeForBroadcast;
}
