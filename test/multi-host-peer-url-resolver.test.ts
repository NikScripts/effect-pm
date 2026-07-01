import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

class SelfHost extends Resource.Host<SelfHost>("resolver/SelfHost") {}
// PeerHost carries NO baked url — its url is a deploy concern the resolver supplies
class PeerHost extends Resource.Host<PeerHost>("resolver/PeerHost") {}
class Fleet extends Resource.Tag<Fleet>()("resolver/Fleet", {
  count: Resource.query(Schema.Number),
}).pipe(
  Resource.multiHost([SelfHost, PeerHost]),
) {}

// the PeerHost instance, served on a test server (count = 7)
const PeerServer = Resource.serveAllHttp([
  Resource.serverEntry(Fleet, { count: Effect.succeed(7) }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

// `options.url` overrides Host.url — here it supplies a url for PeerHost (which has none baked in),
// and returns `undefined` for everything else (falling back to Host.url). A host that resolves to no
// url is skipped, never a throw.
it("peersLayer options.url overrides Host.url (resolver supplies a peer with no baked url)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((server) => server.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      yield* Effect.gen(function* () {
        const peers = yield* Resource.peers(Fleet);
        const peer = peers["resolver/PeerHost"];
        expect(peer).toBeDefined();
        if (peer !== undefined) {
          expect(yield* peer.count).toBe(7); // reached via the resolver-supplied url
        }
      }).pipe(
        Effect.provide(
          Resource.peersLayer(Fleet, SelfHost, {
            url: (host) =>
              Effect.succeed(
                host.key === "resolver/PeerHost" ? `http://127.0.0.1:${port}/rpc` : undefined,
              ),
          }),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(PeerServer), Effect.scoped),
  ));
