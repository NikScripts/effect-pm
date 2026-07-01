import { Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import { Combine, combineQuery } from "../src/MultiHost";
import * as Resource from "../src/Resource";

// combined fields are PLAIN queries; the layer implements them via Resource.peers + your own value.
class Database extends Resource.Tag<Database>()("test/peers/Database", {
  connections: Resource.query(Schema.Number),
  totalConnections: Resource.query(Schema.Number),
}) {}

const database = Resource.layer(Database, {
  connections: Effect.succeed(2),
  totalConnections: Effect.gen(function* () {
    const others = yield* combineQuery(
      yield* Resource.peers(Database),
      (p) => p.connections,
      Combine.sum,
    );
    return 2 + others; // self (2) + peers — you write self in
  }),
});

// the per-host peer clients (what peersLayer connects; here supplied explicitly via peersFrom)
const fakePeers = {
  ebwsl: { connections: Effect.succeed(5), totalConnections: Effect.succeed(0) },
  wnba: { connections: Effect.succeed(3), totalConnections: Effect.succeed(0) },
};

it("a combined field gathers peers (Resource.peers) + adds self; the layer discharges the capability", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      expect(yield* db.connections).toBe(2); // this instance only
      expect(yield* db.totalConnections).toBe(10); // self 2 + ebwsl 5 + wnba 3
    }).pipe(
      Effect.provide(database.pipe(Layer.provide(Resource.peersFrom(Database, fakePeers)))),
    ),
  ));
