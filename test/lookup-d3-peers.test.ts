import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import { combineQuery, combineSum } from "../src/MultiNode";
import * as Lookup from "../src/Lookup";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// D3 — bare distributed ≡ nodes([]); peersLayer reads Directory when membership is empty.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-d3-${label}-${process.pid}-${now}.sock`;
  });

class Pool extends Resource.Tag<Pool>()("d3/Pool", {
  active: Resource.effect(Schema.Number),
  fleetActive: Resource.effect(Schema.Number).pipe(Resource.fleet),
}).pipe(Resource.distributed) {}

const impl = (own: number) =>
  Effect.gen(function* () {
    const peers = yield* Resource.peers(Pool);
    return {
      active: Effect.succeed(own),
      fleetActive: combineQuery(peers, (p) => p.active, combineSum).pipe(
        Effect.map((others) => own + others),
      ),
    };
  });

describe("Resource.distributed bare / D3 peersLayer", () => {
  it("bare .pipe(Resource.distributed) stamps an empty Node set", () => {
    class Bare extends Resource.Tag<Bare>()("d3/Bare", {
      n: Resource.effect(Schema.Number),
    }).pipe(Resource.distributed) {}

    expect(Resource.nodesOf(Bare)).toEqual([]);
    expect(Resource.distributedOf(Bare)).toEqual([]);
    expect(Resource.nodeOf(Bare)).toBeUndefined();
  });

  it("list form still stamps fixed membership", () => {
    class East extends Node.Tag<East>()("d3/East", {
      path: "/tmp/d3-east.sock",
    }) {}
    class West extends Node.Tag<West>()("d3/West", {
      path: "/tmp/d3-west.sock",
    }) {}
    class Fixed extends Resource.Tag<Fixed>()("d3/Fixed", {
      n: Resource.effect(Schema.Number),
    }).pipe(Resource.nodes([East, West])) {}

    expect(Resource.nodesOf(Fixed).map((n) => n.key)).toEqual([
      East.key,
      West.key,
    ]);
  });

  it.effect("peersLayer discovers peer via Directory.nodesServing and folds over ipc", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const eastPath = yield* tmpSock("east");
      const westPath = yield* tmpSock("west");
      const lookupNode = Node.Lookup()("d3/lookup", { path: lookupPath });
      class East extends Node.Tag<East, Pool>()("d3/East", {
        path: eastPath,
      }) {}
      class West extends Node.Tag<West, Pool>()("d3/West", {
        path: westPath,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      const lookupServer = yield* Layer.build(Lookup.layer(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);
      const lookup = Context.merge(lookupServer, lookupCtx);

      // Leaf first so directory has West before East's peersLayer builds.
      const westCtx = yield* Layer.build(
        Node.unix(
          West,
          [
            Resource.serve(Pool, impl(5)).pipe(
              Layer.provide(Resource.peersFrom(Pool, {})),
            ),
          ],
          { bootstrapLookup: false },
        ).pipe(Layer.provide(lookupClient)),
      );

      const dir = Context.get(lookup, Lookup.Directory);
      const rows = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({ resourceKey: "d3/Pool" }),
        )
        .pipe(Effect.provide(lookup));
      expect(rows.some((r) => r.nodeKey === West.key)).toBe(true);

      // Membership snapshot: empty stamp + Directory → West (not East/self).
      const peersCtx = yield* Layer.build(
        Resource.peersLayer(Pool, East).pipe(Layer.provide(lookupClient)),
      );
      const peerKeys = Object.keys(
        yield* Resource.peers(Pool).pipe(Effect.provide(peersCtx)),
      );
      expect(peerKeys).toContain(West.key);
      expect(peerKeys).not.toContain(East.key);

      const eastCtx = yield* Layer.build(
        Node.unix(
          East,
          [
            Resource.serve(Pool, impl(2)).pipe(
              Layer.provide(Resource.peersLayer(Pool, East)),
            ),
          ],
          { bootstrapLookup: false },
        ).pipe(Layer.provide(lookupClient)),
      );

      const total = yield* Effect.gen(function* () {
        const pool = yield* Pool;
        expect(yield* pool.active).toBe(2);
        return yield* pool.fleetActive;
      }).pipe(Effect.provide(Resource.client(Pool, East)), Effect.scoped);
      expect(total).toBe(7); // east 2 + west 5 (directory-discovered peer)

      yield* Effect.sync(() => {
        void westCtx;
        void eastCtx;
        void peersCtx;
      });
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(25))),
  );

  it.effect("undeclared tag peersLayer stays empty without Directory (not discoverable)", () =>
    Effect.gen(function* () {
      class Lonely extends Node.Tag<Lonely>()("d3/Lonely", {
        path: "/tmp/d3-lonely.sock",
      }) {}
      class Undeclared extends Resource.Tag<Undeclared>()("d3/Undeclared", {
        n: Resource.effect(Schema.Number),
      }) {}

      const peers = yield* Resource.peers(Undeclared).pipe(
        Effect.provide(Resource.peersLayer(Undeclared, Lonely)),
      );
      expect(peers).toEqual({});
    }),
  );
});
