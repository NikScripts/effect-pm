import { DateTime, Effect, Layer, Schema, Stream } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { QueueResource } from "../src";
import * as Resource from "../src/Resource";
import { groupOf } from "../src/Resource";
import type { QueueEntry } from "../src/QueueResource";

// The handoff path: a full QueueEntry (item + priority + attempts + timestamps) handed to a
// remote queue's `enqueue` over a REAL http transport. This exercises the actual serialization
// (DateTime ⇄ ISO string, etc.) and the server-side decode — i.e. what a zero-downtime handoff
// / A-B deploy would do. The in-memory contract tests use RpcTest; this proves the wire.
const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}
class HttpQueue extends QueueResource.Tag<HttpQueue>()("queue-http/Q", NumberItem) {}

// last entries the server received on `enqueue`, after crossing the wire and decoding.
const received: Array<QueueEntry<NumberItem>> = [];

// ref-field impls are Subscribables (a static one for this stub: current + a single-emit changes).
const sub = <A>(v: A) => ({ get: Effect.succeed(v), changes: Stream.make(v) });

const stub = {
  size: sub(0),
  isEmpty: sub(true),
  start: Effect.void,
  pause: Effect.void,
  resume: Effect.void,
  shutdown: Effect.void,
  clear: Effect.succeed(0),
  status: sub({
    sizes: { high: 0, normal: 0, low: 0 },
    paused: false,
    inFlight: 0,
    completed: 0,
    phase: "running" as const,
  }),
  metrics: {
    live: Stream.empty,
    history: () => Effect.succeed([]),
  },
  logs: {
    live: Stream.empty,
    history: () => Effect.succeed([]),
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
  }).pipe(Layer.provide(Resource.serveRemote(HttpQueue, stub))),
).pipe(
  Layer.provideMerge(RpcSerialization.layerNdjson),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const clientHttp = (port: number) =>
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
        Resource.client(HttpQueue).pipe(Layer.provide(clientHttp(port))),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(HttpQueueServer), Effect.scoped);
  return Effect.runPromise(program);
});
