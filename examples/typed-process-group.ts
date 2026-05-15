/**
 * @module examples/typed-process-group
 *
 * ## Typed ProcessGroup declarations
 *
 * This example shows the new canonical-id group style:
 *
 * - `Process.define("@id", config)` gives a process entry with one canonical id.
 * - `QueueResource.define("@id", config)` gives a queue entry with one canonical id.
 * - `ProcessGroup.define("@id", [entries] as const)` gives a typed group whose
 *   controls accept the process/queue declarations, not secondary string ids.
 * - `ProcessGroup.Service` adds the same group as an injectable singleton.
 * - `ControlService` can expose the group's schema-backed contract at
 *   `GET /contract`.
 *
 * Run:
 *
 * ```bash
 * pnpm run example:typed-process-group
 * ```
 */

import { Duration, Effect, Ref, Schema } from "effect";
import {
  ControlService,
  Process,
  ProcessGroup,
  ProcessGroupContractSchema,
  QueueResource,
} from "../src";
import { provideLayer } from "../src/provideLayer.js";

interface EmailJob {
  readonly to: string;
  readonly subject: string;
}

interface InvoiceJob {
  readonly invoiceId: string;
}

const responseBodyJson = Schema.fromJsonString(Schema.Unknown);

const appendChunk = (data: string, chunk: unknown): string => {
  if (typeof chunk === "string") {
    return data + chunk;
  }
  if (chunk instanceof Uint8Array) {
    return data + new TextDecoder().decode(chunk);
  }
  return data;
};

const requestJson = (
  port: number,
  path: string,
): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    const nodeHttp: typeof import("node:http") = yield* Effect.promise(() =>
      import("node:http"),
    );
    const text = yield* Effect.callback<string>((resume) => {
      const req = nodeHttp.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "GET",
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: unknown) => {
            body = appendChunk(body, chunk);
          });
          res.on("end", () => resume(Effect.succeed(body)));
        },
      );
      req.on("error", (error) => resume(Effect.succeed(String(error))));
      req.end();
    });
    return yield* Schema.decodeUnknownEffect(responseBodyJson)(text).pipe(
      Effect.orDie,
    );
  });

const waitForCompleted = (
  queue: { readonly completed: Effect.Effect<number> },
  expected: number,
) =>
  Effect.gen(function* () {
    while ((yield* queue.completed) < expected) {
      yield* Effect.sleep(Duration.millis(5));
    }
  });

const directGroupDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── Direct typed ProcessGroup.define(...).make ──");

  const sentEmails = yield* Ref.make<ReadonlyArray<string>>([]);
  const syncedInvoices = yield* Ref.make<ReadonlyArray<string>>([]);

  const EmailQueue = QueueResource.define("@examples/EmailQueue", {
    effect: (email: EmailJob) =>
      Ref.update(sentEmails, (emails) => [...emails, email.to]),
    concurrency: 1,
  });

  const InvoiceQueue = QueueResource.define("@examples/InvoiceQueue", {
    effect: (invoice: InvoiceJob) =>
      Ref.update(syncedInvoices, (invoices) => [...invoices, invoice.invoiceId]),
    concurrency: 1,
  });

  const SyncBilling = Process.define("@examples/SyncBilling", {
    effect: Effect.gen(function* () {
      const emailQueue = yield* EmailQueue;
      const invoiceQueue = yield* InvoiceQueue;

      yield* emailQueue.add({
        to: "ops@example.com",
        subject: "billing sync finished",
      });
      yield* invoiceQueue.add({ invoiceId: "inv_001" });
    }),
  });

  const BillingGroup = ProcessGroup.define("@examples/BillingGroup", [
    SyncBilling,
    EmailQueue,
    InvoiceQueue,
  ] as const);

  yield* Effect.gen(function* () {
    const group = yield* BillingGroup.make;

    yield* group.runImmediately(SyncBilling);

    const emailQueue = yield* EmailQueue;
    const invoiceQueue = yield* InvoiceQueue;
    yield* waitForCompleted(emailQueue, 1);
    yield* waitForCompleted(invoiceQueue, 1);

    const emailStatus = yield* group.queue(EmailQueue).status;
    const invoiceStatus = yield* group.queue(InvoiceQueue).status;

    yield* Effect.logInfo(`group id: ${group.id}`);
    yield* Effect.logInfo(
      `contract processes: ${BillingGroup.contract.processes.map((p) => p.id).join(", ")}`,
    );
    yield* Effect.logInfo(
      `contract queues: ${BillingGroup.contract.queues.map((q) => q.id).join(", ")}`,
    );
    yield* Effect.logInfo(
      `email completed=${String(emailStatus.completed)}, invoice completed=${String(invoiceStatus.completed)}`,
    );
    yield* Effect.logInfo(
      `sent emails=${(yield* Ref.get(sentEmails)).join(", ")}`,
    );
    yield* Effect.logInfo(
      `synced invoices=${(yield* Ref.get(syncedInvoices)).join(", ")}`,
    );
  }).pipe(
    provideLayer(EmailQueue.layer),
    provideLayer(InvoiceQueue.layer),
  );
});

const serviceGroupDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── Injectable ProcessGroup.Service ──");

  const sentEmails = yield* Ref.make<ReadonlyArray<string>>([]);

  const EmailQueue = QueueResource.define("@examples/ServiceEmailQueue", {
    effect: (email: EmailJob) =>
      Ref.update(sentEmails, (emails) => [...emails, email.to]),
    concurrency: 1,
  });

  const NotifyOps = Process.define("@examples/NotifyOps", {
    effect: Effect.gen(function* () {
      const emailQueue = yield* EmailQueue;
      yield* emailQueue.add({
        to: "team@example.com",
        subject: "service group process ran",
      });
    }),
  });

  class OpsGroup extends ProcessGroup.Service<OpsGroup>()(
    "@examples/OpsGroup",
    [NotifyOps, EmailQueue] as const,
  ) {}

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
  }).pipe(
    provideLayer(OpsGroup.layer),
    provideLayer(EmailQueue.layer),
  );
});

const controlContractDemo = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.logInfo("── ControlService GET /contract ──");

    const EmailQueue = QueueResource.define("@examples/ContractEmailQueue", {
      effect: (_email: EmailJob) => Effect.void,
    });

    const ContractProcess = Process.define("@examples/ContractProcess", {
      effect: Effect.void,
    });

    const ContractGroup = ProcessGroup.define("@examples/ContractGroup", [
      ContractProcess,
      EmailQueue,
    ] as const);

    yield* Effect.gen(function* () {
      const group = yield* ContractGroup.make;

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
      yield* Effect.logInfo(
        `contract route queue ids: ${contract.queues.map((q) => q.id).join(", ")}`,
      );
    }).pipe(provideLayer(EmailQueue.layer));
  }),
);

const program = Effect.gen(function* () {
  yield* directGroupDemo;
  yield* serviceGroupDemo;
  yield* controlContractDemo;
});

void Effect.runPromise(
  program.pipe(
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("example:typed-process-group finished OK")),
  ),
);
