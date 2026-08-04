import { Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import { combineQuery, combineSum } from "../src/MultiNode";
import * as Hyperlink from "../src/Hyperlink";

// combined fields are plain queries, tagged `fleet` (so peers exclude them); the layer implements them
// via Hyperlink.peers + your own value.
class Database extends Hyperlink.Service<Database>()("test/peers/Database", {
  connections: Hyperlink.effect(Schema.Number),
  totalConnections: Hyperlink.effect(Schema.Number).pipe(Hyperlink.fleet),
}) {}

// build the impl effectfully (the Effect form of Hyperlink.layer): resolve peers once; the members
// close over the clients and combined fields are plain queries implemented via combineQuery + self.
const database = Hyperlink.layer(
  Database,
  Effect.gen(function* () {
    const peers = yield* Hyperlink.peers(Database);
    return {
      connections: Effect.succeed(2),
      totalConnections: combineQuery(peers, (p) => p.connections, combineSum).pipe(
        Effect.map((others) => 2 + others), // self (2) + peers — you write self in
      ),
    };
  }),
);

// the per-node peer clients (leaf fields only — peers exclude fleet fields); supplied via peersFrom
const fakePeers = {
  ebwsl: { connections: Effect.succeed(5) },
  wnba: { connections: Effect.succeed(3) },
};

it("peers exclude fleet fields at compile time (the footgun is a type error)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ps = yield* Hyperlink.peers(Database);
      const p = ps.ebwsl;
      if (p !== undefined) {
        expect(yield* p.connections).toBe(5); // leaf field — exposed to peers
        // @ts-expect-error — totalConnections is a `fleet` field, excluded from peers (no fan-out)
        void p.totalConnections;
      }
    }).pipe(Effect.provide(Hyperlink.peersFrom(Database, fakePeers))),
  ));

it("a combined field gathers peers (Hyperlink.peers) + adds self; the layer discharges the capability", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      expect(yield* db.connections).toBe(2); // this instance only
      expect(yield* db.totalConnections).toBe(10); // self 2 + ebwsl 5 + wnba 3
    }).pipe(
      Effect.provide(database.pipe(Layer.provide(Hyperlink.peersFrom(Database, fakePeers)))),
    ),
  ));
