import { Duration, Effect, Layer, Schema } from "effect";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { QueueResource } from "../src";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// `Resource.verifyConnection(node)` is the eager reachability backstop (F3): tier-1 opens one
// bounded transport connection; `{ deep: true }` escalates to NodeStatus RPC classification.
const Item = Schema.Struct({ n: Schema.Number });
interface Item {
  readonly n: number;
}
class VNode extends Node.Tag<VNode>()("verify/node") {} // bare — url supplied per-check at runtime
class VQueue extends QueueResource.Tag<VQueue>()("verify/Q", { payload: Item, node: VNode }) {}

class Warming extends Resource.Tag<Warming>()("verify/Warming", {
  ping: Resource.effect(Schema.String),
}).pipe(
  Resource.withReadiness(() => Effect.succeed({ ready: false, detail: "warming up" })),
) {}

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

const onWarmingServer = (
  check: (port: number) => Effect.Effect<unknown, unknown, never>,
) => {
  const server = Node.httpServer([
    Resource.serve(Warming, { ping: Effect.succeed("pong") }),
  ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
  return Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* check(port);
  }).pipe(Effect.provide(server), Effect.scoped);
};

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

  it.live("deep verifyConnection succeeds against a live NodeStatus http server", () =>
    onServer(httpSrv, (port) =>
      Resource.verifyConnection(VNode, {
        url: `http://127.0.0.1:${port}/rpc`,
        deep: true,
      }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.live("deep verifyConnection succeeds against a live NodeStatus ws server", () =>
    onServer(wsSrv, (port) =>
      Resource.verifyConnection(VNode, {
        url: `ws://127.0.0.1:${port}/rpc`,
        deep: true,
      }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.live("deep verifyConnection fails ProtocolUnanswered when only bare HTTP answers", () =>
    Effect.gen(function* () {
      const server = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      });
      const port = yield* Effect.acquireRelease(
        Effect.callback<number>((resume) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            resume(
              Effect.succeed(
                typeof addr === "object" && addr !== null ? addr.port : 0,
              ),
            );
          });
        }),
        () =>
          Effect.callback<void>((resume) => {
            server.close(() => resume(Effect.void));
          }),
      );
      const exit = yield* Effect.exit(
        Resource.verifyConnection(VNode, {
          url: `http://127.0.0.1:${port}/rpc`,
          deep: true,
          timeout: "2 seconds",
        }).pipe(Effect.timeout(Duration.seconds(10))),
      );
      expectTaggedFailure(exit, "ProtocolUnanswered");
    }).pipe(Effect.scoped),
  );

  it.live("deep verifyConnection fails ServiceNotServed for a missing resource key", () =>
    onWarmingServer((port) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          Resource.verifyConnection(VNode, {
            url: `http://127.0.0.1:${port}/rpc`,
            deep: true,
            resource: "verify/Missing",
          }),
        );
        expectTaggedFailure(exit, "ServiceNotServed");
      }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.live("deep verifyConnection fails ServiceNotReady when the resource is degraded", () =>
    onWarmingServer((port) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          Resource.verifyConnection(VNode, {
            url: `http://127.0.0.1:${port}/rpc`,
            deep: true,
            resource: "verify/Warming",
          }),
        );
        expectTaggedFailure(exit, "ServiceNotReady");
      }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.live("deep verifyConnection succeeds when the target resource is ready", () =>
    onServer(httpSrv, (port) =>
      Resource.verifyConnection(VNode, {
        url: `http://127.0.0.1:${port}/rpc`,
        deep: true,
        resource: "verify/Q",
      }),
    ).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.live("verifyConnection uses selectEndpoint on a multi-protocol node", () =>
    Effect.gen(function* () {
      const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = address._tag === "TcpAddress" ? address.port : 0;
      // Http+ws declared; only http is live — selectEndpoint (node) prefers Http, so tier-1 ok.
      class Dual extends Node.Tag<Dual>()("verify/dual", {
        http: `http://127.0.0.1:${port}/rpc`,
        ws: `ws://127.0.0.1:1/rpc`,
      }) {}
      yield* Resource.verifyConnection(Dual);
      // `{ all: true }` also probes the dead ws endpoint → NodeUnreachable.
      const exit = yield* Effect.exit(
        Resource.verifyConnection(Dual, { all: true, timeout: "2 seconds" }),
      );
      expectTaggedFailure(exit, "NodeUnreachable");
    }).pipe(Effect.provide(httpSrv), Effect.scoped, Effect.timeout(Duration.seconds(10))),
  );
});

describe("Resource.client default-on verify", () => {
  it.live("addressed client fails Layer build when the peer is down", () =>
    Effect.gen(function* () {
      class Dead extends Node.Tag<Dead>()("verify/dead-client", {
        url: "http://127.0.0.1:1/rpc",
      }) {}
      class Ping extends Resource.Tag<Ping>()("verify/dead-Ping", {
        ping: Resource.effect(Schema.String),
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(Resource.client(Ping, Dead)).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "NodeUnreachable");
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );

  it.live("clientVerify(false) skips the probe", () =>
    Effect.gen(function* () {
      class Dead extends Node.Tag<Dead>()("verify/skip-dead", {
        url: "http://127.0.0.1:1/rpc",
      }) {}
      class Ping extends Resource.Tag<Ping>()("verify/skip-Ping", {
        ping: Resource.effect(Schema.String),
      }) {}
      // Build succeeds; RPC would still fail later — verify was opted out.
      yield* Layer.build(
        Resource.client(Ping, Dead).pipe(
          Layer.provide(Resource.clientVerify(false)),
        ),
      );
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.live("addressed client builds when the peer is up", () =>
    onServer(httpSrv, (port) =>
      Effect.gen(function* () {
        class Live extends Node.Tag<Live>()("verify/live-client", {
          url: `http://127.0.0.1:${port}/rpc`,
        }) {}
        yield* Layer.build(Resource.client(VQueue, Live));
      }).pipe(Effect.scoped),
    ).pipe(Effect.timeout(Duration.seconds(15))),
  );
});
