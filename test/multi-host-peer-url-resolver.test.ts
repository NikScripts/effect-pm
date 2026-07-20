import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

class SelfNode extends Node.Tag<SelfNode>("resolver/SelfNode") {}
// PeerNode carries NO baked url — its url is a deploy concern the resolver supplies
class PeerNode extends Node.Tag<PeerNode>("resolver/PeerNode") {}
class Fleet extends Resource.Tag<Fleet>()("resolver/Fleet", {
  count: Resource.effect(Schema.Number),
}).pipe(
  Resource.nodes([SelfNode, PeerNode]),
) {}

// the PeerNode instance, served on a test server (count = 7)
const PeerServer = Node.httpServer([
  Resource.serve(Fleet, { count: Effect.succeed(7) }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

// `options.url` overrides Node.url — here it supplies a url for PeerNode (which has none baked in),
// and returns `undefined` for everything else (falling back to Node.url). A node that resolves to no
// url is skipped, never a throw.
it("peersLayer options.url overrides Node.url (resolver supplies a peer with no baked url)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((server) => server.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      yield* Effect.gen(function* () {
        const peers = yield* Resource.peers(Fleet);
        const peer = peers["resolver/PeerNode"];
        expect(peer).toBeDefined();
        if (peer !== undefined) {
          expect(yield* peer.count).toBe(7); // reached via the resolver-supplied url
        }
      }).pipe(
        Effect.provide(
          Resource.peersLayer(Fleet, SelfNode, {
            url: (node) =>
              Effect.succeed(
                node.key === "resolver/PeerNode" ? `http://127.0.0.1:${port}/rpc` : undefined,
              ),
          }),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(PeerServer), Effect.scoped),
  ));
