import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// Node-in-tag over REAL http, using the batteries-included helpers: the tag carries its own
// transport (EdgeNode), the server is one `Resource.httpServer([serve(...)])` call, and the client wires the
// node with one `Resource.httpClient`. Ship ONLY the tag — `Resource.client(tag)` resolves
// where to connect from the node. Serialization defaults to ndjson on BOTH helpers, so the
// two sides can't disagree on the codec.
class EdgeNode extends Resource.Node<EdgeNode>("nodeHttp/edge") {}
class Echo extends Resource.Tag<Echo>()("nodeHttp/Echo", 
  {
    ping: Resource.effect(Schema.String),
    shout: Resource.effectFn({ msg: Schema.String }, Schema.String),
  },
  { node: EdgeNode },
) {}

// the whole server, collapsed — only the platform HttpServer is left to provide
const ServerLive = Resource.httpServer([
  Resource.serve(Echo, {
    ping: Effect.succeed("pong"),
    shout: ({ msg }) => Effect.succeed(msg.toUpperCase()),
  }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("drives a node-bearing resource over real http (ship only the tag)", () => {
  const program = Effect.gen(function* () {
    // the test server binds an ephemeral port; wire the node's transport against it
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((server) => server.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    const EdgeLive = Resource.httpClient(EdgeNode, {
      url: `http://127.0.0.1:${port}/rpc`,
    });

    yield* Effect.gen(function* () {
      const echo = yield* Echo;
      expect(yield* echo.ping).toBe("pong");
      expect(yield* echo.shout({ msg: "hi" })).toBe("HI");
    }).pipe(
      // ship only the tag: client(Echo) requires EdgeNode; httpClient(EdgeNode, …) supplies it.
      Effect.provide(Resource.client(Echo).pipe(Layer.provide(EdgeLive))),
      Effect.scoped,
    );
  }).pipe(Effect.provide(ServerLive), Effect.scoped);
  return Effect.runPromise(program as Effect.Effect<void, unknown>);
});
