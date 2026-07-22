import { Duration, Effect, Fiber, Layer, Option, Schema, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { HistoryStore, QueueHyperlink } from "../src";
import type { QueueLayerConfig } from "../src/QueueHyperlink";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// The full remote path: a REAL toolkit QueueHyperlink engine served over http via
// `httpServer([QueueHyperlink.serveMemory(...)])`, driven by `Hyperlink.client` over the wire. The same `yield* Tag`
// surface a local consumer uses — only the provided layer differs. This proves "remote queue
// usage, all pieces together": control (add/pause), reads (completed/status.get), the rich-entry
// handoff (release), and a live stream (status) all crossing real RPC.
const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}
class RemoteQueue extends QueueHyperlink.Tag<RemoteQueue>()("queue-remote/Q", {
  payload: NumberItem,
}) {}

// client transport: http + ndjson (matches the server's default serialization).
const clientHttp = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

// run `use` against a real engine served over http with the given worker config.
const withServer = <A, E>(
  config: QueueLayerConfig<NumberItem, void, never, never>,
  use: (port: number) => Effect.Effect<A, E, RemoteQueue>,
) => {
  const server = Node.httpServer([
    QueueHyperlink.serveMemory(RemoteQueue, config),
  ]).pipe(
    // server-side history backend for metrics backfill
    Layer.provide(HistoryStore.layerMemory()),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  return Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((s) => s.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* use(port).pipe(
      Effect.provide(
        Hyperlink.client(RemoteQueue).pipe(Layer.provide(clientHttp(port))),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(server), Effect.scoped);
};

it("add (single + batch) over http → real engine processes → completed/status.get round-trip", () =>
  Effect.runPromise(
    withServer({ effect: (_item) => Effect.void, concurrency: 2 }, (_port) =>
      Effect.gen(function* () {
        const queue = yield* RemoteQueue;
        yield* queue.add({ n: 1 }); // item directly, over the wire
        yield* queue.add([{ n: 2 }, { n: 3 }]); // batch in one RPC call
        // the server-side engine processes them; observe the live status `value` via its delta
        // stream (current snapshot first, then updates) as it crosses RPC.
        const drained = yield* Stream.runHead(
          Stream.filter(
            queue.status.changes,
            (s) => s.completed >= 3,
          ),
        );
        const snap = Option.getOrThrow(drained);
        expect(snap.completed).toBe(3);
        expect(snap.sizes).toEqual({ high: 0, normal: 0, low: 0 });
        expect(snap.phase).toBe("running");
      }),
    )));

it("metricsHistory crosses http (the dashboard's backfill path)", () =>
  Effect.runPromise(
    withServer(
      {
        effect: (item) => Effect.logInfo(`processed ${item.n}`),
        concurrency: 1,
      },
      (_port) =>
        Effect.gen(function* () {
          const queue = yield* RemoteQueue;
          yield* queue.add([{ n: 1 }, { n: 2 }]);
          yield* Stream.runDrain(
            Stream.takeUntil(
              queue.status.changes,
              (s) => s.completed >= 2,
            ),
          );
          const metrics = yield* queue.metrics.query({});
          expect(Array.isArray(metrics)).toBe(true);
        }),
    )));

it("release handoff round-trips full entries (item + metadata) over http", () =>
  // autoStart:false → no workers, so added items stay PENDING for release to export.
  Effect.runPromise(
    withServer({ effect: (_item) => Effect.void, autoStart: false }, (_port) =>
      Effect.gen(function* () {
        const queue = yield* RemoteQueue;
        yield* queue.add([{ n: 10 }, { n: 11 }]);
        const released = yield* queue.release({});
        // entries crossed the wire with item + priority + attempts + timestamps intact
        expect(released.map((e) => e.item.n).sort((a, b) => a - b)).toEqual([
          10, 11,
        ]);
        expect(released.every((e) => e.priority === "normal")).toBe(true);
        expect(released.every((e) => typeof e.attempts === "number")).toBe(true);
        expect(
          released.every((e) => e.timestamps.enqueuedAt !== undefined),
        ).toBe(true);
      }),
    )));

it("the status stream flows over http from the real engine", () =>
  Effect.runPromise(
    withServer({ effect: (_item) => Effect.void, autoStart: false }, (_port) =>
      Effect.gen(function* () {
        const queue = yield* RemoteQueue;
        const collected = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.take(
              Stream.filter(
                queue.status.changes,
                (s) => s.sizes.normal >= 2,
              ),
              1,
            ),
          ),
        );
        yield* Effect.sleep(Duration.millis(20));
        yield* queue.add([{ n: 1 }, { n: 2 }]); // no workers → stay pending → normal:2
        const snap = Array.from(yield* Fiber.join(collected))[0];
        expect(snap?.sizes.normal).toBeGreaterThanOrEqual(2);
      }),
    )));
