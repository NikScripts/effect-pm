import { Duration, Effect, Layer, Schema, Scope, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { RpcClient } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Process, QueueResource, RunResource } from "../src";
import * as Resource from "../src/Resource";

// Transport conformance matrix: each resource type × {ws, http} must stream/respond over the wire, and
// a protocol MISMATCH (http client → ws server) must FAIL loudly rather than silently drop — the exact
// shape of the dashboard's "no live data" bug. Uses the shipped `Resource.protocolWebsocket` /
// `protocolHttp` client transports and `wsServer` / `httpServer`.

type Kind = "ws" | "http";
const proto = (kind: Kind, port: number): Layer.Layer<RpcClient.Protocol> =>
  kind === "ws"
    ? Resource.protocolWebsocket(`ws://127.0.0.1:${port}/rpc`)
    : Resource.protocolHttp(`http://127.0.0.1:${port}/rpc`);

// Serve `served` over `serverKind`, reach it with a `clientKind` transport, run `op`, return its value.
const remote = <A, E, R>(
  serverKind: Kind,
  clientKind: Kind,
  served: Layer.Layer<R, unknown, HttpServer.HttpServer>,
  clientTag: Layer.Layer<R, never, RpcClient.Protocol>,
  op: Effect.Effect<A, E, R | Scope.Scope>,
): Promise<A> => {
  const server = (
    serverKind === "ws" ? Resource.wsServer([served]) : Resource.httpServer([served])
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

// ── QueueResource ────────────────────────────────────────────────────────────────────────────────
const Item = Schema.Struct({ n: Schema.Number });
interface Item {
  readonly n: number;
}
class ConfQueue extends QueueResource.Tag<ConfQueue>()("conf/Q", { payload: Item }) {}
const queueServe = QueueResource.serveMemory(ConfQueue, { effect: () => Effect.void });
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

// ── Process ──────────────────────────────────────────────────────────────────────────────────────
class ConfProc extends Process.Tag<ConfProc>()("conf/P").pipe(Process.schedule([])) {}
const procServe = Process.serveMemory(ConfProc, { effect: Effect.void });
const procOp = Effect.gen(function* () {
  const proc = yield* ConfProc;
  // read the current snapshot off the changes stream (the ref's replayed head), proving control-plane
  // state crosses the wire.
  const snap = yield* Stream.runHead(proc.status.changes).pipe(
    Effect.flatMap((o) => (o._tag === "Some" ? Effect.succeed(o.value) : Effect.die("no snapshot"))),
    Effect.timeout(Duration.seconds(3)),
  );
  return typeof snap.supervising === "boolean";
});

// ── RunResource ──────────────────────────────────────────────────────────────────────────────────
class ConfGate extends RunResource.Tag<ConfGate>()("conf/G", {
  payload: Schema.Number,
  success: Schema.Number,
}) {}
const gateServe = RunResource.serveMemory(ConfGate, {
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
    remote(kind, kind, queueServe, Resource.client(ConfQueue), queueOp).then((r) =>
      expect(r).toBeGreaterThan(0),
    ),
  );
  it.each(["ws", "http"] as const)("process over %s", (kind) =>
    remote(kind, kind, procServe, Resource.client(ConfProc), procOp).then((r) =>
      expect(r).toBe(true),
    ),
  );
  it.each(["ws", "http"] as const)("run over %s", (kind) =>
    remote(kind, kind, gateServe, Resource.client(ConfGate), gateOp).then((r) =>
      expect(r).toBe(42),
    ),
  );
});

describe("transport conformance: an http client against a ws server FAILS loudly", () => {
  // `remote` rejects when the wire op fails; a mismatch must reject (not resolve = silently drop).
  const rejects = <A, E, R>(
    served: Layer.Layer<R, unknown, HttpServer.HttpServer>,
    clientTag: Layer.Layer<R, never, RpcClient.Protocol>,
    op: Effect.Effect<A, E, R | Scope.Scope>,
  ): Promise<boolean> =>
    remote("ws", "http", served, clientTag, op).then(
      () => false,
      () => true,
    );

  it("queue mismatch fails", () =>
    rejects(queueServe, Resource.client(ConfQueue), queueOp).then((r) => expect(r).toBe(true)));
  it("run mismatch fails", () =>
    rejects(gateServe, Resource.client(ConfGate), gateOp).then((r) => expect(r).toBe(true)));
});
