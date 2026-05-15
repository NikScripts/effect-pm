import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Ref, Schema } from "effect";
import {
  Process,
  ProcessGroup,
  ProcessGroupContractSchema,
  QueueResource,
} from "../src";
import { provideLayer } from "../src/provideLayer.js";

interface Email {
  readonly to: string;
}

interface InvoiceJob {
  readonly invoiceId: string;
}

class TypeEmailQueue extends QueueResource.Service<TypeEmailQueue, Email, void>()("@test/TypeEmailQueue", {
  effect: (_email: Email) => Effect.void,
}) {}

class TypeInvoiceQueue extends QueueResource.Service<TypeInvoiceQueue, InvoiceJob, void>()("@test/TypeInvoiceQueue", {
  effect: (_job: InvoiceJob) => Effect.void,
}) {}

class TypeProcess extends Process.Service<TypeProcess>()("@test/TypeProcess", {
  effect: Effect.void,
}) {}

class TypeGroup extends ProcessGroup.Service<TypeGroup>()("@test/TypeGroup", [
  TypeProcess,
  TypeEmailQueue,
  TypeInvoiceQueue,
] as const) {}

export const processGroupTypeChecks = Effect.gen(function* () {
  const group = yield* TypeGroup.make;
  const acceptProcessId = (
    _id: typeof TypeGroup.contract.processes[number]["id"],
  ) => Effect.void;
  const acceptQueueId = (
    _id: typeof TypeGroup.contract.queues[number]["id"],
  ) => Effect.void;

  yield* group.start(TypeProcess);
  yield* group.queue(TypeEmailQueue).enqueue({ to: "ops@example.com" });
  yield* group.queue(TypeInvoiceQueue).enqueue({ invoiceId: "inv_123" });
  yield* acceptProcessId(TypeProcess.id);
  yield* acceptQueueId(TypeEmailQueue.id);
  yield* acceptQueueId(TypeInvoiceQueue.id);

  if (false) {
    // @ts-expect-error queues are not valid process lifecycle targets
    yield* group.start(TypeEmailQueue);

    // @ts-expect-error process entries are not valid queue targets
    yield* group.queue(TypeProcess);

    // @ts-expect-error invoice jobs cannot be enqueued into the email queue
    yield* group.queue(TypeEmailQueue).enqueue({ invoiceId: "inv_123" });

    // @ts-expect-error queue IDs are not valid process contract IDs
    yield* acceptProcessId(TypeEmailQueue.id);

    // @ts-expect-error process IDs are not valid queue contract IDs
    yield* acceptQueueId(TypeProcess.id);
  }
});

const waitForCompleted = (
  queue: { readonly completed: Effect.Effect<number, never, never> },
  expected: number,
) =>
  Effect.gen(function* () {
    while ((yield* queue.completed) < expected) {
      yield* Effect.sleep(Duration.millis(5));
    }
  });

describe("ProcessGroup.make", () => {
  it.live("creates direct typed controls from one canonical entry tuple", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make<ReadonlyArray<string>>([]);
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()("@test/TypedDirectEmailQueue", {
        effect: (email: Email) =>
          Ref.update(handled, (values) => [...values, email.to]),
        concurrency: 1,
      }) {}

      class SyncProcess extends Process.Service<SyncProcess>()("@test/TypedDirectSyncProcess", {
        effect: Ref.update(runs, (count) => count + 1),
      }) {}

      yield* Effect.gen(function* () {
        const group = yield* ProcessGroup.make("@test/TypedDirectBillingGroup", [
          SyncProcess,
          EmailQueue,
        ] as const);

        expect(group.id).toBe("@test/TypedDirectBillingGroup");
        expect(group.contract).toEqual({
          id: "@test/TypedDirectBillingGroup",
          kind: "group",
          version: "v1",
          processes: [
            {
              id: SyncProcess.id,
              kind: "process",
              controls: ["start", "stop", "restart", "runImmediately", "status"],
            },
          ],
          queues: [
            {
              id: EmailQueue.id,
              kind: "queue",
              controls: ["enqueue", "pause", "resume", "clear", "status"],
            },
          ],
        });
        expect(
          Schema.decodeUnknownSync(ProcessGroupContractSchema)(
            group.contract,
          ),
        ).toEqual(group.contract);
        expect(() =>
          Schema.decodeUnknownSync(ProcessGroupContractSchema)({
            ...group.contract,
            queues: [
              {
                id: EmailQueue.id,
                kind: "queue",
                controls: ["not-a-control"],
              },
            ],
          }),
        ).toThrow();

        yield* group.queue(EmailQueue).enqueue({ to: "ops@example.com" });
        const queue = yield* EmailQueue;
        yield* waitForCompleted(queue, 1);

        yield* group.runImmediately(SyncProcess);

        expect(yield* Ref.get(handled)).toEqual(["ops@example.com"]);
        expect(yield* Ref.get(runs)).toBe(1);

        const queueStatus = yield* group.queue(EmailQueue).status;
        expect(queueStatus.name).toBe(EmailQueue.id);
        expect(queueStatus.completed).toBe(1);
      }).pipe(provideLayer(EmailQueue.layer));
    }),
  );

  it.live("supports an injectable group service for singleton control surfaces", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make<ReadonlyArray<string>>([]);
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()("@test/TypedServiceEmailQueue", {
        effect: (email: Email) =>
          Ref.update(handled, (values) => [...values, email.to]),
        concurrency: 1,
      }) {}

      class SyncProcess extends Process.Service<SyncProcess>()("@test/TypedServiceSyncProcess", {
        effect: Ref.update(runs, (count) => count + 1),
      }) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/TypedServiceBillingGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;

        expect(BillingGroup.contract.id).toBe("@test/TypedServiceBillingGroup");
        expect(group.contract).toEqual(BillingGroup.contract);

        yield* group.process(SyncProcess).runImmediately;
        yield* group.queue(EmailQueue).enqueue({ to: "team@example.com" });

        const queue = yield* EmailQueue;
        yield* waitForCompleted(queue, 1);

        expect(group.id).toBe("@test/TypedServiceBillingGroup");
        expect(yield* Ref.get(runs)).toBe(1);
        expect(yield* Ref.get(handled)).toEqual(["team@example.com"]);
      }).pipe(
        provideLayer(BillingGroup.layer),
        provideLayer(EmailQueue.layer),
      );
    }),
  );
});
