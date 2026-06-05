import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import {
  ControlRouter,
  ControlRpc,
  controlTransport,
  makeControlProtocolRequestEnvelope,
  Process,
  ProcessGroup,
  ProcessStorage,
  QueueResource,
} from "../src";

interface Email {
  readonly to: string;
}

describe("controlTransport", () => {
  it.live("dispatches ControlProtocol envelopes through in-memory Effect RPC", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/ControlTransportEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/ControlTransportProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/ControlTransportGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      yield* Effect.scoped(
        Effect.gen(function* () {
          const group = yield* BillingGroup;
          const rpcClient = yield* RpcTest.makeClient(ControlRpc).pipe(
            Effect.provide(controlTransport.live),
            Effect.provide(ControlRouter.layer(group)),
          );
          const client = controlTransport.makeClient(rpcClient);

          const contractEnvelope = yield* makeControlProtocolRequestEnvelope({
            _tag: "GetContract",
          });
          const contractResponse = yield* client.request(contractEnvelope);

          const runEnvelope = yield* makeControlProtocolRequestEnvelope({
            _tag: "RunProcessImmediately",
            processId: SyncProcess.id,
          });
          const runResponse = yield* client.request(runEnvelope);

          expect(contractResponse.response).toMatchObject({
            _tag: "Contract",
            status: 200,
            body: BillingGroup.contract,
          });
          expect(runResponse.response).toMatchObject({
            _tag: "Control",
            status: 200,
            body: { success: true },
          });
          expect(yield* Ref.get(runs)).toBe(1);
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  EmailQueue.layer,
                  SyncProcess.layer,
                  ProcessStorage.layer,
                ),
              ),
            ),
            ProcessStorage.layer,
          ),
        ),
      );
    }),
  );
});
