/**
 * @module examples/forms/process-group/process-group-remote-layer
 *
 * ProcessGroup.remoteLayer provides the same group service key remotely.
 * Run: `pnpm run example:form:process-group-remote-layer`
 */

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Layer, Ref } from "effect";
import {
  ControlService,
  Process,
  ProcessGroup,
  ProcessManager,
  ProcessStore,
  QueueResource,
} from "../../../src";
import { waitForCompleted } from "../../shared/process-group-http";

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
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    const runs = yield* Ref.make(0);

    class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, never>()(
      "@examples/RemoteLayerEmailQueue",
      {
        effect: (email) =>
          Ref.update(sent, (emails) => [...emails, email.to]),
        concurrency: 1,
        paused: true,
      },
    ) {}

    class SyncProcess extends Process.Service<SyncProcess>()(
      "@examples/RemoteLayerSyncProcess",
      {
        effect: Ref.update(runs, (count) => count + 1),
      },
    ) {}

    class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
      "@examples/RemoteLayerBillingGroup",
      [SyncProcess, EmailQueue] as const,
    ) {}

    /**
     * @effect-expect-leaking HttpClient.HttpClient
     */
    class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
      BillingGroup,
      {
        baseUrl: "http://127.0.0.1:32132",
      },
    ) {}

    yield* Effect.gen(function* () {
      const localGroup = yield* BillingGroup;
      const localQueue = yield* EmailQueue;

      yield* ControlService.make({
        port: 32132,
        group: localGroup,
      });

      const remoteProgram = Effect.gen(function* () {
        const remoteBilling = yield* BillingGroup;
        const remoteEmailQueue = remoteBilling.queue(EmailQueue);

        yield* remoteBilling.process(SyncProcess).runImmediately;
        yield* ensure((yield* Ref.get(runs)) === 1, "remote process did not run");

        yield* remoteEmailQueue.pause;
        yield* localQueue.add({ to: "clear-me@example.com" });

        const pendingBeforeClear = yield* remoteEmailQueue.status;
        yield* ensure(
          pendingBeforeClear.size.total === 1,
          "remote queue status did not report the pending job",
        );

        const cleared = yield* remoteEmailQueue.clear;
        yield* ensure(cleared === 1, "remote queue clear did not clear one job");

        const pendingAfterClear = yield* remoteEmailQueue.status;
        yield* ensure(
          pendingAfterClear.size.total === 0,
          "remote queue status did not report an empty queue after clear",
        );

        yield* localQueue.add([
          { to: "ops@example.com" },
          { to: "team@example.com" },
        ]);

        const pausedStatus = yield* remoteEmailQueue.status;
        yield* ensure(
          pausedStatus.size.total === 2,
          "remote queue pause did not leave jobs pending",
        );

        yield* remoteEmailQueue.resume;
        yield* waitForCompleted(localQueue, 2);

        const completedStatus = yield* remoteEmailQueue.status;
        yield* ensure(
          completedStatus.completed === 2,
          "remote queue resume did not process pending jobs",
        );
        const delivered = yield* Ref.get(sent);
        yield* ensure(
          delivered.length === 2,
          "remote queue resume did not deliver two jobs",
        );

        yield* remoteEmailQueue.pause;
        yield* remoteEmailQueue.resume;

        const enqueueError = yield* remoteEmailQueue
          .enqueue({ to: "unsupported@example.com" })
          .pipe(Effect.flip);
        if (enqueueError._tag !== "UnsupportedRemoteControlError") {
          return yield* Effect.die(
            new Error("remote queue enqueue should stay unsupported"),
          );
        }

        yield* Effect.logInfo(`remote group id: ${remoteBilling.id}`);
        yield* Effect.logInfo(`remote process runs: ${String(yield* Ref.get(runs))}`);
        yield* Effect.logInfo(`remote queue completed: ${String(completedStatus.completed)}`);
        yield* Effect.logInfo(
          `remote queue enqueue unsupported: ${enqueueError.reason}`,
        );
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
            Layer.provide(Layer.mergeAll(SyncProcess.layer, EmailQueue.layer)),
          ),
          EmailQueue.layer,
          ProcessStore.layer, // in-memory analytics; use layerProcessStore for durable lifecycle history
        ),
      ),
    );
  }),
);

void Effect.runPromise(
  program.pipe(Effect.tap(() =>
    Effect.logInfo("form:process-group-remote-layer finished OK")),
  ),
);
