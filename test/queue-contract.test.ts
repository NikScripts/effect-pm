import { Effect, Layer, Schema } from "effect";
import { RpcClient, RpcTest } from "effect/unstable/rpc";
import { expect, it } from "vitest";
import { QueueResource, queueControlSpec } from "../src/QueueContract";
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

// The control spec is the fixed-schema half; the data-plane (item-typed) verbs come later.
it("exposes the expected control verbs", () => {
  expect(Object.keys(queueControlSpec).sort()).toEqual(
    [
      "clear",
      "completed",
      "isEmpty",
      "pause",
      "resume",
      "shutdown",
      "size",
      "sizes",
      "start",
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
