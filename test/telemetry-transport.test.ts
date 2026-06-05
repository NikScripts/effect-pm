import { RpcTest } from "effect/unstable/rpc";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { BroadcastSink } from "../src/sink/BroadcastSink";
import {
  STATE_CHANGED_WIRE,
  RunResourceHubTelemetry,
  type RunResourceStateChangedInput,
} from "../src/store/RunResourceTelemetry";
import {
  TelemetryRpc,
  telemetryTransport,
} from "../src/telemetryTransport";

const sampleStateChanged = (
  resourceId: string,
  inFlight: number,
): RunResourceStateChangedInput => ({
  id: `${resourceId}/state/${String(inFlight)}`,
  changedAt: 1_700_000_000_000,
  reason: "RunResource.State.Started",
  previous: null,
  current: {
    resourceId,
    observedAt: 1_700_000_000_000,
    configVersion: 1,
    concurrency: 1,
    waiting: 0,
    inFlight,
    completed: 0,
    failed: 0,
    interrupted: 0,
    totalDurationMs: 0,
  },
});

describe("telemetryTransport", () => {
  it.live("streams live hub events through in-memory Effect RPC", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const rpcClient = yield* RpcTest.makeClient(TelemetryRpc).pipe(
          Effect.provide(telemetryTransport.live),
        );
        const client = telemetryTransport.makeClient(rpcClient);

        const collectedFiber = yield* client
          .stream({ wires: [STATE_CHANGED_WIRE] })
          .pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          );

        yield* Effect.yieldNow;
        yield* RunResourceHubTelemetry.State.changed(
          sampleStateChanged("@test/TelemetryRpc", 2),
        );

        const collected = yield* Fiber.join(collectedFiber);
        assert.strictEqual(collected.length, 1);
        assert.strictEqual(collected[0]?.wire, STATE_CHANGED_WIRE);
        assert.deepStrictEqual(
          (collected[0]?.payload as RunResourceStateChangedInput).current,
          sampleStateChanged("@test/TelemetryRpc", 2).current,
        );
      }).pipe(Effect.provide(BroadcastSink.layer)),
    ),
  );
});
