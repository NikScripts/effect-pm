import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Layer, Ref, Schema } from "effect";
import type { HttpClient } from "effect/unstable/http";
import {
  Process,
  ProcessGroup,
  ProcessGroupControlError,
  ProcessGroupContractSchema,
  ProcessGroupErrors,
  ProcessManager,
  ProcessManagerConnectionRegistry,
  QueueResource,
  UnsupportedRemoteControlError,
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

/**
 * @effect-expect-leaking HttpClient.HttpClient
 */
class TypeEndpoint extends ProcessManager.Endpoint<TypeEndpoint>()(
  TypeGroup,
  {
    baseUrl: "http://127.0.0.1:32134",
  },
) {}

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends
        (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false;
type EffectError<T> = T extends Effect.Effect<unknown, infer E, unknown> ? E : never;
type LayerOut<T> = T extends Layer.Layer<infer ROut, any, any> ? ROut : never;
type LayerIn<T> = T extends Layer.Layer<any, any, infer RIn> ? RIn : never;
const assertType = <T extends true>(_value?: T): void => undefined;

export const processGroupTypeChecks = Effect.gen(function* () {
  const directGroup = yield* ProcessGroup.make("@test/TypeDirectGroup", [
    TypeProcess,
    TypeEmailQueue,
  ] as const);
  const group = yield* TypeGroup.make;
  const serviceGroup = yield* TypeGroup;
  const acceptProcessId = (
    _id: typeof TypeGroup.contract.processes[number]["id"],
  ) => Effect.void;
  const acceptQueueId = (
    _id: typeof TypeGroup.contract.queues[number]["id"],
  ) => Effect.void;

  yield* group.start(TypeProcess);
  yield* group.queue(TypeEmailQueue).enqueue({ to: "ops@example.com" });
  yield* group.queue(TypeInvoiceQueue).enqueue({ invoiceId: "inv_123" });
  yield* directGroup.queue(TypeEmailQueue).enqueue({ to: "local@example.com" });
  yield* serviceGroup.queue(TypeEmailQueue).enqueue({ to: "remote-capable@example.com" });
  yield* acceptProcessId(TypeProcess.id);
  yield* acceptQueueId(TypeEmailQueue.id);
  yield* acceptQueueId(TypeInvoiceQueue.id);

  const _directQueueEnqueue = directGroup
    .queue(TypeEmailQueue)
    .enqueue({ to: "local-error-channel@example.com" });
  const _serviceQueueEnqueue = serviceGroup
    .queue(TypeEmailQueue)
    .enqueue({ to: "remote-error-channel@example.com" });
  const _remoteLayer = ProcessGroup.remoteLayer(TypeGroup, TypeEndpoint);
  const _registryLayer = ProcessManager.ConnectionRegistry.layer(
    [TypeGroup] as const,
    {
      [TypeGroup.id]: "http://127.0.0.1:32134",
    },
  );
  const _registryConnect = ProcessManager.connect(TypeGroup);

  type DirectGroupId = typeof directGroup.id;
  type DirectQueueEnqueueError = EffectError<typeof _directQueueEnqueue>;
  type ServiceQueueEnqueueError = EffectError<typeof _serviceQueueEnqueue>;
  type RemoteLayerOut = LayerOut<typeof _remoteLayer>;
  type RemoteLayerIn = LayerIn<typeof _remoteLayer>;
  type RegistryLayerOut = LayerOut<typeof _registryLayer>;
  type RegistryConnectIn = Effect.Services<typeof _registryConnect>;

  assertType<Assert<IsEqual<DirectGroupId, "@test/TypeDirectGroup">>>();
  assertType<Assert<IsEqual<DirectQueueEnqueueError, ProcessGroupErrors>>>();
  assertType<Assert<IsEqual<ServiceQueueEnqueueError, ProcessGroupControlError>>>();
  assertType<Assert<IsEqual<IsNever<ServiceQueueEnqueueError>, false>>>();
  assertType<Assert<IsAssignable<UnsupportedRemoteControlError, ServiceQueueEnqueueError>>>();
  assertType<Assert<IsEqual<RemoteLayerOut, TypeGroup>>>();
  assertType<Assert<IsEqual<RemoteLayerIn, TypeEndpoint | HttpClient.HttpClient>>>();
  assertType<Assert<IsEqual<RegistryLayerOut, ProcessManagerConnectionRegistry>>>();
  assertType<Assert<IsEqual<RegistryConnectIn, ProcessManagerConnectionRegistry>>>();

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

    ProcessManager.ConnectionRegistry.layer([TypeGroup] as const, {
      // @ts-expect-error registry requires every group id in the tuple
      "@test/OtherGroup": "http://127.0.0.1:32134",
    });
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

      return yield* Effect.gen(function* () {
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
        const validated = yield* Schema.decodeUnknownEffect(
          ProcessGroupContractSchema,
        )(group.contract);
        expect(validated).toEqual(group.contract);
        const invalidExit = yield* Effect.exit(
          Schema.decodeUnknownEffect(ProcessGroupContractSchema)({
            ...group.contract,
            queues: [
              {
                id: EmailQueue.id,
                kind: "queue",
                controls: ["not-a-control"],
              },
            ],
          }),
        );
        expect(Exit.isFailure(invalidExit)).toBe(true);

        yield* group.queue(EmailQueue).enqueue({ to: "ops@example.com" });
        const queue = yield* EmailQueue;
        yield* waitForCompleted(queue, 1);

        yield* group.runImmediately(SyncProcess);

        expect(yield* Ref.get(handled)).toEqual(["ops@example.com"]);
        expect(yield* Ref.get(runs)).toBe(1);

        const queueStatus = yield* group.queue(EmailQueue).status;
        expect(queueStatus.name).toBe(EmailQueue.id);
        expect(queueStatus.completed).toBe(1);
      }).pipe(
        provideLayer(
          Layer.mergeAll(EmailQueue.layer),
        ),
      );
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

      return yield* Effect.gen(function* () {
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
        provideLayer(Layer.mergeAll(BillingGroup.layer, EmailQueue.layer)),
      );
      }),
  );
});
