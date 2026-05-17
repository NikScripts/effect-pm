import { describe, expect, it } from "@effect/vitest";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, ConfigProvider, Effect, Layer, Ref } from "effect";
import {
  ControlRouter,
  ControlService,
  ControlTransportClient,
  makeControlProtocolRouter,
  Process,
  ProcessGroup,
  ProcessManager,
  ProcessStore,
  QueueResource,
} from "../src";

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
  it.live("connects through an in-memory control transport without HTTP", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
        "@test/MemoryTransportEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/MemoryTransportProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/MemoryTransportBillingGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;
        const router = makeControlProtocolRouter(group);
        const manager = ProcessManager.connect(BillingGroup, {
          transport: {
            request: router.handle,
          },
        });

        yield* manager.verifyContract;
        yield* manager.process(SyncProcess.id).runImmediately;
        const queueStatus = yield* manager.queue(EmailQueue.id).status;

        expect(queueStatus).toMatchObject({
          success: true,
          type: "queue",
          data: {
            name: EmailQueue.id,
            completed: 0,
          },
        });
        expect(yield* Ref.get(runs)).toBe(1);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  EmailQueue.layer,
                  SyncProcess.layer,
                  ProcessStore.layer,
                ),
              ),
            ),
            ProcessStore.layer,
          ),
        ),
      );
    }),
  );

  it.live("provides a remote group through layered in-memory control transport", () =>
    Effect.gen(function* () {
      const delivered = yield* Ref.make<ReadonlyArray<string>>([]);
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
        "@test/LayeredMemoryTransportEmailQueue",
        {
          effect: (email) =>
            Ref.update(delivered, (emails) => [...emails, email.to]),
          concurrency: 1,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/LayeredMemoryTransportProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/LayeredMemoryTransportBillingGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
        BillingGroup,
        { transport: "context" },
      ) {}

      const inMemoryTransportLayer = Layer.effect(
        ControlTransportClient,
        Effect.map(ControlRouter, (router) => ({
          request: router.handle,
        })),
      );

      yield* Effect.gen(function* () {
        const localGroup = yield* BillingGroup;
        const localQueue = yield* EmailQueue;

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

          expect(yield* Ref.get(delivered)).toEqual(["ops@example.com"]);
        }).pipe(
          Effect.provide(
            ProcessGroup.remoteLayer(BillingGroup, BillingEndpoint).pipe(
              Layer.provide(BillingEndpoint.layer),
              Layer.provide(inMemoryTransportLayer),
              Layer.provide(ControlRouter.layer(localGroup)),
            ),
          ),
        );

        yield* remoteProgram;
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(EmailQueue.layer, SyncProcess.layer, ProcessStore.layer),
              ),
            ),
            EmailQueue.layer,
            ProcessStore.layer,
          ),
        ),
      );
    }),
  );

  it.live("verifies a remote group contract and runs a process by typed id", () =>
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
        expect(missingRun.reason).toContain("not found");
        expect(yield* Ref.get(runs)).toBe(2);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  OtherProcess.layer,
                  EmailQueue.layer,
                  SyncProcess.layer,
                  ProcessStore.layer,
                ),
              ),
            ),
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("connects to a group through the typed connection registry", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
        "@test/RegistryEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/RegistryProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/RegistryBillingGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      const billingRegistryLayer = ProcessManager.ConnectionRegistry.layer(
        [BillingGroup] as const,
        {
          [BillingGroup.id]: "http://127.0.0.1:32136",
        },
      );

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;

        yield* ControlService.make({
          port: 32136,
          group,
        });

        const manager = yield* ProcessManager.connect(BillingGroup);
        yield* manager.verifyContract;
        yield* manager.process(SyncProcess.id).runImmediately;

        expect(yield* Ref.get(runs)).toBe(1);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  EmailQueue.layer,
                  SyncProcess.layer,
                  ProcessStore.layer,
                  billingRegistryLayer,
                ),
              ),
            ),
            billingRegistryLayer,
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("connects to a group through a config-backed connection registry", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()(
        "@test/ConfigRegistryEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/ConfigRegistryProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/ConfigRegistryBillingGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      const billingRegistryConfigLayer = ProcessManager.ConnectionRegistry.layerConfig(
        [BillingGroup] as const,
        {
          [BillingGroup.id]: Config.string("CONFIG_REGISTRY_BILLING_URL"),
        },
      );
      const configProviderLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          CONFIG_REGISTRY_BILLING_URL: "http://127.0.0.1:32140",
        }),
      );
      const billingRegistryLayer = billingRegistryConfigLayer.pipe(
        Layer.provide(configProviderLayer),
      );

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;

        yield* ControlService.make({
          port: 32140,
          group,
        });

        const manager = yield* ProcessManager.connect(BillingGroup);
        yield* manager.verifyContract;
        yield* manager.process(SyncProcess.id).runImmediately;

        expect(yield* Ref.get(runs)).toBe(1);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  EmailQueue.layer,
                  SyncProcess.layer,
                  ProcessStore.layer,
                  billingRegistryLayer,
                ),
              ),
            ),
            billingRegistryLayer,
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("runs a multi-group CLI with target aliases from the connection registry", () =>
    Effect.gen(function* () {
      const northRuns = yield* Ref.make(0);
      const southRuns = yield* Ref.make(0);

      class NorthQueue extends QueueResource.Service<NorthQueue, Email, void>()(
        "@repo/NorthWest/BillingGroup/BillingEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SouthQueue extends QueueResource.Service<SouthQueue, Email, void>()(
        "@repo/SouthWest/BillingGroup/BillingEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class NorthSync extends Process.Service<NorthSync>()(
        "@repo/NorthWest/BillingGroup/SyncInvoices",
        {
          effect: Ref.update(northRuns, (count) => count + 1),
        },
      ) {}

      class SouthSync extends Process.Service<SouthSync>()(
        "@repo/SouthWest/BillingGroup/SyncInvoices",
        {
          effect: Ref.update(southRuns, (count) => count + 1),
        },
      ) {}

      class NorthGroup extends ProcessGroup.Service<NorthGroup>()(
        "@repo/NorthWest/BillingGroup",
        [NorthSync, NorthQueue] as const,
      ) {}

      class SouthGroup extends ProcessGroup.Service<SouthGroup>()(
        "@repo/SouthWest/BillingGroup",
        [SouthSync, SouthQueue] as const,
      ) {}

      yield* Effect.gen(function* () {
        const northGroup = yield* NorthGroup;
        const southGroup = yield* SouthGroup;
        const cli = ProcessManager.cli([NorthGroup, SouthGroup] as const, {
          name: "Test ProcessManager CLI",
          version: "0.0.0",
        });

        yield* ControlService.make({
          port: 32138,
          group: northGroup,
        });
        yield* ControlService.make({
          port: 32139,
          group: southGroup,
        });

        yield* cli([
          "now",
          "north-west/billing-group/sync-invoices",
        ]);
        yield* cli([
          "pause",
          "north-west/billing-group/billing-email-queue",
        ]);
        yield* cli([
          "status",
          "north-west/billing-group/sync-invoices",
        ]);
        yield* cli([
          "status",
          "north-west/billing-group/billing-email-queue",
        ]);
        yield* cli(["groups"]);
        yield* cli(["ls"]);
        yield* cli(["verify"]);
        yield* cli(["groups", "--json"]);
        yield* cli(["ls", "--json"]);
        yield* cli(["verify", "--json"]);
        yield* cli([
          "status",
          "north-west/billing-group/sync-invoices",
          "--json",
        ]);

        const wrongKind = yield* cli([
          "pause",
          "north-west/billing-group/sync-invoices",
        ]).pipe(Effect.flip);
        const limitedCli = ProcessManager.cli([{
          id: "@repo/Limited/BillingGroup",
          contract: {
            id: "@repo/Limited/BillingGroup",
            kind: "group",
            version: "v1",
            processes: [
              {
                id: "@repo/Limited/BillingGroup/SyncInvoices",
                kind: "process",
                controls: ["status"],
              },
            ],
            queues: [
              {
                id: "@repo/Limited/BillingGroup/BillingEmailQueue",
                kind: "queue",
                controls: ["status"],
              },
            ],
          },
        }] as const);
        const unsupportedProcessControl = yield* limitedCli([
          "now",
          "limited/billing-group/sync-invoices",
        ]).pipe(Effect.flip);
        const unsupportedQueueControl = yield* limitedCli([
          "pause",
          "limited/billing-group/billing-email-queue",
        ]).pipe(Effect.flip);
        const ambiguous = yield* cli([
          "now",
          "sync-invoices",
        ]).pipe(Effect.flip);

        expect(yield* Ref.get(northRuns)).toBe(1);
        expect(yield* Ref.get(southRuns)).toBe(0);
        expect(wrongKind._tag).toBe("ProcessManagerConnectionError");
        if (wrongKind._tag === "ProcessManagerConnectionError") {
          expect(wrongKind.reason).toContain("is a process, not a queue");
        }
        expect(unsupportedProcessControl._tag).toBe("ProcessManagerConnectionError");
        if (unsupportedProcessControl._tag === "ProcessManagerConnectionError") {
          expect(unsupportedProcessControl.reason).toContain("does not expose 'runImmediately'");
          expect(unsupportedProcessControl.reason).toContain("Available controls: status");
        }
        expect(unsupportedQueueControl._tag).toBe("ProcessManagerConnectionError");
        if (unsupportedQueueControl._tag === "ProcessManagerConnectionError") {
          expect(unsupportedQueueControl.reason).toContain("does not expose 'pause'");
          expect(unsupportedQueueControl.reason).toContain("Available controls: status");
        }
        expect(ambiguous._tag).toBe("ProcessManagerConnectionError");
        if (ambiguous._tag === "ProcessManagerConnectionError") {
          expect(ambiguous.reason).toContain("Ambiguous target");
          expect(ambiguous.reason).toContain("[north-west/billing-group/sync-invoices]");
          expect(ambiguous.reason).toContain("@repo/NorthWest/BillingGroup/SyncInvoices");
        }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mergeAll(
              NorthGroup.layer.pipe(
                Layer.provide(Layer.mergeAll(NorthQueue.layer, NorthSync.layer)),
              ),
              SouthGroup.layer.pipe(
                Layer.provide(Layer.mergeAll(SouthQueue.layer, SouthSync.layer)),
              ),
              ProcessStore.layer,
              NodeServices.layer,
              ProcessManager.ConnectionRegistry.layer([NorthGroup, SouthGroup] as const, {
                [NorthGroup.id]: "http://127.0.0.1:32138",
                [SouthGroup.id]: "http://127.0.0.1:32139",
              }),
            ),
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("reads remote queue status by typed queue id", () =>
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
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  EmailQueue.layer,
                  SyncProcess.layer,
                  ProcessStore.layer,
                ),
              ),
            ),
            EmailQueue.layer,
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("provides a remote manager as an endpoint service", () =>
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

      /**
       * @effect-expect-leaking HttpClient.HttpClient
       */
      class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
        BillingGroup,
      ) {}

      const billingRegistryLive = ProcessManager.ConnectionRegistry.layer(
        [BillingGroup] as const,
        {
          [BillingGroup.id]: "http://127.0.0.1:32129",
        },
      );

      const billingEndpointProvisionedLive = BillingEndpoint.layer.pipe(
        Layer.provide(billingRegistryLive),
      );

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
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  EmailQueue.layer,
                  SyncProcess.layer,
                  ProcessStore.layer,
                  billingEndpointProvisionedLive,
                ),
              ),
            ),
            billingEndpointProvisionedLive,
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("fails contract verification when remote process entries drift", () =>
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
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  EmailQueue.layer,
                  SyncProcess.layer,
                  ProcessStore.layer,
                ),
              ),
            ),
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("fails remote group controls when the endpoint contract drifts", () =>
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

      /**
       * @effect-expect-leaking HttpClient.HttpClient
       */
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
          Effect.provide(
            ProcessGroup.remoteLayer(StaleGroup, StaleEndpoint).pipe(
              Layer.provide(StaleEndpoint.layer),
              Layer.provide(NodeHttpClient.layerUndici),
            ),
          ),
        );

        const error = yield* remoteProgram;

        expect(error._tag).toBe("ProcessGroupRemoteControlError");
        if ("reason" in error) {
          expect(error.reason).toContain("Remote queue ids");
        } else {
          throw new Error(`Unexpected error: ${String(error)}`);
        }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            LocalGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(EmailQueue.layer, SyncProcess.layer, ProcessStore.layer),
              ),
            ),
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("provides typed remote group controls through ProcessGroup.remoteLayer", () =>
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

      /**
       * @effect-expect-leaking HttpClient.HttpClient
       */
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
        }).pipe(
          Effect.provide(
            ProcessGroup.remoteLayer(BillingGroup, BillingEndpoint).pipe(
              Layer.provide(BillingEndpoint.layer),
              Layer.provide(NodeHttpClient.layerUndici),
            ),
          ),
        );

        yield* remoteProgram;
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(EmailQueue.layer, SyncProcess.layer, ProcessStore.layer),
              ),
            ),
            EmailQueue.layer,
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );
});
