import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// Set-of-one fleet via distributed/nodes — C1 syncs nodeSym so client(Tag) would bind DbNode;
// this test still names the node explicitly: client(tag, node).
class DbNode extends Node.Tag<DbNode>()("nodeless-client/DbNode") {}
class FleetDatabase extends Hyperlink.Tag<FleetDatabase>()("nodeless-client/FleetDatabase", {
  status: Hyperlink.effect(Schema.Boolean),
}).pipe(
  Hyperlink.nodes([DbNode]),
) {}

const Server = Node.httpServer([
  Hyperlink.serve(FleetDatabase, { status: Effect.succeed(true) }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

// The fix for #3: a nodeless tag has N instances, so the *client* names which one — `client(tag, node)`.
// The transport resolves from that node service, so the layer requires the node (satisfied by
// http) — the requirement is enforced at compile time, so it can't fail at runtime with a
// "Service not found: RpcClient/Protocol" the way `client(tag)` (ambient Protocol) did when wired to a
// node service instead.
describe("hostless client(tag, node)", () => {
  it.effect("a nodeless distributed tag is client-readable by naming the node: client(tag, node)", () =>
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((server) => server.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const transport = Hyperlink.http(DbNode, {
        url: `http://127.0.0.1:${port}/rpc`,
      });
      yield* Effect.gen(function* () {
        const db = yield* FleetDatabase;
        expect(yield* db.status).toBe(true); // read the instance on DbNode over the wire
      }).pipe(
        Effect.provide(Hyperlink.client(FleetDatabase, DbNode).pipe(Layer.provide(transport))),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  );
});
