import { Duration, Effect, Fiber, Layer, Schema, Scope, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { WorkPool } from "../src";
import type { QueueLayerConfig } from "../src/WorkPool";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// The WEBSOCKET remote path — the transport a browser dashboard actually uses (`{ protocol:
// "websocket" }`, so many live streams multiplex over one connection). The http path is covered by
// `queue-remote-http.test.ts`; this proves the SAME `WorkPool.serve` streams status + events to
// a ws client, and — importantly — that a protocol MISMATCH (http client → ws server) FAILS rather
// than silently dropping calls. That mismatch was a real dashboard bug (the example's producer spoke
// http against a ws server, `Effect.ignore`'d the failure, and enqueued nothing).
const Item = Schema.Struct({ n: Schema.Number });
interface Item {
  readonly n: number;
}
class WsQueue extends WorkPool.Tag<WsQueue>()("queue-remote-ws/Q", { payload: Item }) {}

// ws client transport (matches `Hyperlink.ws` / a `{protocol:"websocket"}` server).
const clientWs = (port: number) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );

// http client transport — the WRONG protocol for the ws server below (used by the mismatch test).
const httpProtocol = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const serveWs = (config: QueueLayerConfig<Item, void, never, never>) =>
  Node.wsServer([WorkPool.serveMemory(WsQueue, config)]).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
  );

// run `use` against the ws server, wired with `clientLayer(port)` for its transport.
const withServer = <A, E>(
  config: QueueLayerConfig<Item, void, never, never>,
  clientLayer: (port: number) => Layer.Layer<RpcClient.Protocol>,
  use: (port: number) => Effect.Effect<A, E, WsQueue | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* use(port).pipe(
      Effect.provide(Hyperlink.client(WsQueue).pipe(Layer.provide(clientLayer(port)))),
      Effect.scoped,
    );
  }).pipe(Effect.provide(serveWs(config)), Effect.scoped);

it("status.changes streams live over WebSocket as the engine processes", () =>
  Effect.runPromise(
    withServer({ effect: () => Effect.void }, clientWs, (_port) =>
      Effect.gen(function* () {
        const q = yield* WsQueue;
        const completed: number[] = [];
        const fib = yield* Stream.runForEach(q.status.changes, (s) =>
          Effect.sync(() => completed.push(s.completed)),
        ).pipe(Effect.forkScoped);
        yield* Effect.sleep("200 millis"); // establish the subscription
        yield* q.add({ n: 1 });
        yield* q.add({ n: 2 });
        yield* q.add({ n: 3 });
        yield* Effect.sleep("400 millis");
        yield* Fiber.interrupt(fib);
        // the initial snapshot plus at least one completion delta crossed the socket.
        expect(completed.length).toBeGreaterThan(1);
        expect(completed.at(-1)).toBeGreaterThan(0);
      }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  ));

it("events (Enqueued/Started/Completed) stream over WebSocket", () =>
  Effect.runPromise(
    withServer({ effect: () => Effect.void }, clientWs, (_port) =>
      Effect.gen(function* () {
        const q = yield* WsQueue;
        const tags: string[] = [];
        const fib = yield* Stream.runForEach(q.events, (e) =>
          Effect.sync(() => tags.push(e._tag)),
        ).pipe(Effect.forkScoped);
        yield* Effect.sleep("200 millis");
        yield* q.add({ n: 1 });
        yield* Effect.sleep("400 millis");
        yield* Fiber.interrupt(fib);
        expect(tags).toContain("Enqueued");
        expect(tags).toContain("Completed");
      }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  ));

it("MISMATCH: an http client against a {protocol:websocket} server FAILS as ProtocolMismatch", () =>
  Effect.runPromise(
    withServer({ effect: () => Effect.void }, httpProtocol, (_port) =>
      Effect.gen(function* () {
        const q = yield* WsQueue;
        // The bug: `q.add` over the wrong protocol used to fail and get `Effect.ignore`'d, so nothing
        // enqueued and the dashboard showed empty queues. Named ProtocolMismatch remap (loud-failures 4.2a).
        const exit = yield* Effect.exit(q.add({ n: 1 }));
        expectTaggedFailure(exit, "ProtocolMismatch");
      }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  ));
