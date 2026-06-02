import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import {
  ControlRouter,
  ControlRpc,
  ControlTransportRpc,
  makeControlProtocolRequestEnvelope,
  Process,
  ProcessGroup,
  ProcessManager,
  ProcessStorage,
  QueueResource,
} from "../src";

interface Email {
  readonly to: string;
}

describe("ControlTransportRpc", () => {
  it.live("dispatches existing ControlProtocol envelopes through in-memory Effect RPC", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/RpcTransportDispatchEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/RpcTransportDispatchProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/RpcTransportDispatchGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      yield* Effect.scoped(
        Effect.gen(function* () {
          const group = yield* BillingGroup;
          const rpcClient = yield* RpcTest.makeClient(ControlRpc).pipe(
            Effect.provide(ControlTransportRpc.live),
            Effect.provide(ControlRouter.layer(group)),
          );
          const transport = ControlTransportRpc.client(rpcClient);

          const contractEnvelope = yield* makeControlProtocolRequestEnvelope({
            _tag: "GetContract",
          });
          const contractResponse = yield* transport.request(contractEnvelope);

          const runEnvelope = yield* makeControlProtocolRequestEnvelope({
            _tag: "RunProcessImmediately",
            processId: SyncProcess.id,
          });
          const runResponse = yield* transport.request(runEnvelope);

          const queueEnvelope = yield* makeControlProtocolRequestEnvelope({
            _tag: "ReadQueueStatus",
            queueId: EmailQueue.id,
          });
          const queueResponse = yield* transport.request(queueEnvelope);

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
          expect(queueResponse.response).toMatchObject({
            _tag: "Control",
            status: 200,
            body: {
              success: true,
              type: "queue",
              data: {
                name: EmailQueue.id,
                completed: 0,
              },
            },
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

  it.live("connects ProcessManager through the RPC transport adapter", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/RpcTransportProcessManagerEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/RpcTransportProcessManagerProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/RpcTransportProcessManagerGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      yield* Effect.scoped(
        Effect.gen(function* () {
          const group = yield* BillingGroup;
          const rpcClient = yield* RpcTest.makeClient(ControlRpc).pipe(
            Effect.provide(ControlTransportRpc.live),
            Effect.provide(ControlRouter.layer(group)),
          );
          const manager = ProcessManager.connect(BillingGroup, {
            transport: ControlTransportRpc.client(rpcClient),
          });

          yield* manager.verifyContract;
          yield* manager.process(SyncProcess.id).runImmediately;
          const status = yield* manager.status;
          const queueStatus = yield* manager.queue(EmailQueue.id).status;

          expect(status.success).toBe(true);
          expect(queueStatus).toMatchObject({
            success: true,
            type: "queue",
            data: {
              name: EmailQueue.id,
              completed: 0,
            },
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
