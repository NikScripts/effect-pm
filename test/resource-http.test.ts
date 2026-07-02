import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import { groupOf } from "../src/Resource";

// The toolkit driven over a REAL http transport (not the in-memory RpcTest path): the same
// `yield* Tag` code, the real `Resource.server` mounted on an http RpcServer, and the real
// `Resource.client` forwarding over `RpcClient`'s http protocol.
class Echo extends Resource.Tag<Echo>()("http/Echo", {
  ping: Resource.effect(Schema.String),
  shout: Resource.effectFn(Schema.String, { payload: { msg: Schema.String } }),
}) {}

const ServerLive = HttpRouter.serve(
  RpcServer.layerHttp({
    group: groupOf(Echo),
    path: "/rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(
      Resource.server(Echo, {
        ping: Effect.succeed("pong"),
        shout: ({ msg }) => Effect.succeed(msg.toUpperCase()),
      }),
    ),
  ),
).pipe(
  Layer.provideMerge(RpcSerialization.layerJson),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

it("drives a resource over real http (server + client through the toolkit)", () => {
  const program = Effect.gen(function* () {
    // the test server binds an ephemeral port; build the client transport against it
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((server) => server.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    const httpProtocol = RpcClient.layerProtocolHttp({
      url: `http://127.0.0.1:${port}/rpc`,
    }).pipe(
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(FetchHttpClient.layer),
    );

    yield* Effect.gen(function* () {
      const echo = yield* Echo;
      expect(yield* echo.ping).toBe("pong");
      expect(yield* echo.shout({ msg: "hi" })).toBe("HI");
    }).pipe(
      Effect.provide(Resource.client(Echo).pipe(Layer.provide(httpProtocol))),
      Effect.scoped,
    );
  }).pipe(Effect.provide(ServerLive), Effect.scoped);
  return Effect.runPromise(program as Effect.Effect<void, unknown>);
});
