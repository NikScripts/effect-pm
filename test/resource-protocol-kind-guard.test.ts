import { Effect, Layer, Schema } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// A node-bound resource declares HOW it's reached (its node's ProtocolKind). A client derives its
// transport from that kind, so serving the resource over a *different* transport means every client
// dials a protocol the server never answers — the silent "blank dashboard" failure. The server now
// refuses to boot loudly instead.

// `WsNode` declares WebSocket; `WsRes` is bound to it.
class WsNode extends Node.Tag<WsNode>()("p3/ws", { url: "/rpc", kind: "WebSocket" }) {}
class WsRes extends Resource.Tag<WsRes>()(
  "p3/WsRes",
  { ping: Resource.effect(Schema.String) },
  { node: WsNode },
) {}

it("a WebSocket-declared resource served on httpServer refuses to boot (ProtocolKindMismatch)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = Node.httpServer([
        Resource.serve(WsRes, { ping: Effect.succeed("pong") }),
      ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      // providing the server builds it — the mismatch dies at boot; catch the defect and inspect it.
      const outcome = yield* Effect.void.pipe(
        Effect.provide(server),
        Effect.scoped,
        Effect.catchDefect((d: unknown) => Effect.succeed(d)),
      );
      expect(outcome).toBeInstanceOf(Node.ProtocolKindMismatch);
      expect((outcome as Node.ProtocolKindMismatch).declared).toEqual([
        "WebSocket",
      ]);
      expect((outcome as Node.ProtocolKindMismatch).servedOver).toBe("Http");
    }),
  ));

it("the same resource served on wsServer boots fine — the kind matches", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = Node.wsServer([
        Resource.serve(WsRes, { ping: Effect.succeed("pong") }),
      ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      // no die → the boot assertion passed (a mismatch would have died before completing).
      yield* Effect.void.pipe(Effect.provide(server), Effect.scoped);
      expect(true).toBe(true);
    }),
  ));

// `DualNode` declares BOTH http and ws (multi-protocol) — set membership means serving it over
// EITHER transport is fine; only a transport it doesn't declare trips the guard.
class DualNode extends Node.Tag<DualNode>()("p3/dual", {
  http: "http://d/rpc",
  ws: "ws://d/rpc",
}) {}
class DualRes extends Resource.Tag<DualRes>()(
  "p3/DualRes",
  { ping: Resource.effect(Schema.String) },
  { node: DualNode },
) {}

it("a multi-protocol (http+ws) node boots on httpServer AND wsServer — server ∈ its set", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const make of [Node.httpServer, Node.wsServer]) {
        const server = make([
          Resource.serve(DualRes, { ping: Effect.succeed("pong") }),
        ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
        // neither dies — Http and WebSocket are both members of DualNode's declared set.
        yield* Effect.void.pipe(Effect.provide(server), Effect.scoped);
      }
      expect(true).toBe(true);
    }),
  ));
