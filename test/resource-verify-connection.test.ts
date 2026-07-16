import { Duration, Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { QueueResource } from "../src";
import * as Resource from "../src/Resource";

// `Resource.verifyConnection(node)` is the eager reachability backstop (F3): it opens one bounded
// connection to the node's declared (or overridden) url and fails with `NodeUnreachable` if the peer
// isn't there — so a client fails fast at startup instead of hanging. Proven against a real ws AND http
// server (reachable → ok) and a dead port (→ NodeUnreachable), for both transports.
const Item = Schema.Struct({ n: Schema.Number });
interface Item {
  readonly n: number;
}
class VNode extends Resource.Node<VNode>("verify/node") {} // bare — url supplied per-check at runtime
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

const wsSrv = Resource.wsServer([
  QueueResource.serveMemory(VQueue, { effect: () => Effect.void }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
const httpSrv = Resource.httpServer([
  QueueResource.serveMemory(VQueue, { effect: () => Effect.void }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("verifyConnection succeeds against a reachable ws server", () =>
  Effect.runPromise(
    onServer(wsSrv, (port) =>
      Resource.verifyConnection(VNode, { url: `ws://127.0.0.1:${port}/rpc` }),
    ).pipe(Effect.timeout(Duration.seconds(10)), Effect.as("ok")),
  ).then((r) => expect(r).toBe("ok")));

it("verifyConnection succeeds against a reachable http server", () =>
  Effect.runPromise(
    onServer(httpSrv, (port) =>
      Resource.verifyConnection(VNode, { url: `http://127.0.0.1:${port}/rpc` }),
    ).pipe(Effect.timeout(Duration.seconds(10)), Effect.as("ok")),
  ).then((r) => expect(r).toBe("ok")));

it("verifyConnection fails with NodeUnreachable against a dead socket port", () =>
  Effect.runPromise(
    Effect.exit(
      Resource.verifyConnection(VNode, { url: "ws://127.0.0.1:1/rpc", timeout: "2 seconds" }).pipe(
        Effect.timeout(Duration.seconds(10)),
      ),
    ),
  ).then((exit) => {
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("NodeUnreachable");
  }));

it("verifyConnection fails with NodeUnreachable against a dead http port", () =>
  Effect.runPromise(
    Effect.exit(
      Resource.verifyConnection(VNode, { url: "http://127.0.0.1:1/rpc", timeout: "2 seconds" }).pipe(
        Effect.timeout(Duration.seconds(10)),
      ),
    ),
  ).then((exit) => {
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("NodeUnreachable");
  }));
