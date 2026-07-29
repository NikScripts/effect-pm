import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Schedule,
  Schema,
} from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import { combineQuery, combineSum } from "../src/MultiNode";
import * as Lookup from "../src/Lookup";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// D3 — bare distributed ≡ nodes([]); peersLayer reads Directory when membership is empty.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-d3-${label}-${process.pid}-${now}.sock`;
  });

class Pool extends Hyperlink.Tag<Pool>()("d3/Pool", {
  active: Hyperlink.effect(Schema.Number),
  fleetActive: Hyperlink.effect(Schema.Number).pipe(Hyperlink.fleet),
}).pipe(Hyperlink.distributed) {}

const impl = (own: number) =>
  Effect.gen(function* () {
    const peers = yield* Hyperlink.peers(Pool);
    return {
      active: Effect.succeed(own),
      fleetActive: combineQuery(peers, (p) => p.active, combineSum).pipe(
        Effect.map((others) => own + others),
      ),
    };
  });

describe("Hyperlink.distributed bare / D3 peersLayer", () => {
  it("bare .pipe(Hyperlink.distributed) stamps an empty Node set", () => {
    class Bare extends Hyperlink.Tag<Bare>()("d3/Bare", {
      n: Hyperlink.effect(Schema.Number),
    }).pipe(Hyperlink.distributed) {}

    expect(Hyperlink.nodesOf(Bare)).toEqual([]);
    expect(Hyperlink.distributedOf(Bare)).toEqual([]);
    expect(Hyperlink.nodeOf(Bare)).toBeUndefined();
  });

  it("list form still stamps fixed membership", () => {
    class East extends Node.Tag<East>()("d3/East", {
      path: "/tmp/d3-east.sock",
    }) {}
    class West extends Node.Tag<West>()("d3/West", {
      path: "/tmp/d3-west.sock",
    }) {}
    class Fixed extends Hyperlink.Tag<Fixed>()("d3/Fixed", {
      n: Hyperlink.effect(Schema.Number),
    }).pipe(Hyperlink.nodes([East, West])) {}

    expect(Hyperlink.nodesOf(Fixed).map((n) => n.key)).toEqual([
      East.key,
      West.key,
    ]);
  });

  it.live("peersLayer discovers peer via Directory.nodesServing and folds over ipc", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const eastPath = yield* tmpSock("east");
      const westPath = yield* tmpSock("west");
      const lookupNode = Node.Tag()("d3/lookup", { path: lookupPath }).pipe(Node.asLookup);
      class East extends Node.Tag<East, Pool>()("d3/East", {
        path: eastPath,
      }) {}
      class West extends Node.Tag<West, Pool>()("d3/West", {
        path: westPath,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);
      const lookup = Context.merge(lookupServer, lookupCtx);

      // Leaf first so directory has West before East's peersLayer builds.
      const westCtx = yield* Layer.build(
        Node.unix(
          West,
          [
            Hyperlink.serve(Pool, impl(5)).pipe(
              Layer.provide(Hyperlink.peersFrom(Pool, {})),
            ),
          ],
        ).pipe(Layer.provide(lookupClient)),
      );

      const dir = Context.get(lookup, Lookup.Directory);
      const rows = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({ serviceKey: "d3/Pool" }),
        )
        .pipe(Effect.provide(lookup));
      expect(rows.some((r) => r.nodeKey === West.key)).toBe(true);

      // Membership snapshot: empty stamp + Directory → West (not East/self).
      const peersCtx = yield* Layer.build(
        Hyperlink.peersLayer(Pool, East).pipe(Layer.provide(lookupClient)),
      );
      const peerKeys = Object.keys(
        yield* Hyperlink.peers(Pool).pipe(Effect.provide(peersCtx)),
      );
      expect(peerKeys).toContain(West.key);
      expect(peerKeys).not.toContain(East.key);

      const eastCtx = yield* Layer.build(
        Node.unix(
          East,
          [
            Hyperlink.serve(Pool, impl(2)).pipe(
              Layer.provide(Hyperlink.peersLayer(Pool, East)),
            ),
          ],
        ).pipe(Layer.provide(lookupClient)),
      );

      const total = yield* Effect.gen(function* () {
        const pool = yield* Pool;
        expect(yield* pool.active).toBe(2);
        return yield* pool.fleetActive;
      }).pipe(Effect.provide(Hyperlink.client(Pool, East)), Effect.scoped);
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
      class Undeclared extends Hyperlink.Tag<Undeclared>()("d3/Undeclared", {
        n: Hyperlink.effect(Schema.Number),
      }) {}

      const peers = yield* Hyperlink.peers(Undeclared).pipe(
        Effect.provide(Hyperlink.peersLayer(Undeclared, Lonely)),
      );
      expect(peers).toEqual({});
    }),
  );

  it.live("peersLayer hot-rebinds when Directory dial changes (A→B)", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("rebind-lookup");
      const eastPath = yield* tmpSock("rebind-east");
      const westAPath = yield* tmpSock("rebind-west-a");
      const westBPath = yield* tmpSock("rebind-west-b");
      const lookupNode = Node.Tag()("d3/rebind-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);
      class East extends Node.Tag<East, Pool>()("d3/RebindEast", {
        path: eastPath,
      }) {}
      class West extends Node.Tag<West, Pool>()("d3/RebindWest", {
        path: westAPath,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = Context.merge(
        lookupServer,
        yield* Layer.build(lookupClient),
      );

      // West leaf on path A (no peers of its own).
      const westA = yield* Layer.build(
        Node.unix(
          West,
          [
            Hyperlink.serve(Pool, impl(5)).pipe(
              Layer.provide(Hyperlink.peersFrom(Pool, {})),
            ),
          ],
        ).pipe(Layer.provide(lookupClient)),
      );

      const peersCtx = yield* Layer.build(
        Hyperlink.peersLayer(Pool, East).pipe(Layer.provide(lookupClient)),
      );

      const foldWest = Effect.gen(function* () {
        const peers = yield* Hyperlink.peers(Pool);
        const west = peers[West.key];
        if (west === undefined) return undefined as number | undefined;
        return yield* west.active;
      }).pipe(Effect.provide(peersCtx));

      expect(yield* foldWest).toBe(5);
      yield* Effect.sync(() => {
        void westA;
      });

      // A exits membership; B advertises same nodeKey on a new dial.
      yield* Node.shutdown(West);

      const dir = Context.get(lookupCtx, Lookup.Directory);
      yield* Effect.repeat(
        dir
          .nodesServing(
            new Lookup.NodesServingRequest({ serviceKey: "d3/Pool" }),
          )
          .pipe(
            Effect.provide(lookupCtx),
            Effect.map((rows) => rows.length === 0),
          ),
        {
          until: (empty) => empty,
          schedule: Schedule.spaced(Duration.millis(25)),
        },
      );

      class WestB extends Node.Tag<WestB, Pool>()("d3/RebindWest", {
        path: westBPath,
      }) {}

      const westB = yield* Layer.build(
        Node.unix(
          WestB,
          [
            Hyperlink.serve(Pool, impl(9)).pipe(
              Layer.provide(Hyperlink.peersFrom(Pool, {})),
            ),
          ],
        ).pipe(Layer.provide(lookupClient)),
      );

      yield* Effect.repeat(foldWest, {
        until: (n) => n === 9,
        schedule: Schedule.spaced(Duration.millis(25)),
      });
      expect(yield* foldWest).toBe(9);
      yield* Effect.sync(() => {
        void westB;
      });
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );
});
