import { DateTime, Effect, Layer, Schema, Stream, SubscriptionRef } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { WorkPool } from "../src";
import * as Hyperlink from "../src/Hyperlink";
import { groupOf } from "../src/Hyperlink";
import type { QueueEntry } from "../src/WorkPool";

// The handoff path: a full QueueEntry (item + priority + attempts + timestamps) handed to a
// remote queue's `enqueue` over a REAL http transport. This exercises the actual serialization
// (DateTime ⇄ ISO string, etc.) and the server-side decode — i.e. what a zero-downtime handoff
// / A-B deploy would do. The in-memory contract tests use RpcTest; this proves the wire.
const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}
class HttpQueue extends WorkPool.Tag<HttpQueue>()("queue-http/Q", { payload: NumberItem }) {}

// last entries the server received on `enqueue`, after crossing the wire and decoding.
const received: Array<QueueEntry<NumberItem>> = [];

// ref-field impls are Subscribables backed by a SubscriptionRef (matches Hyperlink.subscribable).
const initialStatus = {
  sizes: { high: 0, normal: 0, low: 0 },
  paused: false,
  inFlight: 0,
  completed: 0,
  phase: "running" as const,
};
const statusRef = Effect.runSync(SubscriptionRef.make(initialStatus));
const statusSub = Hyperlink.subscribable(statusRef);

const stub = {
  size: Hyperlink.mapSubscribable(
    statusSub,
    (s) => s.sizes.high + s.sizes.normal + s.sizes.low,
  ),
  isEmpty: Hyperlink.mapSubscribable(
    statusSub,
    (s) => s.sizes.high + s.sizes.normal + s.sizes.low === 0,
  ),
  start: Effect.void,
  pause: Effect.void,
  resume: Effect.void,
  shutdown: Effect.void,
  clear: Effect.succeed(0),
  status: statusSub,
  metrics: {
    stream: Stream.empty,
    query: () => Effect.succeed([]),
  },
  logs: {
    stream: Stream.empty,
    query: () => Effect.succeed([]),
  },
  add: (_: NumberItem | ReadonlyArray<NumberItem>) => Effect.void,
  prioritize: (_: NumberItem | ReadonlyArray<NumberItem>) => Effect.void,
  defer: (_: NumberItem | ReadonlyArray<NumberItem>) => Effect.void,
  enqueue: (entries: ReadonlyArray<QueueEntry<NumberItem>>) =>
    Effect.sync(() => {
      received.push(...entries);
    }),
  release: () => Effect.succeed([]),
  releaseEncoded: () => Effect.succeed([]),
  deadLetter: () => Effect.succeed([]),
  drop: () => Effect.succeed([]),
  events: Stream.empty,
};

const HttpQueueServer = HttpRouter.serve(
  RpcServer.layerHttp({
    group: groupOf(HttpQueue),
    path: "/rpc",
    protocol: "http",
  }).pipe(Layer.provide(Hyperlink.serveRemote(HttpQueue, stub))),
).pipe(
  Layer.provideMerge(RpcSerialization.layerNdjson),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const httpProtocol = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

it("enqueue round-trips a full entry (item + metadata) over real http", () => {
  const program = Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((server) => server.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;

    yield* Effect.gen(function* () {
      const queue = yield* HttpQueue;
      yield* queue.enqueue([
        {
          item: { n: 7 },
          entryId: "handoff-1",
          priority: "high",
          attempts: 2,
          timestamps: { enqueuedAt: DateTime.makeUnsafe(0) },
        },
      ]);

      // the server received the entry, decoded, with every field intact across the wire
      expect(received).toHaveLength(1);
      const got = received[0];
      expect(got?.item.n).toBe(7);
      expect(got?.entryId).toBe("handoff-1");
      expect(got?.priority).toBe("high");
      expect(got?.attempts).toBe(2);
      expect(DateTime.toEpochMillis(got!.timestamps.enqueuedAt)).toBe(0);
    }).pipe(
      Effect.provide(
        Hyperlink.client(HttpQueue).pipe(Layer.provide(httpProtocol(port))),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(HttpQueueServer), Effect.scoped);
  return Effect.runPromise(program as Effect.Effect<void, unknown, never>);
});
