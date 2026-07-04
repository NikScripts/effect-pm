import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// a nodeless multi-node tag (no `{ node }`) — the fleet is on the tag, but the tag names no single node.
class DbNode extends Resource.Node<DbNode>("nodeless-client/DbNode") {}
class FleetDatabase extends Resource.Tag<FleetDatabase>()("nodeless-client/FleetDatabase", {
  status: Resource.effect(Schema.Boolean),
}).pipe(
  Resource.distributed([DbNode]),
) {}

const Server = Resource.httpServer([
  Resource.serve(FleetDatabase, { status: Effect.succeed(true) }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

// The fix for #3: a nodeless tag has N instances, so the *client* names which one — `client(tag, node)`.
// The transport resolves from that node service, so the layer requires the node (satisfied by
// httpClient) — the requirement is enforced at compile time, so it can't fail at runtime with a
// "Service not found: RpcClient/Protocol" the way `client(tag)` (ambient Protocol) did when wired to a
// node service instead.
it("a nodeless distributed tag is client-readable by naming the node: client(tag, node)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((server) => server.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const transport = Resource.httpClient(DbNode, {
        url: `http://127.0.0.1:${port}/rpc`,
      });
      yield* Effect.gen(function* () {
        const db = yield* FleetDatabase;
        expect(yield* db.status).toBe(true); // read the instance on DbNode over the wire
      }).pipe(
        Effect.provide(Resource.client(FleetDatabase, DbNode).pipe(Layer.provide(transport))),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));
