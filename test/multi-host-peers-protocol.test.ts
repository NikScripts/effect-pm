import { Duration, Effect, Layer, Schema } from "effect";
// two real Node http servers on fixed ports — the raw server is what NodeHttpServer.layer wants.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { combineQuery, combineSum } from "../src/MultiNode";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// What this guards: protocol is now an injected dependency, so `peersLayer` no longer hardcodes an
// http peer client — it dials each peer with the builder from `layerPeerProtocol` (default
// `protocolHttp`). Before, a fleet whose nodes served websocket 404'd on the http peer dial and
// `fleetActive` collapsed to own-only. Here we prove, over a real two-server wire, that (1) the
// default builder folds across peers, and (2) an injected builder is invoked with each peer's url —
// the exact seam that lets `protocolWebsocket` reach ws-serving peers (proven end-to-end, over real
// websockets, by the hyperlink-web example — an isolated two-ws-server harness deadlocks in-process).
const PORT_A = 7913;
const PORT_B = 7914;

class NodeA extends Node.Tag<NodeA>()("ws-peers/A", { url: `http://127.0.0.1:${PORT_A}/rpc` }) {}
class NodeB extends Node.Tag<NodeB>()("ws-peers/B", { url: `http://127.0.0.1:${PORT_B}/rpc` }) {}

class Pool extends Hyperlink.Tag<Pool>()("ws-peers/Pool", {
  active: Hyperlink.effect(Schema.Number),
  fleetActive: Hyperlink.effect(Schema.Number).pipe(Hyperlink.fleet),
}).pipe(Hyperlink.nodes([NodeA, NodeB])) {}

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

// NodeA meshes (peersLayer + the peer protocol under test); NodeB is a pure leaf server (no peers),
// so the mesh is one-directional. `peerProtocol` lets a test inject/record the peer-dial builder.
const meshNode = (
  own: number,
  port: number,
  peerProtocol: Layer.Layer<never>,
) =>
  Node.httpServer([Hyperlink.serve(Pool, impl(own))]).pipe(
    Layer.provide(Hyperlink.peersLayer(Pool, NodeA)),
    Layer.provide(peerProtocol),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  );
const leafNode = (own: number, port: number) =>
  Node.httpServer([Hyperlink.serve(Pool, impl(own))]).pipe(
    Layer.provide(Hyperlink.peersFrom(Pool, {})),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  );

const readFleet = (peerProtocol: Layer.Layer<never>) =>
  Effect.gen(function* () {
    yield* Effect.forkScoped(Layer.launch(leafNode(5, PORT_B)));
    yield* Effect.forkScoped(Layer.launch(meshNode(2, PORT_A, peerProtocol)));
    yield* Effect.sleep(Duration.millis(400)); // let both bind
    return yield* Effect.gen(function* () {
      const pool = yield* Pool;
      expect(yield* pool.active).toBe(2); // this instance
      return yield* pool.fleetActive; // own (2) + peer NodeB (5), folded across the wire
    }).pipe(
      Effect.provide(Hyperlink.client(Pool, NodeA).pipe(Layer.provide(Hyperlink.http(NodeA)))),
      Effect.scoped,
    );
  }).pipe(Effect.scoped);

it("peersLayer folds across a peer over a real wire with the default (http) protocol", () =>
  Effect.runPromise(
    readFleet(Hyperlink.layerPeerProtocol(Hyperlink.protocolHttp)).pipe(
      Effect.map((total) => expect(total).toBe(7)),
    ),
  ), 20_000);

it("layerPeerProtocol injects the peer-dial builder — invoked with each peer's url", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const dialed: Array<string> = [];
      // a builder that records the url it's asked to dial, then defers to the real http protocol —
      // proving peersLayer resolves the peer's url through the injected builder (the ws seam).
      const recording = (url: string) => {
        dialed.push(url);
        return Hyperlink.protocolHttp(url);
      };
      const total = yield* readFleet(Hyperlink.layerPeerProtocol(recording));
      expect(total).toBe(7); // the injected builder actually carried the fold
      expect(dialed).toContain(`http://127.0.0.1:${PORT_B}/rpc`); // NodeB's url, not NodeA (self)
      expect(dialed).not.toContain(`http://127.0.0.1:${PORT_A}/rpc`);
    }).pipe(Effect.asVoid),
  ), 20_000);
