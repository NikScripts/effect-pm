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
      expect((outcome as Node.ProtocolKindMismatch).declared).toBe("WebSocket");
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
