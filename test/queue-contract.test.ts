import { DateTime, Effect, Layer, Schema, Stream } from "effect";
import { RpcClient, RpcTest } from "effect/unstable/rpc";
import { expect, it } from "vitest";
import { QueueResource, queueControlSpec } from "../src/QueueContract";
import { QueueMissingItemSchemaError } from "../src/QueueResource";
import {
  Resource,
  forwardClient,
  groupOf,
  methodMeta,
  specOf,
} from "../src/Resource";

// A queue family built from the control contract: many instances share the "queue" group.
const Queue = Resource.tagFor("queue", queueControlSpec);
class Jobs extends Queue<Jobs>("@app/Jobs") {}
class Mail extends Queue<Mail>("@app/Mail") {}

// Minimal in-memory queue control impl (just enough state to assert the verbs round-trip).
const makeImpl = () => {
  let paused = false;
  let pending = 3;
  let done = 0;
  return {
    size: Effect.sync(() => pending),
    sizes: Effect.sync(() => ({ high: 0, normal: pending, low: 0 })),
    isEmpty: Effect.sync(() => pending === 0),
    completed: Effect.sync(() => done),
    start: Effect.void,
    pause: Effect.sync(() => {
      paused = true;
    }),
    resume: Effect.sync(() => {
      paused = false;
    }),
    shutdown: Effect.sync(() => {
      pending = 0;
    }),
    clear: Effect.sync(() => {
      const cleared = pending;
      pending = 0;
      done = 0;
      void paused;
      return cleared;
    }),
    // observability streams — not exercised by the RpcTest control round-trip below (streaming
    // is verified over real http in resource-stream-http.test.ts); empty streams satisfy the
    // contract. `events` (item-typed) is supplied per-instance where the item schema is known.
    status: Stream.empty,
    metrics: Stream.empty,
  };
};

it("drives a queue's control surface remotely, routed by instance id", () => {
  const jobsImpl = makeImpl();
  const mailImpl = makeImpl();

  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Queue));
    const jobs = forwardClient(rpc, specOf(Queue), Jobs.groupId, Jobs.id);
    const mail = forwardClient(rpc, specOf(Queue), Mail.groupId, Mail.id);

    // observation verbs round-trip
    expect(yield* jobs.size).toBe(3);
    expect(yield* jobs.sizes).toEqual({ high: 0, normal: 3, low: 0 });
    expect(yield* jobs.isEmpty).toBe(false);

    // control verbs route to the right instance
    yield* jobs.pause;
    yield* jobs.resume;
    expect(yield* jobs.clear).toBe(3); // Jobs drained
    expect(yield* jobs.size).toBe(0);
    expect(yield* mail.size).toBe(3); // Mail untouched — routing is per-instance
  }).pipe(
    Effect.provide(
      Resource.serveInstances(
        Queue,
        Resource.instance(Jobs, jobsImpl),
        Resource.instance(Mail, mailImpl),
      ),
    ),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});

// The control spec is the fixed-schema half; item-typed data-plane verbs live on `queueSpec`.
it("exposes the expected control verbs", () => {
  expect(Object.keys(queueControlSpec).sort()).toEqual(
    [
      "clear",
      "completed",
      "isEmpty",
      "metrics",
      "pause",
      "resume",
      "shutdown",
      "size",
      "sizes",
      "start",
      "status",
    ].sort(),
  );
});

// Tool metadata (query/mutate/destructive/description) drives CLI/TUI/dashboard rendering.
it("marks each verb query vs mutate, with destructive hints", () => {
  const meta = (k: keyof typeof queueControlSpec) => methodMeta(queueControlSpec[k]);

  // reads are queries
  expect(meta("size").kind).toBe("query");
  expect(meta("isEmpty").kind).toBe("query");

  // mutations are mutates
  expect(meta("pause").kind).toBe("mutate");
  expect(meta("start").kind).toBe("mutate");

  // state-losing mutations are flagged destructive
  expect(meta("shutdown")).toMatchObject({ kind: "mutate", destructive: true });
  expect(meta("clear")).toMatchObject({ kind: "mutate", destructive: true });
  expect(meta("pause").destructive).toBe(false);

  // descriptions are present for help text
  expect(meta("size").description).toContain("pending items");
});

// ── data plane (model B): the designed form — QueueResource.Tag<Self>()(id, itemSchema) ──
class Numbers extends QueueResource.Tag<Numbers>()("test/Numbers", Schema.Number) {}

it("queue add round-trips with a per-instance item schema (native validation)", () => {
  const enqueued: number[] = [];
  const impl = {
    ...makeImpl(),
    add: ({ item }: { item: number }) =>
      Effect.sync(() => {
        enqueued.push(item);
      }),
    prioritize: (_: { item: number }) => Effect.void,
    defer: (_: { item: number }) => Effect.void,
    enqueue: (_: { entries: ReadonlyArray<{ item: number }> }) => Effect.void,
    release: () => Effect.succeed([]),
    releaseEncoded: () => Effect.succeed([]),
    deadLetter: () => Effect.succeed([]),
    drop: () => Effect.succeed([]),
    events: Stream.empty,
  };
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Numbers));
    const svc = forwardClient(rpc, specOf(Numbers), Numbers.groupId, Numbers.id);
    // `add` is typed by the instance's itemSchema; RPC validates the item on the wire.
    yield* svc.add({ item: 5 });
    yield* svc.add({ item: 7 });
    expect(enqueued).toEqual([5, 7]);
    // the control surface still works on the same per-instance group
    expect(yield* svc.size).toBe(3);
  }).pipe(Effect.provide(Resource.server(Numbers, impl)), Effect.scoped);
  return Effect.runPromise(program);
});

it("prioritize / defer / enqueue round-trip over the per-instance group", () => {
  const log: Array<string> = [];
  const impl = {
    ...makeImpl(),
    add: ({ item }: { item: number }) =>
      Effect.sync(() => log.push(`add:${String(item)}`)),
    prioritize: ({ item }: { item: number }) =>
      Effect.sync(() => log.push(`hi:${String(item)}`)),
    defer: ({ item }: { item: number }) =>
      Effect.sync(() => log.push(`lo:${String(item)}`)),
    enqueue: ({ entries }: { entries: ReadonlyArray<{ item: number }> }) =>
      Effect.sync(() => log.push(`re:${entries.map((e) => e.item).join(",")}`)),
    release: () => Effect.succeed([]),
    releaseEncoded: () => Effect.succeed([]),
    deadLetter: () => Effect.succeed([]),
    drop: () => Effect.succeed([]),
    events: Stream.empty,
  };
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Numbers));
    const svc = forwardClient(rpc, specOf(Numbers), Numbers.groupId, Numbers.id);
    yield* svc.prioritize({ item: 1 });
    yield* svc.defer({ item: 2 });
    yield* svc.enqueue({
      entries: [
        {
          item: 9,
          entryId: "e1",
          priority: "high",
          attempts: 1,
          timestamps: { enqueuedAt: DateTime.makeUnsafe(0) },
        },
      ],
    });
    expect(log).toEqual(["hi:1", "lo:2", "re:9"]);
  }).pipe(Effect.provide(Resource.server(Numbers, impl)), Effect.scoped);
  return Effect.runPromise(program);
});

it("release returns entries; releaseEncoded surfaces a typed wire error", () => {
  const impl = {
    ...makeImpl(),
    add: (_: { item: number }) => Effect.void,
    prioritize: (_: { item: number }) => Effect.void,
    defer: (_: { item: number }) => Effect.void,
    enqueue: (_: { entries: ReadonlyArray<{ item: number }> }) => Effect.void,
    release: () =>
      Effect.succeed([
        {
          item: 3,
          entryId: "e3",
          priority: "normal" as const,
          attempts: 1,
          timestamps: { enqueuedAt: DateTime.makeUnsafe(0) },
        },
      ]),
    // the engine error is Schema.TaggedErrorClass now → it crosses RPC and catchTag works
    releaseEncoded: () =>
      Effect.fail(new QueueMissingItemSchemaError({ queue: "test/Numbers" })),
    deadLetter: () => Effect.succeed([]),
    drop: () => Effect.succeed([]),
    events: Stream.empty,
  };
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Numbers));
    const svc = forwardClient(rpc, specOf(Numbers), Numbers.groupId, Numbers.id);
    const released = yield* svc.release({});
    expect(released.map((e) => e.item)).toEqual([3]);

    const caught = yield* svc.releaseEncoded({}).pipe(
      Effect.catchTag("QueueMissingItemSchemaError", (e) =>
        Effect.succeed(`missing:${e.queue}`),
      ),
    );
    expect(caught).toBe("missing:test/Numbers");
  }).pipe(Effect.provide(Resource.server(Numbers, impl)), Effect.scoped);
  return Effect.runPromise(program);
});

// ── host in the queue tag (type-level): ship only the tag ──
// A queue bound to a Host carries its own transport; its client requires the host, not the
// ambient Protocol. (Compile-time proof — the binding's type is what's asserted.)
class QueueHost extends Resource.Host<QueueHost>("queue/host") {}
class HostedNumbers extends QueueResource.Tag<HostedNumbers>()(
  "test/HostedNumbers",
  Schema.Number,
  { host: QueueHost },
) {}
const _hostedQueueClient: Layer.Layer<HostedNumbers, never, QueueHost> =
  Resource.client(HostedNumbers);
void _hostedQueueClient;
// a hostless queue keeps the ambient-Protocol client.
const _hostlessQueueClient: Layer.Layer<Numbers, never, RpcClient.Protocol> =
  Resource.client(Numbers);
void _hostlessQueueClient;
