/**
 * @module examples/forms/process-group/process-group-contract-http
 *
 * GET /contract + ProcessManager.connect. Run: `pnpm run example:form:process-group-contract-http`
 */

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Schema } from "effect";
import {
  ControlService,
  Process,
  ProcessGroup,
  ProcessGroupContractSchema,
  ProcessManager,
  ProcessStore,
  QueueResource,
} from "../../../src";
import { requestJson } from "../../shared/process-group-http";
import { provideLayer } from "../../../src/provideLayer";

interface EmailJob {
  readonly to: string;
  readonly subject: string;
}

const program = Effect.scoped(
  Effect.gen(function* () {
    class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, void>()("@examples/ContractEmailQueue", {
      effect: (_email: EmailJob) => Effect.void,
    }) {}

    class ContractProcess extends Process.Service<ContractProcess>()("@examples/ContractProcess", {
      effect: Effect.void,
    }) {}

    yield* Effect.gen(function* () {
      const group = yield* ProcessGroup.make("@examples/ContractGroup", [
        ContractProcess,
        EmailQueue,
      ] as const);

      yield* ControlService.make({
        port: 32125,
        group,
      });

      const rawContract = yield* requestJson(32125, "/contract");
      const contract = yield* Schema.decodeUnknownEffect(
        ProcessGroupContractSchema,
      )(rawContract);

      yield* Effect.logInfo(`contract route group id: ${contract.id}`);
      yield* Effect.logInfo(
        `contract route process ids: ${contract.processes.map((p) => p.id).join(", ")}`,
      );

      // Remote client validates contract then calls typed process controls over HTTP.
      const manager = ProcessManager.connect({
        baseUrl: "http://127.0.0.1:32125",
        contract: group.contract,
      });

      yield* manager.verifyContract;
      yield* manager.process(ContractProcess.id).runImmediately;

      const remoteStatus = yield* manager.status;
      yield* Effect.logInfo(
        `remote manager status success: ${String(remoteStatus.success)}`,
      );
    }).pipe(
      provideLayer(EmailQueue.layer),
      provideLayer(ProcessStore.layer),
      provideLayer(NodeHttpClient.layerUndici),
    );
  }),
);

void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("form:process-group-contract-http finished OK")),
  ),
);
