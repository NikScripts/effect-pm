/**
 * @module examples/forms/process-group/process-manager-connection-registry
 *
 * ProcessManager.ConnectionRegistry.layer + registry-backed ProcessManager.connect.
 * Run: `pnpm run example:form:process-manager-connection-registry`
 */

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Ref } from "effect";
import {
  ControlService,
  Process,
  ProcessGroup,
  ProcessManager,
  ProcessStore,
  QueueResource,
} from "../../../src";
import { provideLayer } from "../../../src/provideLayer";

interface EmailJob {
  readonly to: string;
}

const program = Effect.scoped(
  Effect.gen(function* () {
    const runs = yield* Ref.make(0);

    class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, void>()(
      "@examples/RegistryEmailQueue",
      {
        effect: (_email) => Effect.void,
      },
    ) {}

    class SyncProcess extends Process.Service<SyncProcess>()(
      "@examples/RegistrySyncProcess",
      {
        effect: Ref.update(runs, (count) => count + 1),
      },
    ) {}

    class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
      "@examples/RegistryBillingGroup",
      [SyncProcess, EmailQueue] as const,
    ) {}

    const RemoteGroupsLive = ProcessManager.ConnectionRegistry.layer(
      [BillingGroup] as const,
      {
        [BillingGroup.id]: "http://127.0.0.1:32137",
      },
    );

    yield* Effect.gen(function* () {
      const group = yield* BillingGroup;

      yield* ControlService.make({
        port: 32137,
        group,
      });

      const remoteProgram = Effect.gen(function* () {
        const manager = yield* ProcessManager.connect(BillingGroup);

        yield* manager.verifyContract;
        yield* manager.process(SyncProcess.id).runImmediately;

        const status = yield* manager.status;
        yield* Effect.logInfo(`registry group id: ${BillingGroup.id}`);
        yield* Effect.logInfo(`registry status success: ${String(status.success)}`);
        yield* Effect.logInfo(`registry process runs: ${String(yield* Ref.get(runs))}`);
      }).pipe(
        provideLayer(RemoteGroupsLive),
        provideLayer(NodeHttpClient.layerUndici),
      );

      yield* remoteProgram;
    }).pipe(
      provideLayer(BillingGroup.layer),
      provideLayer(EmailQueue.layer),
      provideLayer(ProcessStore.layer),
    );
  }),
);

void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("form:process-manager-connection-registry finished OK")),
  ),
);
