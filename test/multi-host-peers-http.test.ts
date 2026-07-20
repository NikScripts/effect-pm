import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { combineQuery, combineSum } from "../src/MultiNode";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

class DbNode extends Node.Tag<DbNode>("peers-http/node") {}
class Database extends Resource.Tag<Database>()(
  "peers-http/Database",
  {
    connections: Resource.effect(Schema.Number),
    totalConnections: Resource.effect(Schema.Number).pipe(Resource.fleet), // gathered in the layer
  },
  { node: DbNode },
) {}

// the other nodes' clients (leaf fields only), as peersLayer would connect them — fake here, no 2nd
// server needed to prove the wire path: client → this server → its peers-gather → response.
const fakePeers = {
  ebwsl: { connections: Effect.succeed(5) },
  wnba: { connections: Effect.succeed(3) },
};

const Server = Node.httpServer([
  Resource.serve(
    Database,
    Effect.gen(function* () {
      const peers = yield* Resource.peers(Database);
      return {
        connections: Effect.succeed(2),
        totalConnections: combineQuery(peers, (p) => p.connections, combineSum).pipe(
          Effect.map((others) => 2 + others),
        ),
      };
    }),
  ),
]).pipe(
  Layer.provide(Resource.peersFrom(Database, fakePeers)), // discharge the peers capability at the serve
  Layer.provideMerge(NodeHttpServer.layerTest),
);

it("serves a peers-gathering combined field over http; a client gets the fleet total", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const transport = Resource.httpClient(DbNode, { url: `http://127.0.0.1:${port}/rpc` });
      yield* Effect.gen(function* () {
        const db = yield* Database;
        expect(yield* db.connections).toBe(2); // this instance
        expect(yield* db.totalConnections).toBe(10); // server gathered its peers + self, over the wire
      }).pipe(
        Effect.provide(Resource.client(Database).pipe(Layer.provide(transport))),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));
