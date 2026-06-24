import { DateTime, Duration, Effect, Exit, Layer, Ref, Schema, Stream } from "effect";
import { RpcClient, RpcTest } from "effect/unstable/rpc";
import { expect, it } from "vitest";
import { QueueResource, queueControlSpec } from "../src/QueueContract";
import { QueueMissingItemSchemaError } from "../src/QueueResource";
import type { QueueEntry } from "../src/QueueResource";
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
    statusNow: Effect.sync(() => ({
      sizes: { high: 0, normal: pending, low: 0 },
      paused,
      inFlight: 0,
      completed: done,
    })),
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
    // one-shot status snapshot round-trips (no stream subscription needed)
    expect(yield* jobs.statusNow).toEqual({
      sizes: { high: 0, normal: 3, low: 0 },
      paused: false,
      inFlight: 0,
      completed: 0,
    });

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
      "statusNow",
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
// The item is a struct; `add`/`prioritize`/`defer` take it DIRECTLY (the whole item schema is
// the rpc payload), and `enqueue` takes the full entry array directly.
const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}
// add/prioritize/defer accept an item OR a batch — the contract payload is `item | item[]`.
type NumberIn = NumberItem | ReadonlyArray<NumberItem>;
const asItems = (p: NumberIn): ReadonlyArray<NumberItem> =>
  "n" in p ? [p] : p;
class Numbers extends QueueResource.Tag<Numbers>()("test/Numbers", NumberItem) {}

it("queue add round-trips with a per-instance item schema (native validation)", () => {
  const enqueued: number[] = [];
  const impl = {
    ...makeImpl(),
    add: (p: NumberIn) =>
      Effect.sync(() => {
        for (const it of asItems(p)) enqueued.push(it.n);
      }),
    prioritize: (_: NumberIn) => Effect.void,
    defer: (_: NumberIn) => Effect.void,
    enqueue: (_: ReadonlyArray<QueueEntry<NumberItem>>) => Effect.void,
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
    yield* svc.add({ n: 5 });
    yield* svc.add({ n: 7 });
    // batch form: one call enqueues many (no N round trips)
    yield* svc.add([{ n: 8 }, { n: 9 }]);
    expect(enqueued).toEqual([5, 7, 8, 9]);
    // the control surface still works on the same per-instance group
    expect(yield* svc.size).toBe(3);
  }).pipe(Effect.provide(Resource.server(Numbers, impl)), Effect.scoped);
  return Effect.runPromise(program);
});

it("prioritize / defer / enqueue round-trip over the per-instance group", () => {
  const log: Array<string> = [];
  const impl = {
    ...makeImpl(),
    add: (p: NumberIn) =>
      Effect.sync(() => log.push(`add:${asItems(p).map((i) => i.n).join(",")}`)),
    prioritize: (p: NumberIn) =>
      Effect.sync(() => log.push(`hi:${asItems(p).map((i) => i.n).join(",")}`)),
    defer: (p: NumberIn) =>
      Effect.sync(() => log.push(`lo:${asItems(p).map((i) => i.n).join(",")}`)),
    enqueue: (entries: ReadonlyArray<QueueEntry<NumberItem>>) =>
      Effect.sync(() => log.push(`re:${entries.map((e) => e.item.n).join(",")}`)),
    release: () => Effect.succeed([]),
    releaseEncoded: () => Effect.succeed([]),
    deadLetter: () => Effect.succeed([]),
    drop: () => Effect.succeed([]),
    events: Stream.empty,
  };
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Numbers));
    const svc = forwardClient(rpc, specOf(Numbers), Numbers.groupId, Numbers.id);
    yield* svc.prioritize({ n: 1 });
    yield* svc.defer({ n: 2 });
    yield* svc.enqueue([
      {
        item: { n: 9 },
        entryId: "e1",
        priority: "high",
        attempts: 1,
        timestamps: { enqueuedAt: DateTime.makeUnsafe(0) },
      },
    ]);
    expect(log).toEqual(["hi:1", "lo:2", "re:9"]);
  }).pipe(Effect.provide(Resource.server(Numbers, impl)), Effect.scoped);
  return Effect.runPromise(program);
});

it("release returns entries; releaseEncoded surfaces a typed wire error", () => {
  const impl = {
    ...makeImpl(),
    add: (_: NumberIn) => Effect.void,
    prioritize: (_: NumberIn) => Effect.void,
    defer: (_: NumberIn) => Effect.void,
    enqueue: (_: ReadonlyArray<QueueEntry<NumberItem>>) => Effect.void,
    release: () =>
      Effect.succeed([
        {
          item: { n: 3 },
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
    expect(released.map((e) => e.item.n)).toEqual([3]);

    const caught = yield* svc.releaseEncoded({}).pipe(
      Effect.catchTag("QueueMissingItemSchemaError", (e) =>
        Effect.succeed(`missing:${e.queue}`),
      ),
    );
    expect(caught).toBe("missing:test/Numbers");
  }).pipe(Effect.provide(Resource.server(Numbers, impl)), Effect.scoped);
  return Effect.runPromise(program);
});

// ── remote enqueue is validated against the tag's schema on decode ──
// The RPC server decodes the enqueue payload against exactly this schema before the handler
// runs, so an out-of-date / mismatched remote client sending a malformed entry is rejected at
// the boundary — the load-bearing guarantee for future handoff (entries carry full metadata).
// This pins the *whole* entry (item + priority + attempts + timestamps), not just the item.
it("enqueue's wire schema (the server's decode gate) rejects malformed entries", () => {
  // the exact payload schema the RPC server decodes incoming `enqueue` calls against — the
  // payload IS the entry-array schema (single-schema payload), so decode it directly.
  const payload = specOf(Numbers).enqueue.payload;
  const decode = Schema.decodeUnknownExit(payload);
  const goodEntry = {
    item: { n: 5 },
    entryId: "e1",
    priority: "normal",
    attempts: 1,
    timestamps: { enqueuedAt: DateTime.makeUnsafe(0) },
  };

  expect(Exit.isSuccess(decode([goodEntry]))).toBe(true);
  // wrong item type → rejected by the tag's itemSchema
  expect(
    Exit.isFailure(decode([{ ...goodEntry, item: { n: "not-a-number" } }])),
  ).toBe(true);
  // bad priority literal → rejected (metadata is validated too)
  expect(
    Exit.isFailure(decode([{ ...goodEntry, priority: "urgent" }])),
  ).toBe(true);
  // bad attempts type → rejected
  expect(
    Exit.isFailure(decode([{ ...goodEntry, attempts: "lots" }])),
  ).toBe(true);
});

// ── QueueResource.layer: the engine wired behind the toolkit tag, run locally ──
class LocalQueue extends QueueResource.Tag<LocalQueue>()(
  "test/LocalQueue",
  NumberItem,
) {}

it("QueueResource.layer runs the engine behind the toolkit tag (local)", () => {
  const program = Effect.gen(function* () {
    const seen = yield* Ref.make<Array<number>>([]);
    const q = yield* LocalQueue;
    // the same `yield* Tag` surface the contract declares — backed by the live engine
    yield* Effect.forkScoped(
      Resource.runForEachTag(q.events, "Completed", (e) =>
        Ref.update(seen, (a) => [...a, e.entry.item.n]),
      ),
    );
    // let the (sliding-PubSub) subscription attach before enqueueing
    yield* Effect.sleep(Duration.millis(20));
    yield* q.add({ n: 1 });
    yield* q.prioritize({ n: 2 });
    // batch enqueue through the engine in one call
    yield* q.add([{ n: 3 }, { n: 4 }]);
    while ((yield* q.completed) < 4) {
      yield* Effect.sleep(Duration.millis(5));
    }
    expect([...(yield* Ref.get(seen))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(yield* q.isEmpty).toBe(true);
  }).pipe(
    Effect.provide(
      QueueResource.layer(LocalQueue, {
        effect: (_item: NumberItem) => Effect.void,
        concurrency: 1,
      }),
    ),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});

// ── host in the queue tag (type-level): ship only the tag ──
// A queue bound to a Host carries its own transport; its client requires the host, not the
// ambient Protocol. (Compile-time proof — the binding's type is what's asserted.)
class QueueHost extends Resource.Host<QueueHost>("queue/host") {}
class HostedNumbers extends QueueResource.Tag<HostedNumbers>()(
  "test/HostedNumbers",
  NumberItem,
  { host: QueueHost },
) {}
const _hostedQueueClient: Layer.Layer<HostedNumbers, never, QueueHost> =
  Resource.client(HostedNumbers);
void _hostedQueueClient;
// a hostless queue keeps the ambient-Protocol client.
const _hostlessQueueClient: Layer.Layer<Numbers, never, RpcClient.Protocol> =
  Resource.client(Numbers);
void _hostlessQueueClient;
