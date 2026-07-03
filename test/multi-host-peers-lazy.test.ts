import { Duration, Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { Combine, combineQuery } from "../src/MultiNode";
import * as Resource from "../src/Resource";

// Regression: a `value` (stream-backed) field on a distributed resource used to DEADLOCK the serve at build —
// `peersLayer` eagerly built each peer client, and a `value`'s client subscription blocked for the initial
// push, so a co-booting / down peer hung the whole node. Peer clients are now fully lazy: nothing connects
// until a fold reads a field, and `combineQuery` drops an unreachable peer.
// See docs/handoffs/2026-07-02-peerslayer-eager-stream-connect-deadlock.md
class SelfNode extends Resource.Node<SelfNode>("peers-lazy/Self") {}
class PeerNode extends Resource.Node<PeerNode>("peers-lazy/Peer") {}
class Fleet extends Resource.Tag<Fleet>()("peers-lazy/Fleet", {
  n: Resource.value(Schema.Number), // the trigger — a value field
}).pipe(Resource.distributed([SelfNode, PeerNode])) {}

it("peersLayer with a value field boots against a DOWN peer (no build deadlock)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      // building the peers capability builds the peer client — must NOT hang (the value field used to
      // block here on the initial push).
      const peers = yield* Resource.peers(Fleet);
      expect(peers["peers-lazy/Peer"]).toBeDefined();
    }).pipe(
      Effect.provide(
        Resource.peersLayer(Fleet, SelfNode, {
          url: () => Effect.succeed("http://127.0.0.1:5999/rpc"), // dead endpoint
        }),
      ),
      Effect.scoped,
    ),
  ));

it("folding a value across peers drops an unreachable one (one-shot read, per-peer timeout)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const peers = yield* Resource.peers(Fleet);
      // one-shot read of each peer's `value`; a dead peer's read fails (or is timed out) and is dropped,
      // so the total is just self's own contribution.
      const total = yield* combineQuery(
        peers,
        (p) => p.n.pipe(Effect.timeout(Duration.seconds(2))),
        Combine.sum,
      ).pipe(Effect.map((others) => 42 + others));
      expect(total).toBe(42);
    }).pipe(
      Effect.provide(
        Resource.peersLayer(Fleet, SelfNode, {
          url: () => Effect.succeed("http://127.0.0.1:5999/rpc"),
        }),
      ),
      Effect.scoped,
    ),
  ));
