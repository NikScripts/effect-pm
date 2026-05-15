/**
 * @module examples/forms/process-group/process-manager-endpoint-service
 *
 * ProcessManager.Endpoint as an injectable service.
 * Run: `pnpm run example:form:process-manager-endpoint-service`
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
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    const runs = yield* Ref.make(0);

    class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, void>()(
      "@examples/EndpointEmailQueue",
      {
        effect: (email) =>
          Ref.update(sent, (emails) => [...emails, email.to]),
      },
    ) {}

    class SyncProcess extends Process.Service<SyncProcess>()(
      "@examples/EndpointSyncProcess",
      {
        effect: Ref.update(runs, (count) => count + 1),
      },
    ) {}

    class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
      "@examples/EndpointBillingGroup",
      [SyncProcess, EmailQueue] as const,
    ) {}

    class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
      BillingGroup,
      {
        baseUrl: "http://127.0.0.1:32130",
      },
    ) {}

    yield* Effect.gen(function* () {
      const group = yield* BillingGroup;
      const manager = yield* BillingEndpoint;

      yield* ControlService.make({
        port: 32130,
        group,
      });

      yield* manager.verifyContract;
      yield* manager.process(SyncProcess.id).runImmediately;

      const remoteGroupProgram = Effect.gen(function* () {
        const remoteBilling = yield* BillingGroup;

        yield* remoteBilling.process(SyncProcess).runImmediately;
        yield* remoteBilling.queue(EmailQueue).pause;
        yield* remoteBilling.queue(EmailQueue).resume;
      }).pipe(
        provideLayer(ProcessGroup.remoteLayer(BillingGroup, BillingEndpoint)),
        provideLayer(BillingEndpoint.layer),
        provideLayer(NodeHttpClient.layerUndici),
      );

      yield* remoteGroupProgram;

      const status = yield* manager.status;
      yield* Effect.logInfo(`endpoint contract id: ${BillingEndpoint.contract.id}`);
      yield* Effect.logInfo(`remote process runs: ${String(yield* Ref.get(runs))}`);
      yield* Effect.logInfo(`remote status success: ${String(status.success)}`);
    }).pipe(
      provideLayer(BillingGroup.layer),
      provideLayer(BillingEndpoint.layer),
      provideLayer(EmailQueue.layer),
      provideLayer(ProcessStore.layer),
      provideLayer(NodeHttpClient.layerUndici),
    );
  }),
);

void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("form:process-manager-endpoint-service finished OK")),
  ),
);
