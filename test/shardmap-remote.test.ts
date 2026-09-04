import { Duration, Effect, Layer, Option, Schema, Scope } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { RpcClient } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { ShardMap } from "../src";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// Extends the transport conformance matrix to the last resource type — ShardMap must put/get over the
// wire (both transports) and FAIL loudly on a protocol mismatch, same as queue/daemon/gate. ShardMap's
// remote path is heavier (SQL-backed shard + peers/selfNode), so it lives in its own file.

const Session = Schema.Struct({ id: Schema.String, userId: Schema.String });
class Node1 extends Node.Service<Node1>()("shardconf/n1") {}
class SM extends ShardMap.Service<SM>()("shardconf/SM", {
  key: Schema.String,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(Hyperlink.nodes([Node1])) {}

const served = ShardMap.serve(SM).pipe(Layer.provide(Hyperlink.peersLayer(SM, Node1)));

type Kind = "ws" | "http";
const proto = (kind: Kind, port: number): Layer.Layer<RpcClient.Protocol> =>
  kind === "ws"
    ? Hyperlink.protocolWebsocket(`ws://127.0.0.1:${port}/rpc`)
    : Hyperlink.protocolHttp(`http://127.0.0.1:${port}/rpc`);

const remote = <A, E>(
  serverKind: Kind,
  clientKind: Kind,
  op: Effect.Effect<A, E, SM | Scope.Scope>,
): Promise<A> => {
  const server = (
    serverKind === "ws" ? Node.wsServer([served]) : Node.httpServer([served])
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
  return Effect.runPromise(
    Effect.gen(function* () {
      const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = address._tag === "TcpAddress" ? address.port : 0;
      // C1: distributed([Node1]) is set-of-one — dial via that Node (not ambient Protocol).
      return yield* op.pipe(
        Effect.provide(
          Hyperlink.client(SM, Node1).pipe(
            Layer.provide(Node.connect(Node1, proto(clientKind, port))),
          ),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(server), Effect.scoped, Effect.timeout(Duration.seconds(10))),
  );
};

const putGet = Effect.gen(function* () {
  const sm = yield* SM;
  yield* sm.put({ id: "k1", userId: "u1" });
  const got = yield* sm.get("k1");
  return Option.isSome(got) ? got.value.userId : "miss";
});

describe("transport conformance: ShardMap put/get over the wire", () => {
  it.each(["ws", "http"] as const)("shardmap over %s", (kind) =>
    remote(kind, kind, putGet).then((r) => expect(r).toBe("u1")),
  );
  it("shardmap mismatch (http client → ws server) fails", () =>
    remote("ws", "http", putGet).then(
      () => false,
      () => true,
    ).then((failed) => expect(failed).toBe(true)),
  );
});
