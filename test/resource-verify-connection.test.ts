import { Duration, Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { QueueResource } from "../src";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// `Resource.verifyConnection(node)` is the eager reachability backstop (F3): it opens one bounded
// connection to the node's declared (or overridden) url and fails with `NodeUnreachable` if the peer
// isn't there — so a client fails fast at startup instead of hanging. Proven against a real ws AND http
// server (reachable → ok) and a dead port (→ NodeUnreachable), for both transports.
const Item = Schema.Struct({ n: Schema.Number });
interface Item {
  readonly n: number;
}
class VNode extends Node.Tag<VNode>("verify/node") {} // bare — url supplied per-check at runtime
class VQueue extends QueueResource.Tag<VQueue>()("verify/Q", { payload: Item, node: VNode }) {}

// Run `check(port)` against a live test server (its layer is inlined per-`it` so its type infers).
const onServer = (
  server: Layer.Layer<VQueue | HttpServer.HttpServer, unknown, never>,
  check: (port: number) => Effect.Effect<unknown, unknown, never>,
) =>
  Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* check(port);
  }).pipe(Effect.provide(server), Effect.scoped);

const wsSrv = Node.wsServer([
  QueueResource.serveMemory(VQueue, { effect: () => Effect.void }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
const httpSrv = Node.httpServer([
  QueueResource.serveMemory(VQueue, { effect: () => Effect.void }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

describe("Resource.verifyConnection", () => {
  it.live("verifyConnection succeeds against a reachable ws server", () =>
    onServer(wsSrv, (port) =>
      Resource.verifyConnection(VNode, { url: `ws://127.0.0.1:${port}/rpc` }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.live("verifyConnection succeeds against a reachable http server", () =>
    onServer(httpSrv, (port) =>
      Resource.verifyConnection(VNode, { url: `http://127.0.0.1:${port}/rpc` }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.live("verifyConnection fails with NodeUnreachable against a dead socket port", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Resource.verifyConnection(VNode, {
          url: "ws://127.0.0.1:1/rpc",
          timeout: "2 seconds",
        }).pipe(Effect.timeout(Duration.seconds(10))),
      );
      expectTaggedFailure(exit, "NodeUnreachable");
    }),
  );

  it.live("verifyConnection fails with NodeUnreachable against a dead http port", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Resource.verifyConnection(VNode, {
          url: "http://127.0.0.1:1/rpc",
          timeout: "2 seconds",
        }).pipe(Effect.timeout(Duration.seconds(10))),
      );
      expectTaggedFailure(exit, "NodeUnreachable");
    }),
  );
});
