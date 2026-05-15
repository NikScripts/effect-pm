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

        class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
          "@test/ManagerBillingGroup",
          [SyncProcess, EmailQueue] as const,
        ) {}

        yield* Effect.gen(function* () {
          const group = yield* BillingGroup;
          const manager = ProcessManager.connect({
            baseUrl: "http://127.0.0.1:32126",
            contract: BillingGroup.contract,
          });

          yield* ControlService.make({
            port: 32126,
            group,
          });

          yield* manager.verifyContract;
          yield* manager.process(SyncProcess.id).runImmediately;

          // @ts-expect-error queue ids are not valid process ids
          manager.process(EmailQueue.id);

          expect(yield* Ref.get(runs)).toBe(1);
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
          const manager = ProcessManager.connect({
            baseUrl: "http://127.0.0.1:32127",
            contract: BillingGroup.contract,
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
});
