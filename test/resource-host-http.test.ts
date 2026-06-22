import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { Resource, groupOf } from "../src/Resource";

// Host-in-tag over REAL http: the tag carries its own transport (EdgeHost), so a consumer
// ships ONLY the tag — `Resource.client(tag)` resolves where to connect from the host, and
// `Resource.host(EdgeHost, …)` wires the transport once. No per-call `provideService`, no
// ambient Protocol threaded by hand.
class EdgeHost extends Resource.Host<EdgeHost>("hostHttp/edge") {}
class Echo extends Resource.Tag<Echo>("hostHttp/Echo")(
  {
    ping: Resource.query(Schema.String),
    shout: Resource.mutate(Schema.String, { payload: { msg: Schema.String } }),
  },
  EdgeHost,
) {}

// The server side is unchanged by the host — it just mounts the contract group's handlers.
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

it("drives a host-bearing resource over real http (ship only the tag)", () => {
  const program = Effect.gen(function* () {
    // the test server binds an ephemeral port; wire the host's transport against it
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((server) => server.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    const EdgeLive = Resource.host(
      EdgeHost,
      RpcClient.layerProtocolHttp({
        url: `http://127.0.0.1:${port}/rpc`,
      }).pipe(
        Layer.provide(RpcSerialization.layerJson),
        Layer.provide(FetchHttpClient.layer),
      ),
    );

    yield* Effect.gen(function* () {
      const echo = yield* Echo;
      expect(yield* echo.ping).toBe("pong");
      expect(yield* echo.shout({ msg: "hi" })).toBe("HI");
    }).pipe(
      // ship only the tag: client(Echo) requires EdgeHost; host(EdgeHost, …) supplies it.
      Effect.provide(Resource.client(Echo).pipe(Layer.provide(EdgeLive))),
      Effect.scoped,
    );
  }).pipe(Effect.provide(ServerLive), Effect.scoped);
  return Effect.runPromise(program as Effect.Effect<void, unknown>);
});
