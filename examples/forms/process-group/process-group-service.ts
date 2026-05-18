/**
 * @module examples/forms/process-group/process-group-service
 *
 * ProcessGroup.Service injectable style. Run: `pnpm run example:form:process-group-service`
 */

import { Effect, Layer, Ref } from "effect";
import { Process, ProcessGroup, QueueResource } from "../../../src";
import { waitForCompleted } from "../../shared/process-group-http";

interface EmailJob {
  readonly to: string;
  readonly subject: string;
}

const program = Effect.scoped(
  Effect.gen(function* () {
    const sentEmails = yield* Ref.make<ReadonlyArray<string>>([]);

    class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, never>()("@examples/ServiceEmailQueue", {
      effect: (email: EmailJob) =>
        Ref.update(sentEmails, (emails) => [...emails, email.to]),
      concurrency: 1,
    }) {}

    class NotifyOps extends Process.Service<NotifyOps>()("@examples/NotifyOps", {
      effect: Effect.gen(function* () {
        const emailQueue = yield* EmailQueue;
        yield* emailQueue.add({
          to: "team@example.com",
          subject: "service group process ran",
        });
      }),
    }) {}

    class OpsGroup extends ProcessGroup.Service<OpsGroup>()(
      "@examples/OpsGroup",
      [NotifyOps, EmailQueue] as const,
    ) {}

    const envLayer = Layer.mergeAll(
      OpsGroup.layer.pipe(
        Layer.provide(Layer.mergeAll(NotifyOps.layer, EmailQueue.layer)),
      ),
      EmailQueue.layer,
    );

    yield* Effect.gen(function* () {
      const group = yield* OpsGroup;

      yield* group.process(NotifyOps).runImmediately;

      const emailQueue = yield* EmailQueue;
      yield* waitForCompleted(emailQueue, 1);

      yield* Effect.logInfo(`service group id: ${group.id}`);
      yield* Effect.logInfo(
        `service group contract queues: ${group.contract.queues.map((q) => q.id).join(", ")}`,
      );
      yield* Effect.logInfo(
        `service group sent emails=${(yield* Ref.get(sentEmails)).join(", ")}`,
      );
    }).pipe(Effect.provide(envLayer));
  }),
);

void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("form:process-group-service finished OK")),
  ),
);
