import { describe, expect, it } from "@effect/vitest";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Ref } from "effect";
import {
  ControlService,
  Process,
  ProcessGroup,
  ProcessManager,
  ProcessStore,
  QueueResource,
} from "../src";
import { provideLayer } from "../src/provideLayer.js";

interface Email {
  readonly to: string;
}

const waitForQueueCompleted = (
  queue: { readonly completed: Effect.Effect<number, never, never> },
  expected: number,
) =>
  Effect.gen(function* () {
    while ((yield* queue.completed) < expected) {
      yield* Effect.sleep("5 millis");
    }
  });

describe("ProcessManager", () => {
  it.live("verifies a remote group contract and runs a process by typed id", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runs = yield* Ref.make(0);

        class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
          "@test/ManagerEmailQueue",
          {
            effect: (_email) => Effect.void,
          },
        ) {}

        class SyncProcess extends Process.Service<SyncProcess>()(
          "@test/ManagerSyncProcess",
          {
            effect: Ref.update(runs, (count) => count + 1),
          },
        ) {}

        class OtherProcess extends Process.Service<OtherProcess>()(
          "@test/ManagerOtherProcess",
          {
            effect: Effect.void,
          },
        ) {}

        class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
          "@test/ManagerBillingGroup",
          [SyncProcess, EmailQueue] as const,
        ) {}

        yield* Effect.gen(function* () {
          const group = yield* BillingGroup;
          const manager = ProcessManager.connect(BillingGroup, {
            baseUrl: "http://127.0.0.1:32126",
          });
          const rawContractManager = ProcessManager.connect({
            baseUrl: "http://127.0.0.1:32126",
            contract: BillingGroup.contract,
          });
          const mismatchedGroup = yield* ProcessGroup.make(
            "@test/ManagerBillingGroup",
            [OtherProcess] as const,
          );
          const mismatchedManager = ProcessManager.connect({
            baseUrl: "http://127.0.0.1:32126",
            contract: mismatchedGroup.contract,
          });

          yield* ControlService.make({
            port: 32126,
            group,
          });

          yield* manager.verifyContract;
          yield* manager.process(SyncProcess.id).runImmediately;
          yield* rawContractManager.verifyContract;
          yield* rawContractManager.process(SyncProcess.id).runImmediately;
          const mismatch = yield* mismatchedManager.verifyContract.pipe(Effect.flip);
          const missingRun = yield* mismatchedManager
            .process(OtherProcess.id)
            .runImmediately
            .pipe(Effect.flip);

          // @ts-expect-error queue ids are not valid process ids
          manager.process(EmailQueue.id);

          expect(mismatch.reason).toContain("process ids");
          expect(missingRun.status).toBe(404);
          expect(missingRun.reason).toContain("could not run immediately");
          expect(yield* Ref.get(runs)).toBe(2);
        }).pipe(
          provideLayer(BillingGroup.layer),
          provideLayer(EmailQueue.layer),
          provideLayer(ProcessStore.layer),
          provideLayer(NodeHttpClient.layerUndici),
        );
      }),
    ),
  );

  it.live("reads remote queue status by typed queue id", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const delivered = yield* Ref.make<ReadonlyArray<string>>([]);

        class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
          "@test/ManagerStatusEmailQueue",
          {
            effect: (email) =>
              Ref.update(delivered, (emails) => [...emails, email.to]),
            concurrency: 1,
          },
        ) {}

        class SyncProcess extends Process.Service<SyncProcess>()(
          "@test/ManagerStatusProcess",
          {
            effect: Effect.void,
          },
        ) {}

        class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
          "@test/ManagerStatusGroup",
          [SyncProcess, EmailQueue] as const,
        ) {}

        yield* Effect.gen(function* () {
          const group = yield* BillingGroup;
          const queue = yield* EmailQueue;
          const manager = ProcessManager.connect(BillingGroup, {
            baseUrl: "http://127.0.0.1:32127",
          });

          yield* ControlService.make({
            port: 32127,
            group,
          });

          yield* queue.add({ to: "ops@example.com" });
          yield* waitForQueueCompleted(queue, 1);

          const status = yield* manager.queue(EmailQueue.id).status;

          // @ts-expect-error process ids are not valid queue ids
          manager.queue(SyncProcess.id);

          expect(status.success).toBe(true);
          expect(status.type).toBe("queue");
          expect(status.data).toMatchObject({
            name: EmailQueue.id,
            completed: 1,
          });
          expect(yield* Ref.get(delivered)).toEqual(["ops@example.com"]);
        }).pipe(
          provideLayer(BillingGroup.layer),
          provideLayer(EmailQueue.layer),
          provideLayer(ProcessStore.layer),
          provideLayer(NodeHttpClient.layerUndici),
        );
      }),
    ),
  );

  it.live("provides a remote manager as an endpoint service", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runs = yield* Ref.make(0);

        class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
          "@test/ManagerEndpointEmailQueue",
          {
            effect: (_email) => Effect.void,
          },
        ) {}

        class SyncProcess extends Process.Service<SyncProcess>()(
          "@test/ManagerEndpointProcess",
          {
            effect: Ref.update(runs, (count) => count + 1),
          },
        ) {}

        class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
          "@test/ManagerEndpointGroup",
          [SyncProcess, EmailQueue] as const,
        ) {}

        class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
          BillingGroup,
          {
            baseUrl: "http://127.0.0.1:32129",
          },
        ) {}

        yield* Effect.gen(function* () {
          const group = yield* BillingGroup;
          const manager = yield* BillingEndpoint;

          yield* ControlService.make({
            port: 32129,
            group,
          });

          expect(BillingEndpoint.contract.id).toBe(BillingGroup.contract.id);
          yield* manager.verifyContract;
          yield* manager.process(SyncProcess.id).runImmediately;
          expect(yield* Ref.get(runs)).toBe(1);
        }).pipe(
          provideLayer(BillingGroup.layer),
          provideLayer(BillingEndpoint.layer),
          provideLayer(EmailQueue.layer),
          provideLayer(ProcessStore.layer),
          provideLayer(NodeHttpClient.layerUndici),
        );
      }),
    ),
  );

  it.live("fails contract verification when remote process entries drift", () =>
    Effect.scoped(
      Effect.gen(function* () {
        class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
          "@test/ManagerDriftEmailQueue",
          {
            effect: (_email) => Effect.void,
          },
        ) {}

        class SyncProcess extends Process.Service<SyncProcess>()(
          "@test/ManagerDriftProcess",
          {
            effect: Effect.void,
          },
        ) {}

        class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
          "@test/ManagerDriftGroup",
          [SyncProcess, EmailQueue] as const,
        ) {}

        yield* Effect.gen(function* () {
          const group = yield* BillingGroup;
          const staleManager = ProcessManager.connect({
            baseUrl: "http://127.0.0.1:32132",
            contract: {
              ...BillingGroup.contract,
              processes: [],
            },
          });

          yield* ControlService.make({
            port: 32132,
            group,
          });

          const error = yield* staleManager.verifyContract.pipe(Effect.flip);

          expect(error._tag).toBe("ProcessManagerRequestError");
          expect(error.reason).toContain("Remote process ids");
        }).pipe(
          provideLayer(BillingGroup.layer),
          provideLayer(EmailQueue.layer),
          provideLayer(ProcessStore.layer),
          provideLayer(NodeHttpClient.layerUndici),
        );
      }),
    ),
  );

  it.live("fails remote group controls when the endpoint contract drifts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
          "@test/RemoteLayerDriftEmailQueue",
          {
            effect: (_email) => Effect.void,
          },
        ) {}

        class SyncProcess extends Process.Service<SyncProcess>()(
          "@test/RemoteLayerDriftProcess",
          {
            effect: Effect.void,
          },
        ) {}

        class LocalGroup extends ProcessGroup.Service<LocalGroup>()(
          "@test/RemoteLayerDriftGroup",
          [SyncProcess, EmailQueue] as const,
        ) {}

        class StaleGroup extends ProcessGroup.Service<StaleGroup>()(
          "@test/RemoteLayerDriftGroup",
          [SyncProcess] as const,
        ) {}

        class StaleEndpoint extends ProcessManager.Endpoint<StaleEndpoint>()(
          StaleGroup,
          {
            baseUrl: "http://127.0.0.1:32133",
          },
        ) {}

        yield* Effect.gen(function* () {
          const localGroup = yield* LocalGroup;

          yield* ControlService.make({
            port: 32133,
            group: localGroup,
          });

          const remoteProgram = Effect.gen(function* () {
            const staleRemoteGroup = yield* StaleGroup;
            return yield* staleRemoteGroup.status.pipe(Effect.flip);
          }).pipe(
            provideLayer(ProcessGroup.remoteLayer(StaleGroup, StaleEndpoint)),
            provideLayer(StaleEndpoint.layer),
            provideLayer(NodeHttpClient.layerUndici),
          );

          const error = yield* remoteProgram;

          expect(error._tag).toBe("ProcessGroupRemoteControlError");
          if ("reason" in error) {
            expect(error.reason).toContain("Remote queue ids");
          } else {
            throw new Error(`Unexpected error: ${String(error)}`);
          }
        }).pipe(
          provideLayer(LocalGroup.layer),
          provideLayer(EmailQueue.layer),
          provideLayer(ProcessStore.layer),
        );
      }),
    ),
  );

  it.live("provides typed remote group controls through ProcessGroup.remoteLayer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const delivered = yield* Ref.make<ReadonlyArray<string>>([]);
        const runs = yield* Ref.make(0);

        class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
          "@test/RemoteLayerEmailQueue",
          {
            effect: (email) =>
              Ref.update(delivered, (emails) => [...emails, email.to]),
            concurrency: 1,
          },
        ) {}

        class SyncProcess extends Process.Service<SyncProcess>()(
          "@test/RemoteLayerProcess",
          {
            effect: Ref.update(runs, (count) => count + 1),
          },
        ) {}

        class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
          "@test/RemoteLayerGroup",
          [SyncProcess, EmailQueue] as const,
        ) {}

        class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
          BillingGroup,
          {
            baseUrl: "http://127.0.0.1:32131",
          },
        ) {}

        yield* Effect.gen(function* () {
          const localGroup = yield* BillingGroup;
          const localQueue = yield* EmailQueue;

          yield* ControlService.make({
            port: 32131,
            group: localGroup,
          });

          const remoteProgram = Effect.gen(function* () {
            const remoteGroup = yield* BillingGroup;

            yield* remoteGroup.process(SyncProcess).runImmediately;
            yield* remoteGroup.queue(EmailQueue).pause;
            yield* localQueue.add({ to: "ops@example.com" });
            yield* Effect.sleep("20 millis");

            expect(yield* Ref.get(runs)).toBe(1);
            expect(yield* Ref.get(delivered)).toEqual([]);

            yield* remoteGroup.queue(EmailQueue).resume;
            yield* waitForQueueCompleted(localQueue, 1);

            const queueStatus = yield* remoteGroup.queue(EmailQueue).status;
            expect(queueStatus).toMatchObject({
              name: EmailQueue.id,
              completed: 1,
            });

            yield* remoteGroup.queue(EmailQueue).pause;
            yield* localQueue.add([
              { to: "a@example.com" },
              { to: "b@example.com" },
            ]);

            const cleared = yield* remoteGroup.queue(EmailQueue).clear;
            expect(cleared).toBe(1);

            const enqueueError = yield* remoteGroup
              .queue(EmailQueue)
              .enqueue({ to: "blocked@example.com" })
              .pipe(Effect.flip);
            expect(enqueueError._tag).toBe("UnsupportedRemoteControlError");
            if (enqueueError._tag === "UnsupportedRemoteControlError") {
              expect(enqueueError.operation).toBe("queue.enqueue");
            }

            const addError = yield* remoteGroup
              .queue(EmailQueue)
              .add({ to: "blocked-add@example.com" })
              .pipe(Effect.flip);
            expect(addError._tag).toBe("UnsupportedRemoteControlError");
            if (addError._tag === "UnsupportedRemoteControlError") {
              expect(addError.operation).toBe("queue.add");
            }

            const prioritizeError = yield* remoteGroup
              .queue(EmailQueue)
              .prioritize({ to: "blocked-prioritize@example.com" })
              .pipe(Effect.flip);
            expect(prioritizeError._tag).toBe("UnsupportedRemoteControlError");
            if (prioritizeError._tag === "UnsupportedRemoteControlError") {
              expect(prioritizeError.operation).toBe("queue.prioritize");
            }

            const deferError = yield* remoteGroup
              .queue(EmailQueue)
              .defer({ to: "blocked-defer@example.com" })
              .pipe(Effect.flip);
            expect(deferError._tag).toBe("UnsupportedRemoteControlError");
            if (deferError._tag === "UnsupportedRemoteControlError") {
              expect(deferError.operation).toBe("queue.defer");
            }

            const getQueueError = yield* remoteGroup
              .legacy
              .getQueue(EmailQueue.id)
              .pipe(Effect.flip);
            expect(getQueueError._tag).toBe("UnsupportedRemoteControlError");
            if (getQueueError._tag === "UnsupportedRemoteControlError") {
              expect(getQueueError.operation).toBe("getQueue");
            }
          }).pipe(
            provideLayer(ProcessGroup.remoteLayer(BillingGroup, BillingEndpoint)),
            provideLayer(BillingEndpoint.layer),
            provideLayer(NodeHttpClient.layerUndici),
          );

          yield* remoteProgram;
        }).pipe(
          provideLayer(BillingGroup.layer),
          provideLayer(EmailQueue.layer),
          provideLayer(ProcessStore.layer),
        );
      }),
    ),
  );
});
