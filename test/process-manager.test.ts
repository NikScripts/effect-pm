import { describe, expect, it } from "@effect/vitest";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Config, ConfigProvider, Effect, FileSystem, Layer, Ref } from "effect";
import {
  ControlRouter,
  ControlService,
  ControlTransportClient,
  Endpoint,
  makeControlProtocolResponseEnvelope,
  makeControlProtocolRouter,
  Process,
  ProcessGroup,
  ProcessManager,
  ProcessManagerEndpointConfigError,
  ProcessStore,
  QueueResource,
} from "../src";
import { ModuleEndpointGroup } from "./fixtures/process-manager-module-definition";

const testLocalEntry = "file:///test-process-group-entry.ts";
const moduleFixtureEntry = pathToFileURL(
  join(process.cwd(), "test/fixtures/process-manager-module-definition.ts"),
).href;
const groupChildScript = join(process.cwd(), "src/bin/effect-pm-group-child.ts");


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

const readRunStatePid = (text: string): number => {
  const value: unknown = JSON.parse(text);
  if (
    typeof value === "object" &&
    value !== null &&
    "pid" in value &&
    typeof value.pid === "number"
  ) {
    return value.pid;
  }
  throw new Error("run state did not include a numeric pid");
};

describe("ProcessManager", () => {
  it("builds endpoint config items from the direct Endpoint export", () => {
    const transport = ProcessManager.Transport.http("http://127.0.0.1:32130");
    const local = Endpoint.local(transport, testLocalEntry).default;
    const production = ProcessManager.Endpoint.production(transport);
    const preview = Endpoint.define("preview", transport);

    expect(Endpoint).toBe(ProcessManager.Endpoint);
    expect(local.endpoint).toEqual({
      _tag: "ProcessManagerChildEndpoint",
      entry: testLocalEntry,
      transport: {
        _tag: "ProcessManagerHttpTransport",
        baseUrl: "http://127.0.0.1:32130",
      },
    });
    expect(production.endpoint).toEqual({
      _tag: "ProcessManagerHttpEndpoint",
      transport: {
        _tag: "ProcessManagerHttpTransport",
        baseUrl: "http://127.0.0.1:32130",
      },
    });
    expect(local).toMatchObject({
      _tag: "ProcessManagerEndpointConfigItem",
      label: "local",
      isDefault: true,
    });
    expect(production).toMatchObject({
      _tag: "ProcessManagerEndpointConfigItem",
      label: "production",
      isDefault: false,
    });
    expect(preview).toMatchObject({
      _tag: "ProcessManagerEndpointConfigItem",
      label: "preview",
      isDefault: false,
    });
  });

  it.effect("surfaces module selector failures as checked endpoint config errors", () =>
    Effect.gen(function* () {
      const endpoint = Endpoint.runner(
        () => Promise.resolve({}),
        () => {
          throw new Error("bad selector");
        },
      );

      const error = yield* endpoint.select({}).pipe(
        Effect.flip,
      );

      expect(error).toBeInstanceOf(ProcessManagerEndpointConfigError);
      expect(error.reason).toContain("bad selector");
    }),
  );

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
            request: (envelope) =>
              Effect.flatMap(
                router.handle(envelope.request),
                (response) => makeControlProtocolResponseEnvelope(envelope, response),
              ),
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
          request: (envelope) =>
            Effect.flatMap(
              router.handle(envelope.request),
              (response) => makeControlProtocolResponseEnvelope(envelope, response),
            ),
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

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
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

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
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

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
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

      class NorthQueue extends QueueResource.Service<NorthQueue, Email, never>()(
        "@repo/NorthWest/BillingGroup/BillingEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SouthQueue extends QueueResource.Service<SouthQueue, Email, never>()(
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
          "queue-start",
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

  it.live("runs CLI controls through group-bundled endpoint config targets", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/ConfiguredCliEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/ConfiguredCliSyncProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      const localTransport = ProcessManager.Transport.http("http://127.0.0.1:32141");
      const productionTransport = ProcessManager.Transport.http("http://127.0.0.1:32142");

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/ConfiguredCliBillingGroup",
        [SyncProcess, EmailQueue] as const,
        [
          Endpoint.local(localTransport, testLocalEntry).default,
          ProcessManager.Endpoint.production(productionTransport),
        ],
      ) {}

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;
        const cli = ProcessManager.cli([BillingGroup] as const);

        yield* ControlService.make({
          port: 32141,
          group,
        });
        yield* ControlService.make({
          port: 32142,
          group,
        });

        yield* cli(["now", "configured-cli-sync-process"]);
        yield* cli([
          "now",
          "configured-cli-sync-process",
          "--target",
          "production",
        ]);
        yield* cli(["groups"]);
        yield* cli(["groups", "--target", "production"]);
        yield* cli(["verify", "--target", "production"]);

        expect(yield* Ref.get(runs)).toBe(2);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(Layer.mergeAll(EmailQueue.layer, SyncProcess.layer, ProcessStore.layer)),
            ),
            ProcessStore.layer,
            NodeServices.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.effect("validates endpoint config defaults", () =>
    Effect.gen(function* () {
      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/InvalidEndpointDefaultEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/InvalidEndpointDefaultProcess",
        {
          effect: Effect.void,
        },
      ) {}

      const transport = ProcessManager.Transport.http("http://127.0.0.1:32143");

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/InvalidEndpointDefaultGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      const error = yield* ProcessManager.GroupConfig(BillingGroup, [
        Endpoint.local(transport, testLocalEntry),
        Endpoint.production(transport),
      ]).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ProcessManagerEndpointConfigError);
      expect(error.reason).toContain("exactly one default endpoint");

      const duplicateLabel = yield* ProcessManager.GroupConfig(BillingGroup, [
        Endpoint.define("local", transport).default,
        Endpoint.define("local", transport),
      ]).pipe(Effect.flip);

      expect(duplicateLabel).toBeInstanceOf(ProcessManagerEndpointConfigError);
      expect(duplicateLabel.reason).toContain("duplicate endpoint label");
    }),
  );

  it.live("reports offline endpoint status without failing the groups command", () =>
    Effect.gen(function* () {
      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/OfflineEndpointStatusEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/OfflineEndpointStatusProcess",
        {
          effect: Effect.void,
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/OfflineEndpointStatusGroup",
        [SyncProcess, EmailQueue] as const,
        [
          Endpoint.local(ProcessManager.Transport.http("http://127.0.0.1:32999"), testLocalEntry).default,
        ],
      ) {}

      const cli = ProcessManager.cli([BillingGroup] as const);
      yield* cli(["groups"]);
    }).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
    ),
  );

  it.live("reports contract drift endpoint status without failing the groups command", () =>
    Effect.gen(function* () {
      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/DriftEndpointStatusEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class LocalProcess extends Process.Service<LocalProcess>()(
        "@test/DriftEndpointStatusLocalProcess",
        {
          effect: Effect.void,
        },
      ) {}

      class RemoteProcess extends Process.Service<RemoteProcess>()(
        "@test/DriftEndpointStatusRemoteProcess",
        {
          effect: Effect.void,
        },
      ) {}

      class LocalGroup extends ProcessGroup.Service<LocalGroup>()(
        "@test/DriftEndpointStatusGroup",
        [LocalProcess, EmailQueue] as const,
        [
          Endpoint.local(ProcessManager.Transport.http("http://127.0.0.1:32145"), testLocalEntry).default,
        ],
      ) {}

      class RemoteGroup extends ProcessGroup.Service<RemoteGroup>()(
        "@test/DriftEndpointStatusGroup",
        [RemoteProcess, EmailQueue] as const,
      ) {}

      yield* Effect.gen(function* () {
        const remoteGroup = yield* RemoteGroup;
        const cli = ProcessManager.cli([LocalGroup] as const);

        yield* ControlService.make({
          port: 32145,
          group: remoteGroup,
        });

        yield* cli(["groups"]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            RemoteGroup.layer.pipe(
              Layer.provide(Layer.mergeAll(EmailQueue.layer, RemoteProcess.layer, ProcessStore.layer)),
            ),
            ProcessStore.layer,
            NodeServices.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("uses explicit ProcessManager config layers as endpoint overrides", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/ConfigLayerEndpointEmailQueue",
        {
          effect: (_email) => Effect.void,
        },
      ) {}

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/ConfigLayerEndpointProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/ConfigLayerEndpointGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      const config = yield* ProcessManager.GroupConfig(BillingGroup, [
        Endpoint.local(ProcessManager.Transport.http("http://127.0.0.1:32144"), testLocalEntry).default,
      ]);

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;
        const cli = ProcessManager.cli([BillingGroup] as const);

        yield* ControlService.make({
          port: 32144,
          group,
        });

        yield* cli(["now", "config-layer-endpoint-process"]);

        expect(yield* Ref.get(runs)).toBe(1);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(Layer.mergeAll(EmailQueue.layer, SyncProcess.layer, ProcessStore.layer)),
            ),
            ProcessManager.Config.layer([config]),
            ProcessStore.layer,
            NodeServices.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("starts module endpoints out of process and writes run state", () =>
    Effect.gen(function* () {
      const runRoot = ".effect-pm-test";
      const runDirectory = `${runRoot}/run/groups`;
      const pidRef = yield* Ref.make<number | undefined>(undefined);
      const childLaunchLayer = ProcessManager.ChildLaunch.layerConfig({
        ...ProcessManager.ChildLaunch.defaultPaths(),
        scriptPath: groupChildScript,
        logDirectory: `${runRoot}/logs`,
        runDirectory,
      });
      const config = yield* ProcessManager.GroupConfig(ModuleEndpointGroup, [
        Endpoint.local(
          ProcessManager.Transport.http("http://127.0.0.1:32146"),
          moduleFixtureEntry,
        ).default,
      ]);
      const program = Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.remove(runRoot, { recursive: true, force: true });

        const cli = ProcessManager.cli([ModuleEndpointGroup] as const);
        yield* cli(["group-start", "module-endpoint-group"]);
        yield* cli(["status", "module-endpoint-process"]);
        yield* cli(["group-start", "module-endpoint-group"]);

        const stateText = yield* fs.readFileString(
          `${runDirectory}/test__module-endpoint-group.json`,
        );
        const pid = readRunStatePid(stateText);
        yield* Ref.set(pidRef, pid);
        expect(pid).toBeGreaterThan(0);
      });

      yield* Effect.scoped(
        program.pipe(
          Effect.provide(
            Layer.mergeAll(
              ProcessManager.Config.layer([config]),
              childLaunchLayer,
              NodeHttpClient.layerUndici,
              NodeServices.layer,
            ),
          ),
        ),
      );

      const pidAfterScope = yield* Ref.get(pidRef);
      expect(pidAfterScope).toBeDefined();
      if (pidAfterScope !== undefined) {
        yield* Effect.sync(() => {
          process.kill(pidAfterScope, 0);
        });
      }

      yield* Effect.scoped(
        ProcessManager.cli([ModuleEndpointGroup] as const)([
          "group-stop",
          "module-endpoint-group",
        ]).pipe(
          Effect.provide(
            Layer.mergeAll(
              ProcessManager.Config.layer([config]),
              childLaunchLayer,
              NodeHttpClient.layerUndici,
              NodeServices.layer,
            ),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const fsAfterStop = yield* FileSystem.FileSystem;
        const stateExistsAfterStop = yield* fsAfterStop.exists(
          `${runDirectory}/test__module-endpoint-group.json`,
        );
        expect(stateExistsAfterStop).toBe(false);

        const pid = yield* Ref.get(pidRef);
        if (pid !== undefined) {
          yield* Effect.sync(() => {
            try {
              process.kill(pid, "SIGTERM");
            } catch {
              // process may already have exited after group-stop
            }
          });
        }
        yield* fsAfterStop.remove(runRoot, { recursive: true, force: true }).pipe(
          Effect.catch(() => Effect.void),
        );
      }).pipe(
        Effect.provide(NodeServices.layer),
      );
    }),
  );

  it.live("cleans stale module endpoint run state on group-stop", () =>
    Effect.gen(function* () {
      const runDirectory = ".effect-pm/run/groups";
      const childLaunchLayer = ProcessManager.ChildLaunch.layerConfig({
        ...ProcessManager.ChildLaunch.defaultPaths(),
        scriptPath: groupChildScript,
      });
      const config = yield* ProcessManager.GroupConfig(ModuleEndpointGroup, [
        Endpoint.local(
          ProcessManager.Transport.http("http://127.0.0.1:32146"),
          moduleFixtureEntry,
        ).default,
      ]);
      const program = Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(runDirectory, { recursive: true });
        yield* fs.writeFileString(
          `${runDirectory}/test__module-endpoint-group.json`,
          [
            "{",
            "  \"args\": [],",
            "  \"command\": \"node\",",
            "  \"controlBaseUrl\": \"http://127.0.0.1:32146\",",
            "  \"endpointLabel\": \"local\",",
            "  \"groupId\": \"@test/ModuleEndpointGroup\",",
            "  \"logPaths\": {",
            "    \"stderr\": \".effect-pm/logs/test__module-endpoint-group.err.log\",",
            "    \"stdout\": \".effect-pm-stale-test/logs/test__module-endpoint-group.out.log\"",
            "  },",
            "  \"pid\": 999999,",
            "  \"startedAt\": \"2026-01-01T00:00:00.000Z\"",
            "}",
          ].join("\n"),
        );

        const cli = ProcessManager.cli([ModuleEndpointGroup] as const);
        yield* cli(["group-stop", "module-endpoint-group"]);
        expect(yield* fs.exists(`${runDirectory}/test__module-endpoint-group.json`)).toBe(false);
      });

      yield* program.pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            yield* fs.remove(".effect-pm/run/groups/test__module-endpoint-group.json", { force: true }).pipe(
              Effect.catch(() => Effect.void),
            );
          }),
        ),
        Effect.provide(
          Layer.mergeAll(
            ProcessManager.Config.layer([config]),
            childLaunchLayer,
            NodeHttpClient.layerUndici,
            NodeServices.layer,
          ),
        ),
      );
    }),
  );

  it.live("reads remote queue status by typed queue id", () =>
    Effect.gen(function* () {
      const delivered = yield* Ref.make<ReadonlyArray<string>>([]);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
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

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
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
      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
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
      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
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

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
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
