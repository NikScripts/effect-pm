/**
 * @module examples/forms/process-group/process-group-remote-contract-drift
 *
 * ProcessGroup.remoteLayer detects stale endpoint contracts as checked errors.
 * Run: `pnpm run example:form:process-group-remote-contract-drift`
 */

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect } from "effect";
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

const ensure = (
  condition: boolean,
  message: string,
): Effect.Effect<void> =>
  condition ? Effect.void : Effect.die(new Error(message));

const program = Effect.scoped(
  Effect.gen(function* () {
    class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, void>()(
      "@examples/DriftEmailQueue",
      {
        effect: (_email) => Effect.void,
      },
    ) {}

    class SyncProcess extends Process.Service<SyncProcess>()(
      "@examples/DriftSyncProcess",
      {
        effect: Effect.void,
      },
    ) {}

    class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
      "@examples/DriftBillingGroup",
      [SyncProcess, EmailQueue] as const,
    ) {}

    class StaleBillingGroup extends ProcessGroup.Service<StaleBillingGroup>()(
      "@examples/DriftBillingGroup",
      [SyncProcess] as const,
    ) {}

    class StaleBillingEndpoint extends ProcessManager.Endpoint<StaleBillingEndpoint>()(
      StaleBillingGroup,
      {
        baseUrl: "http://127.0.0.1:32135",
      },
    ) {}

    yield* Effect.gen(function* () {
      const localBilling = yield* BillingGroup;

      yield* ControlService.make({
        port: 32135,
        group: localBilling,
      });

      const remoteProgram = Effect.gen(function* () {
        const remoteBilling = yield* StaleBillingGroup;

        return yield* remoteBilling.status.pipe(Effect.flip);
      }).pipe(
        provideLayer(ProcessGroup.remoteLayer(
          StaleBillingGroup,
          StaleBillingEndpoint,
        )),
        provideLayer(StaleBillingEndpoint.layer),
        provideLayer(NodeHttpClient.layerUndici),
      );

      const error = yield* remoteProgram;

      yield* ensure(
        error._tag === "ProcessGroupRemoteControlError",
        "remote contract drift should surface as ProcessGroupRemoteControlError",
      );
      if (error._tag !== "ProcessGroupRemoteControlError") {
        return yield* Effect.void;
      }

      yield* ensure(
        error.reason.includes("Remote queue ids"),
        "remote contract drift should explain the mismatched queue ids",
      );

      yield* Effect.logInfo(`local group id: ${BillingGroup.id}`);
      yield* Effect.logInfo(`stale endpoint id: ${StaleBillingEndpoint.contract.id}`);
      yield* Effect.logInfo(`remote contract drift error: ${error.reason}`);
    }).pipe(
      provideLayer(BillingGroup.layer),
      provideLayer(EmailQueue.layer),
      provideLayer(ProcessStore.layer),
    );
  }),
);

void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("form:process-group-remote-contract-drift finished OK")),
  ),
);
