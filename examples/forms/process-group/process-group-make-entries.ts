/**
 * @module examples/forms/process-group/process-group-make-entries
 *
 * ProcessGroup.make(id, entries). Run: `pnpm run example:form:process-group-make-entries`
 */

import { Effect, Layer, Ref } from "effect";
import { Process, ProcessGroup, QueueResource } from "../../../src";
import { waitForCompleted } from "../../shared/process-group-http";
import { provideLayer } from "../../../src/provideLayer";

interface EmailJob {
  readonly to: string;
  readonly subject: string;
}

interface InvoiceJob {
  readonly invoiceId: string;
}

const program = Effect.gen(function* () {
    const sentEmails = yield* Ref.make<ReadonlyArray<string>>([]);
    const syncedInvoices = yield* Ref.make<ReadonlyArray<string>>([]);

    class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, void>()("@examples/EmailQueue", {
      effect: (email: EmailJob) =>
        Ref.update(sentEmails, (emails) => [...emails, email.to]),
      concurrency: 1,
    }) {}

    class InvoiceQueue extends QueueResource.Service<InvoiceQueue, InvoiceJob, void>()("@examples/InvoiceQueue", {
      effect: (invoice: InvoiceJob) =>
        Ref.update(syncedInvoices, (invoices) => [...invoices, invoice.invoiceId]),
      concurrency: 1,
    }) {}

    class SyncBilling extends Process.Service<SyncBilling>()("@examples/SyncBilling", {
      effect: Effect.gen(function* () {
        const emailQueue = yield* EmailQueue;
        const invoiceQueue = yield* InvoiceQueue;

        yield* emailQueue.add({
          to: "ops@example.com",
          subject: "billing sync finished",
        });
        yield* invoiceQueue.add({ invoiceId: "inv_001" });
      }),
    }) {}

    return yield* Effect.gen(function* () {
      const group = yield* ProcessGroup.make("@examples/BillingGroup", [
        SyncBilling,
        EmailQueue,
        InvoiceQueue,
      ] as const);

      yield* group.runImmediately(SyncBilling);

      const emailQueue = yield* EmailQueue;
      const invoiceQueue = yield* InvoiceQueue;
      yield* waitForCompleted(emailQueue, 1);
      yield* waitForCompleted(invoiceQueue, 1);

      const emailStatus = yield* group.queue(EmailQueue).status;
      const invoiceStatus = yield* group.queue(InvoiceQueue).status;

      yield* Effect.logInfo(`group id: ${group.id}`);
      yield* Effect.logInfo(
        `contract processes: ${group.contract.processes.map((p) => p.id).join(", ")}`,
      );
      yield* Effect.logInfo(
        `email completed=${String(emailStatus.completed)}, invoice completed=${String(invoiceStatus.completed)}`,
      );
      yield* Effect.logInfo(`sent emails=${(yield* Ref.get(sentEmails)).join(", ")}`);
      yield* Effect.logInfo(
        `synced invoices=${(yield* Ref.get(syncedInvoices)).join(", ")}`,
      );
    }).pipe(provideLayer(Layer.mergeAll(EmailQueue.layer, InvoiceQueue.layer)));
  }).pipe(Effect.scoped);

void Effect.runPromise(
  program.pipe(Effect.tap(() =>
    Effect.logInfo("form:process-group-make-entries finished OK"))),
);
