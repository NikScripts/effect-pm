import { Duration, Effect, Exit, Layer, Schema, Scope, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { RpcClient } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Daemon, WorkPool, Gate } from "../src";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// Transport conformance matrix: each resource type × {ws, http} must stream/respond over the wire, and
// a protocol MISMATCH (http client → ws server) must FAIL loudly rather than silently drop — the exact
// shape of the dashboard's "no live data" bug. Uses the shipped `Hyperlink.protocolWebsocket` /
// `protocolHttp` client transports and `wsServer` / `httpServer`.

type Kind = "ws" | "http";
const proto = (kind: Kind, port: number): Layer.Layer<RpcClient.Protocol> =>
  kind === "ws"
    ? Hyperlink.protocolWebsocket(`ws://127.0.0.1:${port}/rpc`)
    : Hyperlink.protocolHttp(`http://127.0.0.1:${port}/rpc`);

// Serve `served` over `serverKind`, reach it with a `clientKind` transport, run `op`, return its value.
const remote = <A, E, R>(
  serverKind: Kind,
  clientKind: Kind,
  served: Layer.Layer<R, never, HttpServer.HttpServer>,
  clientTag: Layer.Layer<R, never, RpcClient.Protocol>,
  op: Effect.Effect<A, E, R | Scope.Scope>,
): Promise<A> => {
  const server = (
    serverKind === "ws" ? Node.wsServer([served]) : Node.httpServer([served])
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
  return Effect.runPromise(
    Effect.gen(function* () {
      const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = address._tag === "TcpAddress" ? address.port : 0;
      return yield* op.pipe(
        Effect.provide(clientTag.pipe(Layer.provide(proto(clientKind, port)))),
        Effect.scoped,
      );
    }).pipe(Effect.provide(server), Effect.scoped, Effect.timeout(Duration.seconds(10))),
  );
};

// ── WorkPool ────────────────────────────────────────────────────────────────────────────────
const Item = Schema.Struct({ n: Schema.Number });
interface Item {
  readonly n: number;
}
class ConfQueue extends WorkPool.Tag<ConfQueue>()("conf/Q", { payload: Item }) {}
const queueServe = WorkPool.serveMemory(ConfQueue, { effect: () => Effect.void });
const queueOp = Effect.gen(function* () {
  const q = yield* ConfQueue;
  const completed: number[] = [];
  yield* Stream.runForEach(q.status.changes, (s) =>
    Effect.sync(() => completed.push(s.completed)),
  ).pipe(Effect.forkScoped);
  yield* Effect.sleep("200 millis");
  yield* q.add({ n: 1 });
  yield* q.add({ n: 2 });
  yield* Effect.sleep("400 millis");
  return completed.at(-1) ?? 0;
});

// ── Daemon ──────────────────────────────────────────────────────────────────────────────────────
class ConfDaemon extends Daemon.Tag<ConfDaemon>()("conf/P").pipe(Daemon.schedule([])) {}
const ConfDaemonEffect: Effect.Effect<Effect.Success<typeof ConfDaemon>, never, ConfDaemon> =
  ConfDaemon;
const daemonServe = Daemon.serveMemory(ConfDaemon, { effect: Effect.void });
const daemonOp = Effect.gen(function* () {
  const daemon = yield* ConfDaemonEffect;
  // read the current snapshot off the changes stream (the ref's replayed head), proving control-plane
  // state crosses the wire.
  const snap = yield* Stream.runHead(daemon.status.changes).pipe(
    Effect.flatMap((o) => (o._tag === "Some" ? Effect.succeed(o.value) : Effect.die("no snapshot"))),
    Effect.timeout(Duration.seconds(3)),
  );
  return typeof snap.supervising === "boolean";
});

// ── Gate ──────────────────────────────────────────────────────────────────────────────────
class ConfGate extends Gate.Tag<ConfGate>()("conf/G", {
  payload: Schema.Number,
  success: Schema.Number,
}) {}
const gateServe = Gate.serveMemory(ConfGate, {
  effect: (n: number) => Effect.succeed(n * 2),
});
const gateOp = Effect.gen(function* () {
  const gate = yield* ConfGate;
  return yield* gate.run(21);
});

// Promise-returning (not `async`) test bodies — the codebase convention (the effect-LSP `asyncFunction`
// rule steers async control flow to Effect; here the assertion just rides the promise `remote` returns).
describe("transport conformance: streams/responds over BOTH transports", () => {
  it.each(["ws", "http"] as const)("queue over %s", (kind) =>
    remote(kind, kind, queueServe, Hyperlink.client(ConfQueue), queueOp).then((r) =>
      expect(r).toBeGreaterThan(0),
    ),
  );
  it.each(["ws", "http"] as const)("daemon over %s", (kind) =>
    remote(kind, kind, daemonServe, Hyperlink.client(ConfDaemon), daemonOp).then((r) =>
      expect(r).toBe(true),
    ),
  );
  it.each(["ws", "http"] as const)("run over %s", (kind) =>
    remote(kind, kind, gateServe, Hyperlink.client(ConfGate), gateOp).then((r) =>
      expect(r).toBe(42),
    ),
  );
});

describe("transport conformance: an http client against a ws server FAILS as ProtocolMismatch", () => {
  // Loud-failures §5 / 4.2a — mismatch must fail with the tagged ProtocolMismatch, not silently drop.
  const mismatchExit = <A, E, R>(
    served: Layer.Layer<R, never, HttpServer.HttpServer>,
    clientTag: Layer.Layer<R, never, RpcClient.Protocol>,
    op: Effect.Effect<A, E, R | Scope.Scope>,
  ): Promise<Exit.Exit<A, E>> => {
    const server = Node.wsServer([served]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
    return Effect.runPromise(
      Effect.gen(function* () {
        const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = address._tag === "TcpAddress" ? address.port : 0;
        return yield* Effect.exit(
          op.pipe(
            Effect.provide(clientTag.pipe(Layer.provide(proto("http", port)))),
            Effect.scoped,
          ),
        );
      }).pipe(Effect.provide(server), Effect.scoped, Effect.timeout(Duration.seconds(10))),
    );
  };

  // Single RPC call — avoid stream subscribe races so the tagged remap is what we assert.
  const queueAdd = Effect.flatMap(ConfQueue, (q) => q.add({ n: 1 }));
  const gateRun = Effect.flatMap(ConfGate, (g) => g.run(1));

  it("queue mismatch → ProtocolMismatch", () =>
    mismatchExit(queueServe, Hyperlink.client(ConfQueue), queueAdd).then((exit) =>
      expectTaggedFailure(exit, "ProtocolMismatch"),
    ));
  it("run mismatch → ProtocolMismatch", () =>
    mismatchExit(gateServe, Hyperlink.client(ConfGate), gateRun).then((exit) =>
      expectTaggedFailure(exit, "ProtocolMismatch"),
    ));
});
