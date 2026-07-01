import { Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import { Combine, combineQuery } from "../src/MultiHost";
import * as Resource from "../src/Resource";

class NwslHost extends Resource.Host<NwslHost>("selfhost/NwslHost") {}

// a fleet health view: `status` per instance, `fleetStatus` a per-host map (Combine.byHost)
class FleetDatabase extends Resource.Tag<FleetDatabase>()("selfhost/FleetDatabase", {
  status: Resource.query(Schema.Boolean),
  fleetStatus: Resource.query(Schema.Record(Schema.String, Schema.Boolean)).pipe(Resource.fleet),
}) {}

// the impl keys its OWN row with `selfHost` — no hand-threaded host key
const database = Resource.layer(
  FleetDatabase,
  Effect.gen(function* () {
    const self = yield* Resource.selfHost(FleetDatabase);
    const peers = yield* Resource.peers(FleetDatabase);
    return {
      status: Effect.succeed(true),
      fleetStatus: Effect.gen(function* () {
        const byHost = yield* combineQuery(peers, (peer) => peer.status, Combine.byHost);
        return { ...byHost, [self]: true }; // self keyed the same way peers are
      }),
    };
  }),
);

// peers keyed by host key, exactly as peersLayer keys them
const fakePeers = {
  "selfhost/EbwslHost": { status: Effect.succeed(false) },
  "selfhost/WnbaHost": { status: Effect.succeed(true) },
};

it("selfHost keys the own row consistently with peer keys in a byHost fold", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* FleetDatabase;
      const fleet = yield* db.fleetStatus;
      expect(fleet).toEqual({
        "selfhost/NwslHost": true, // self, via Resource.selfHost — same key shape as peers
        "selfhost/EbwslHost": false, // peer
        "selfhost/WnbaHost": true, // peer
      });
    }).pipe(
      Effect.provide(
        database.pipe(
          Layer.provide(Resource.peersFrom(FleetDatabase, fakePeers)),
          Layer.provide(Resource.selfHostLayer(FleetDatabase, NwslHost)),
        ),
      ),
    ),
  ));

it("Resource.fleetHealth cans the byHost fold + adds self", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const byHost = yield* Resource.fleetHealth(
        FleetDatabase,
        (peer) => peer.status,
        Effect.succeed(true), // this host's own value
      );
      expect(byHost).toEqual({
        "selfhost/NwslHost": true, // self
        "selfhost/EbwslHost": false, // peer
        "selfhost/WnbaHost": true, // peer
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Resource.peersFrom(FleetDatabase, fakePeers),
          Resource.selfHostLayer(FleetDatabase, NwslHost),
        ),
      ),
    ),
  ));

it("peersLayer bundles selfHost — one capability, both provided", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      // selfHost resolves from peersLayer's bundled provision (no separate selfHostLayer)
      const self = yield* Resource.selfHost(FleetDatabase);
      expect(self).toBe("selfhost/NwslHost");
    }).pipe(Effect.provide(Resource.peersLayer(FleetDatabase, NwslHost))),
  ));
