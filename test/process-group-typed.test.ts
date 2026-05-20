import { describe, expect, it } from "@effect/vitest";
import { Context, Duration, Effect, Exit, Layer, Ref, Schema } from "effect";
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
interface Email {
  readonly to: string;
}

interface InvoiceJob {
  readonly invoiceId: string;
}

class TypeEmailQueue extends QueueResource.Service<TypeEmailQueue, Email, never>()("@test/TypeEmailQueue", {
  effect: (_email: Email) => Effect.void,
}) {}

class TypeInvoiceQueue extends QueueResource.Service<TypeInvoiceQueue, InvoiceJob, never>()("@test/TypeInvoiceQueue", {
  effect: (_job: InvoiceJob) => Effect.void,
}) {}

class TypeQueueHookService extends Context.Service<
  TypeQueueHookService,
  { readonly record: Effect.Effect<void> }
>()("@test/TypeQueueHookService") {}

class TypeHookQueue extends QueueResource.Service<TypeHookQueue, Email, never>()(
  "@test/TypeHookQueue",
  {
    effect: (_email: Email) => Effect.void,
    onEnqueued: () =>
      Effect.gen(function* () {
        const service = yield* TypeQueueHookService;
        yield* service.record;
      }),
  },
) {}

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

  const _directQueueControls = directGroup.queue(TypeEmailQueue);
  const _serviceQueueControls = serviceGroup.queue(TypeEmailQueue);
  const _remoteLayer = ProcessGroup.remoteLayer(TypeGroup, TypeEndpoint);
  const _hookQueueLayer = TypeHookQueue.layer;
  const _registryLayer = ProcessManager.ConnectionRegistry.layer(
    [TypeGroup] as const,
    {
      [TypeGroup.id]: "http://127.0.0.1:32134",
    },
  );
  const _registryConnect = ProcessManager.connect(TypeGroup);

  type DirectGroupId = typeof directGroup.id;
  type DirectQueueEnqueueError = EffectError<ReturnType<typeof _directQueueControls.enqueue>>;
  type ServiceQueueEnqueueError = EffectError<ReturnType<typeof _serviceQueueControls.enqueue>>;
  type RemoteLayerOut = LayerOut<typeof _remoteLayer>;
  type RemoteLayerIn = LayerIn<typeof _remoteLayer>;
  type HookQueueLayerIn = LayerIn<typeof _hookQueueLayer>;
  type RegistryLayerOut = LayerOut<typeof _registryLayer>;
  type RegistryConnectIn = Effect.Services<typeof _registryConnect>;

  assertType<Assert<IsEqual<DirectGroupId, "@test/TypeDirectGroup">>>();
  assertType<Assert<IsEqual<DirectQueueEnqueueError, ProcessGroupErrors>>>();
  assertType<Assert<IsEqual<ServiceQueueEnqueueError, ProcessGroupControlError>>>();
  assertType<Assert<IsEqual<IsNever<ServiceQueueEnqueueError>, false>>>();
  assertType<Assert<IsAssignable<UnsupportedRemoteControlError, ServiceQueueEnqueueError>>>();
  assertType<Assert<IsEqual<RemoteLayerOut, TypeGroup>>>();
  assertType<Assert<IsEqual<RemoteLayerIn, TypeEndpoint | HttpClient.HttpClient>>>();
  assertType<Assert<IsEqual<HookQueueLayerIn, TypeQueueHookService>>>();
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

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()("@test/TypedDirectEmailQueue", {
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
              controls: ["enqueue", "start", "pause", "resume", "clear", "status"],
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
        Effect.provide(Layer.mergeAll(SyncProcess.layer, EmailQueue.layer)),
      );
    }),
  );

  it.live("startAll forks deferred queues (autoStart false) before starting processes", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make<ReadonlyArray<string>>([]);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()("@test/StartAllDeferQueue", {
        autoStart: false,
        effect: (email: Email) =>
          Ref.update(handled, (values) => [...values, email.to]),
        concurrency: 1,
      }) {}

      yield* Effect.gen(function* () {
        const group = yield* ProcessGroup.make("@test/StartAllDeferGroup", [EmailQueue] as const);
        yield* group.queue(EmailQueue).enqueue({ to: "defer@example.com" });
        yield* Effect.sleep(Duration.millis(40));
        expect((yield* Ref.get(handled)).length).toBe(0);

        yield* group.startAll();

        const queue = yield* EmailQueue;
        yield* waitForCompleted(queue, 1);
        expect(yield* Ref.get(handled)).toEqual(["defer@example.com"]);
      }).pipe(Effect.provide(EmailQueue.layer));
    }),
  );

  it.live("group service layer does not cold-start queue onDrained", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/GroupLayerDrainedQueue",
        {
          effect: (_email: Email) => Effect.void,
          concurrency: 1,
          onDrained: (_q) => Ref.update(drains, (n) => n + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/GroupLayerDrainedGroup",
        [EmailQueue] as const,
      ) {}

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;
        yield* Effect.sleep(Duration.millis(120));
        expect(yield* Ref.get(drains)).toBe(0);
        void group;
      }).pipe(
        Effect.provide(
          BillingGroup.layer.pipe(Layer.provide(EmailQueue.layer)),
        ),
      );
    }),
  );

  it.live("group queue start does not cold-start onDrained but drain-to-empty does", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make<ReadonlyArray<string>>([]);
      const drains = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/GroupQueueStartDrainedQueue",
        {
          autoStart: false,
          effect: (email: Email) =>
            Ref.update(handled, (values) => [...values, email.to]),
          concurrency: 1,
          onDrained: (_q) => Ref.update(drains, (n) => n + 1),
        },
      ) {}

      yield* Effect.gen(function* () {
        const group = yield* ProcessGroup.make("@test/GroupQueueStartDrainedGroup", [
          EmailQueue,
        ] as const);

        yield* group.queue(EmailQueue).start;
        yield* Effect.sleep(Duration.millis(80));
        expect(yield* Ref.get(drains)).toBe(0);

        yield* group.queue(EmailQueue).enqueue({ to: "ops@example.com" });
        const queue = yield* EmailQueue;
        yield* waitForCompleted(queue, 1);

        let steps = 0;
        while ((yield* Ref.get(drains)) < 1 && steps++ < 200) {
          yield* Effect.sleep(Duration.millis(5));
        }
        expect(yield* Ref.get(handled)).toEqual(["ops@example.com"]);
        expect(yield* Ref.get(drains)).toBeGreaterThanOrEqual(1);
      }).pipe(Effect.provide(EmailQueue.layer));
    }),
  );

  it.live("group startAll does not cold-start onDrained before queued work drains", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make<ReadonlyArray<string>>([]);
      const drains = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/GroupStartAllDrainedQueue",
        {
          autoStart: false,
          effect: (email: Email) =>
            Ref.update(handled, (values) => [...values, email.to]),
          concurrency: 1,
          onDrained: (_q) => Ref.update(drains, (n) => n + 1),
        },
      ) {}

      yield* Effect.gen(function* () {
        const group = yield* ProcessGroup.make("@test/GroupStartAllDrainedGroup", [
          EmailQueue,
        ] as const);

        yield* group.startAll();
        yield* Effect.sleep(Duration.millis(80));
        expect(yield* Ref.get(drains)).toBe(0);

        yield* group.queue(EmailQueue).enqueue({ to: "team@example.com" });
        const queue = yield* EmailQueue;
        yield* waitForCompleted(queue, 1);

        let steps = 0;
        while ((yield* Ref.get(drains)) < 1 && steps++ < 200) {
          yield* Effect.sleep(Duration.millis(5));
        }
        expect(yield* Ref.get(handled)).toEqual(["team@example.com"]);
        expect(yield* Ref.get(drains)).toBeGreaterThanOrEqual(1);
      }).pipe(Effect.provide(EmailQueue.layer));
    }),
  );

  it.live("group startAll can trigger onDrained after a started process enqueues work that drains", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make<ReadonlyArray<string>>([]);
      const drains = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
        "@test/GroupProcessEnqueueDrainedQueue",
        {
          autoStart: false,
          effect: (email: Email) =>
            Ref.update(handled, (values) => [...values, email.to]),
          concurrency: 1,
          onDrained: (_q) => Ref.update(drains, (n) => n + 1),
        },
      ) {}

      class EnqueueProcess extends Process.Service<EnqueueProcess>()(
        "@test/GroupProcessEnqueueDrainedProcess",
        {
          effect: Effect.gen(function* () {
            const queue = yield* EmailQueue;
            yield* queue.add({ to: "process@example.com" });
          }),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/GroupProcessEnqueueDrainedGroup",
        [EnqueueProcess, EmailQueue] as const,
      ) {}

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;
        yield* Effect.sleep(Duration.millis(80));
        expect(yield* Ref.get(drains)).toBe(0);

        yield* group.startAll();

        const queue = yield* EmailQueue;
        yield* waitForCompleted(queue, 1);

        let steps = 0;
        while ((yield* Ref.get(drains)) < 1 && steps++ < 200) {
          yield* Effect.sleep(Duration.millis(5));
        }
        expect(yield* Ref.get(handled)).toEqual(["process@example.com"]);
        expect(yield* Ref.get(drains)).toBeGreaterThanOrEqual(1);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(Layer.mergeAll(EnqueueProcess.layer, EmailQueue.layer)),
            ),
            EmailQueue.layer,
          ),
        ),
      );
    }),
  );

  it.live("supports an injectable group service for singleton control surfaces", () =>
    Effect.gen(function* () {
      const handled = yield* Ref.make<ReadonlyArray<string>>([]);
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()("@test/TypedServiceEmailQueue", {
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
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(Layer.mergeAll(SyncProcess.layer, EmailQueue.layer)),
            ),
            EmailQueue.layer,
          ),
        ),
      );
    }),
  );
});
