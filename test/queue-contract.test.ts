import {
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import { RpcClient, RpcTest } from "effect/unstable/rpc";
import { expect, it } from "vitest";
import { QueueHyperlink } from "../src";
import { queueControlSpec } from "../src/QueueHyperlink";
import { QueueMissingItemSchemaError } from "../src/QueueHyperlink";
import type { QueueEntry } from "../src/QueueHyperlink";
import * as Logs from "../src/Logs";
import * as Hyperlink from "../src/Hyperlink";
import { forwardClient, groupOf, isVoidCommand, methodMeta, specOf } from "../src/Hyperlink";
import * as Node from "../src/Node";

// A queue family built from the control contract: many instances share the "queue" group.
const Queue = Hyperlink.tagFor("queue", queueControlSpec);
class Jobs extends Queue<Jobs>("@app/Jobs") {}
class Mail extends Queue<Mail>("@app/Mail") {}

// Minimal in-memory queue control impl (just enough state to assert the verbs round-trip).
// `status` is the SSOT live snapshot (a SubscriptionRef); `size`/`isEmpty` are `value`s derived
// from it (their impls are the backing streams). Mutating verbs push a new snapshot so the live
// `value`s stay current on the client after a round-trip.
const makeImpl = () => {
  const initial = {
    sizes: { high: 0, normal: 3, low: 0 },
    paused: false,
    inFlight: 0,
    completed: 0,
    phase: "running" as const,
  };
  const statusRef = Effect.runSync(SubscriptionRef.make(initial));
  const patch = (f: (s: typeof initial) => typeof initial) =>
    Effect.runSync(SubscriptionRef.update(statusRef, f));
  const statusSub = Hyperlink.subscribable(statusRef);
  return {
    // live current state — `status` is the SSOT Subscribable; the scalars are mapped views (`ref` impls).
    status: statusSub,
    size: Hyperlink.mapSubscribable(
      statusSub,
      (s) => s.sizes.high + s.sizes.normal + s.sizes.low,
    ),
    isEmpty: Hyperlink.mapSubscribable(
      statusSub,
      (s) => s.sizes.high + s.sizes.normal + s.sizes.low === 0,
    ),
    start: Effect.void,
    pause: Effect.sync(() => patch((s) => ({ ...s, paused: true }))),
    resume: Effect.sync(() => patch((s) => ({ ...s, paused: false }))),
    shutdown: Effect.sync(() =>
      patch((s) => ({ ...s, sizes: { high: 0, normal: 0, low: 0 } })),
    ),
    clear: Effect.sync(() => {
      const s = Effect.runSync(SubscriptionRef.get(statusRef));
      const cleared = s.sizes.high + s.sizes.normal + s.sizes.low;
      patch((cur) => ({
        ...cur,
        sizes: { high: 0, normal: 0, low: 0 },
        completed: 0,
      }));
      return cleared;
    }),
    // observability streams — not exercised by the RpcTest control round-trip below (streaming
    // is verified over real http in resource-stream-http.test.ts); empty streams satisfy the
    // contract. `events` (item-typed) is supplied per-instance where the item schema is known.
    metrics: {
      stream: Stream.empty,
      query: () => Effect.succeed([]),
    },
    logs: {
      stream: Stream.empty,
      query: () => Effect.succeed([]),
    },
  };
};

it("drives a queue's control surface remotely, routed by instance id", () => {
  const jobsImpl = makeImpl();
  const mailImpl = makeImpl();

  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Queue));
    const jobs = forwardClient(rpc, specOf(Queue), Jobs.groupId, Jobs.key);
    const mail = forwardClient(rpc, specOf(Queue), Mail.groupId, Mail.key);

    // observation verbs round-trip — `size`/`isEmpty`/`status` are live `value`s; on the raw wire
    // (forwardClient) they surface as their backing streams, so read the current value off the head
    // (a `value` stream emits the current snapshot first).
    const head = <A>(s: Stream.Stream<A>) =>
      Stream.runHead(s).pipe(Effect.map(Option.getOrThrow));
    expect(yield* head(jobs.size)).toBe(3);
    expect((yield* head(jobs.status)).sizes).toEqual({
      high: 0,
      normal: 3,
      low: 0,
    });
    expect(yield* head(jobs.isEmpty)).toBe(false);
    // current status snapshot is the head of the live status stream
    expect(yield* head(jobs.status)).toEqual({
      sizes: { high: 0, normal: 3, low: 0 },
      paused: false,
      inFlight: 0,
      completed: 0,
      phase: "running",
    });

    // control verbs route to the right instance
    yield* jobs.pause;
    yield* jobs.resume;
    expect(yield* jobs.clear).toBe(3); // Jobs drained
    expect(yield* head(jobs.size)).toBe(0);
    expect(yield* head(mail.size)).toBe(3); // Mail untouched — routing is per-instance
  }).pipe(
    Effect.provide(
      Hyperlink.serveInstances(
        Queue,
        Hyperlink.instance(Jobs, jobsImpl),
        Hyperlink.instance(Mail, mailImpl),
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
      "isEmpty",
      "metrics",
      "pause",
      "resume",
      "shutdown",
      "size",
      "start",
      "status",
    ].sort(),
  );
  // observability is nested: stream + query per group
  expect(Object.keys(queueControlSpec.metrics).sort()).toEqual([
    "query",
    "stream",
  ]);
});

// Tool metadata (query/mutate/destructive/description) drives CLI/TUI/dashboard rendering.
it("marks each verb query vs mutate, with destructive hints", () => {
  // the direct (non-group) verbs — `metrics`/`logs` are nested groups, not methods.
  type MethodKey = "size" | "isEmpty" | "pause" | "start" | "shutdown" | "clear";
  const meta = (k: MethodKey) => methodMeta(queueControlSpec[k]);

  // reads are queries
  expect(meta("size").kind).toBe("query");
  expect(meta("isEmpty").kind).toBe("query");

  // void lifecycle commands are inputless `effect` (wire kind `query`, void success)
  expect(meta("pause").kind).toBe("query");
  expect(meta("start").kind).toBe("query");
  expect(isVoidCommand(queueControlSpec.pause)).toBe(true);
  expect(isVoidCommand(queueControlSpec.start)).toBe(true);

  // state-losing commands are flagged destructive
  expect(meta("shutdown")).toMatchObject({ kind: "query", destructive: true });
  expect(meta("clear")).toMatchObject({ kind: "query", destructive: true });
  expect(meta("pause").destructive).toBe(false);

  // descriptions are present for help text
  expect(meta("size").description).toContain("pending items");
});

// ── data plane (model B): the designed form — QueueHyperlink.Tag<Self>()(id, itemSchema) ──
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
class Numbers extends QueueHyperlink.Tag<Numbers>()("test/Numbers", { payload: NumberItem }) {}

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
    const svc = forwardClient(rpc, specOf(Numbers), Numbers.groupId, Numbers.key);
    // `add` is typed by the instance's itemSchema; RPC validates the item on the wire.
    yield* svc.add({ n: 5 });
    yield* svc.add({ n: 7 });
    // batch form: one call enqueues many (no N round trips)
    yield* svc.add([{ n: 8 }, { n: 9 }]);
    expect(enqueued).toEqual([5, 7, 8, 9]);
    // the control surface still works on the same per-instance group — `size` is a `value`, which
    // on the raw wire (forwardClient) surfaces as its backing stream; read the current head.
    expect(
      yield* Stream.runHead(svc.size).pipe(Effect.map(Option.getOrThrow)),
    ).toBe(3);
  }).pipe(Effect.provide(Hyperlink.serveRemote(Numbers, impl)), Effect.scoped);
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
    const svc = forwardClient(rpc, specOf(Numbers), Numbers.groupId, Numbers.key);
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
  }).pipe(Effect.provide(Hyperlink.serveRemote(Numbers, impl)), Effect.scoped);
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
    const svc = forwardClient(rpc, specOf(Numbers), Numbers.groupId, Numbers.key);
    const released = yield* svc.release({});
    expect(released.map((e) => e.item.n)).toEqual([3]);

    const caught = yield* svc.releaseEncoded({}).pipe(
      Effect.catchTag("QueueMissingItemSchemaError", (e) =>
        Effect.succeed(`missing:${e.queue}`),
      ),
    );
    expect(caught).toBe("missing:test/Numbers");
  }).pipe(Effect.provide(Hyperlink.serveRemote(Numbers, impl)), Effect.scoped);
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

// ── QueueHyperlink.layer: the engine wired behind the toolkit tag, run locally ──
class LocalQueue extends QueueHyperlink.Tag<LocalQueue>()("test/LocalQueue", {
  payload: NumberItem,
}) {}

it("QueueHyperlink.layer runs the engine behind the toolkit tag (local)", () => {
  const program = Effect.gen(function* () {
    const seen = yield* Ref.make<Array<number>>([]);
    const q = yield* LocalQueue;
    // the same `yield* Tag` surface the contract declares — backed by the live engine
    yield* Effect.forkScoped(
      Hyperlink.runForEachTag(q.events, "Completed", (e) =>
        Ref.update(seen, (a) => [...a, e.entry.item.n]),
      ),
    );
    // let the (sliding-PubSub) subscription attach before enqueueing
    yield* Effect.sleep(Duration.millis(20));
    yield* q.add({ n: 1 });
    yield* q.prioritize({ n: 2 });
    // batch enqueue through the engine in one call
    yield* q.add([{ n: 3 }, { n: 4 }]);
    // wait until all four completions have been observed on the events stream.
    yield* Effect.repeat(Ref.get(seen), {
      until: (a) => a.length >= 4,
      schedule: Schedule.spaced(Duration.millis(5)),
    });
    expect([...(yield* Ref.get(seen))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    // the queue is now empty — the live `isEmpty` delta stream reflects it.
    const emptied = yield* Stream.runHead(
      Stream.filter(
        q.isEmpty.changes,
        (e) => e === true,
      ),
    );
    expect(Option.getOrThrow(emptied)).toBe(true);
  }).pipe(
    Effect.provide(
      QueueHyperlink.layerMemory(LocalQueue, {
        effect: (_item: NumberItem) => Effect.void,
        concurrency: 1,
      }),
    ),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});

// ── QueueHyperlink.layer scopes worker logs readable via Hyperlink.logs ──
class LoggingQueue extends QueueHyperlink.Tag<LoggingQueue>()("test/LoggingQueue", {
  payload: NumberItem,
}) {}

it("QueueHyperlink.layer scopes worker logs via Hyperlink.logs", () => {
  const program = Effect.gen(function* () {
    const q = yield* LoggingQueue;
    const { stream } = yield* Hyperlink.logs(LoggingQueue);
    const collected = yield* Effect.forkChild(
      Stream.runCollect(
        Stream.take(
          Stream.filter(stream, (e) => e.message.includes("handling")),
          1,
        ),
      ),
    );
    yield* Effect.sleep(Duration.millis(20));
    yield* q.add({ n: 42 });
    const entry = Array.from(yield* Fiber.join(collected))[0];
    expect(entry?.message).toContain("handling 42");
    expect(entry?.level).toBe("Info");
  }).pipe(
    Effect.provide(
      // Soft-default Memory for the engine; LogRelay alone for live Hyperlink.logs
      // (do not provideMerge a Node-only AppStore — Soft would capture that Storage).
      QueueHyperlink.layer(LoggingQueue, {
        effect: (item: NumberItem) => Effect.logInfo(`handling ${String(item.n)}`),
        concurrency: 1,
      }).pipe(Layer.provideMerge(Logs.layer)),
    ),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});

// ── node in the queue tag (type-level): ship only the tag ──
// A queue bound to a Node carries its own transport; its client requires the node, not the
// ambient Protocol. (Compile-time proof — the binding's type is what's asserted.)
class QueueNode extends Node.Tag<QueueNode>()("queue/node") {}
class NodeNumbers extends QueueHyperlink.Tag<NodeNumbers>()("test/NodeNumbers", {
  payload: NumberItem,
  node: QueueNode,
}) {}
const _nodeedQueueClient: Layer.Layer<NodeNumbers, never, QueueNode> =
  Hyperlink.client(NodeNumbers);
void _nodeedQueueClient;
// a nodeless queue keeps the ambient-Protocol client.
const _nodelessQueueClient: Layer.Layer<Numbers, never, RpcClient.Protocol> =
  Hyperlink.client(Numbers);
void _nodelessQueueClient;
