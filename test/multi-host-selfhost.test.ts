import { Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import { combineByNode, combineQuery } from "../src/MultiNode";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

class NwslNode extends Node.Service<NwslNode>()("selfnode/NwslNode") {}

// a fleet health view: `status` per instance, `fleetStatus` a per-node map (combineByNode)
class FleetDatabase extends Hyperlink.Service<FleetDatabase>()("selfnode/FleetDatabase", {
  status: Hyperlink.effect(Schema.Boolean),
  fleetStatus: Hyperlink.effect(Schema.Record(Schema.String, Schema.Boolean)).pipe(Hyperlink.fleet),
}) {}

// the impl keys its OWN row with `selfNode` — no hand-threaded node key
const database = Hyperlink.layer(
  FleetDatabase,
  Effect.gen(function* () {
    const self = yield* Hyperlink.selfNode(FleetDatabase);
    const peers = yield* Hyperlink.peers(FleetDatabase);
    return {
      status: Effect.succeed(true),
      fleetStatus: Effect.gen(function* () {
        const byNode = yield* combineQuery(peers, (peer) => peer.status, combineByNode);
        return { ...byNode, [self]: true }; // self keyed the same way peers are
      }),
    };
  }),
);

// peers keyed by node key, exactly as peersLayer keys them
const fakePeers = {
  "selfnode/EbwslNode": { status: Effect.succeed(false) },
  "selfnode/WnbaNode": { status: Effect.succeed(true) },
};

it("selfNode keys the own row consistently with peer keys in a byNode fold", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* FleetDatabase;
      const fleet = yield* db.fleetStatus;
      expect(fleet).toEqual({
        "selfnode/NwslNode": true, // self, via Hyperlink.selfNode — same key shape as peers
        "selfnode/EbwslNode": false, // peer
        "selfnode/WnbaNode": true, // peer
      });
    }).pipe(
      Effect.provide(
        database.pipe(
          Layer.provide(Hyperlink.peersFrom(FleetDatabase, fakePeers)),
          Layer.provide(Hyperlink.selfNodeLayer(FleetDatabase, NwslNode)),
        ),
      ),
    ),
  ));

it("Hyperlink.fleetHealth cans the byNode fold + adds self", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const byNode = yield* Hyperlink.fleetHealth(
        FleetDatabase,
        (peer) => peer.status,
        Effect.succeed(true), // this node's own value
      );
      expect(byNode).toEqual({
        "selfnode/NwslNode": true, // self
        "selfnode/EbwslNode": false, // peer
        "selfnode/WnbaNode": true, // peer
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Hyperlink.peersFrom(FleetDatabase, fakePeers),
          Hyperlink.selfNodeLayer(FleetDatabase, NwslNode),
        ),
      ),
    ),
  ));

it("peersLayer bundles selfNode — one capability, both provided", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      // selfNode resolves from peersLayer's bundled provision (no separate selfNodeLayer)
      const self = yield* Hyperlink.selfNode(FleetDatabase);
      expect(self).toBe("selfnode/NwslNode");
    }).pipe(Effect.provide(Hyperlink.peersLayer(FleetDatabase, NwslNode))),
  ));
